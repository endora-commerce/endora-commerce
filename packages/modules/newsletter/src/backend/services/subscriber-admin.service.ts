import type { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type SubscriberDetail,
  type SubscriberListQuery,
  type SubscriberListResponse,
  type SubscriberStatus,
  type SubscriberSummary,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeDeactivateSubscriberCommand } from '../commands/deactivate-subscriber.command.js';
import { makeDeleteSubscriberCommand } from '../commands/delete-subscriber.command.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';

/** Filter fields shared by list + export (explicit `| undefined` for exactOptionalPropertyTypes). */
export interface SubscriberFilter {
  status?: SubscriberStatus | undefined;
  tag?: string | undefined;
  channel?: string | undefined;
  q?: string | undefined;
}

const CSV_COLUMNS = ['email', 'status', 'tags', 'source', 'consentAt', 'unsubscribedAt', 'unsubscribeReason', 'customFields'] as const;

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Admin subscriber list / detail / lifecycle / CSV export (feature 048, US3). */
export class NewsletterSubscriberAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  private async buildWhere(em: EntityManager, query: SubscriberFilter): Promise<FilterQuery<NewsletterSubscriber>> {
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.channel) where['salesChannelId'] = query.channel;
    if (query.q) where['email'] = { $ilike: `%${query.q}%` };
    if (query.tag) {
      const tag = await em.findOne(NewsletterTag, { code: query.tag });
      const links = tag ? await em.find(NewsletterSubscriberTag, { tagId: tag.id }) : [];
      where['id'] = { $in: links.map((l) => l.subscriberId) };
    }
    return where as FilterQuery<NewsletterSubscriber>;
  }

  private async tagsFor(em: EntityManager, subscriberIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (subscriberIds.length === 0) return map;
    const links = await em.find(NewsletterSubscriberTag, { subscriberId: { $in: subscriberIds } });
    const tagIds = [...new Set(links.map((l) => l.tagId))];
    const tags = await em.find(NewsletterTag, { id: { $in: tagIds } });
    const codeById = new Map(tags.map((t) => [t.id, t.code]));
    for (const link of links) {
      const code = codeById.get(link.tagId);
      if (!code) continue;
      const arr = map.get(link.subscriberId) ?? [];
      arr.push(code);
      map.set(link.subscriberId, arr);
    }
    return map;
  }

  async list(query: SubscriberListQuery): Promise<SubscriberListResponse> {
    const em = this.emFactory();
    const where = await this.buildWhere(em, query);
    const [rows, total] = await em.findAndCount(NewsletterSubscriber, where, {
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const tagMap = await this.tagsFor(em, rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toSummary(r, tagMap.get(r.id) ?? [])),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getDetail(id: string): Promise<SubscriberDetail> {
    const em = this.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
    const sub = await em.findOne(NewsletterSubscriber, { id });
    if (!sub) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
    const tagMap = await this.tagsFor(em, [id]);
    return this.toDetail(sub, tagMap.get(id) ?? []);
  }

  /** The `newsletter_deactivate` Command (issue #1381): the write and its entry commit together. */
  async deactivate(id: string, expectedVersion: number): Promise<SubscriberDetail> {
    const sub = await this.commandBus.run(makeDeactivateSubscriberCommand({ subscriberId: id, expectedVersion }));
    const tagMap = await this.tagsFor(this.emFactory(), [sub.id]);
    return this.toDetail(sub, tagMap.get(sub.id) ?? []);
  }

  /** The `newsletter_delete` Command (issue #1381): the delete and its entry commit together. */
  async remove(id: string): Promise<void> {
    await this.commandBus.run(makeDeleteSubscriberCommand({ subscriberId: id }));
  }

  async exportCsv(query: SubscriberFilter): Promise<string> {
    const em = this.emFactory();
    const where = await this.buildWhere(em, query);
    const rows = await em.find(NewsletterSubscriber, where, { orderBy: { createdAt: 'desc' } });
    const tagMap = await this.tagsFor(em, rows.map((r) => r.id));
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.email,
          r.status,
          (tagMap.get(r.id) ?? []).join('|'),
          r.source ?? '',
          r.consentAt?.toISOString() ?? '',
          r.unsubscribedAt?.toISOString() ?? '',
          r.unsubscribeReason ?? '',
          JSON.stringify(r.customFields),
        ]
          .map((v) => csvCell(String(v)))
          .join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private toSummary(s: NewsletterSubscriber, tags: string[]): SubscriberSummary {
    return {
      id: s.id,
      email: s.email,
      status: s.status,
      source: s.source,
      salesChannelId: s.salesChannelId,
      tags,
      consentAt: s.consentAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private toDetail(s: NewsletterSubscriber, tags: string[]): SubscriberDetail {
    return {
      ...this.toSummary(s, tags),
      customerAccountId: s.customerAccountId,
      customFields: s.customFields,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      unsubscribedAt: s.unsubscribedAt?.toISOString() ?? null,
      unsubscribeReason: s.unsubscribeReason,
      deactivatedAt: s.deactivatedAt?.toISOString() ?? null,
      version: s.version,
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
