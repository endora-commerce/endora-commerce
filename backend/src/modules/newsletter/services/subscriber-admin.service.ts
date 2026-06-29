import type { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type SubscriberDetail,
  type SubscriberListQuery,
  type SubscriberListResponse,
  type SubscriberStatus,
  type SubscriberSummary,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';

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
    private readonly auditLog?: AuditLogService,
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
      orderBy: { createdAt: 'desc' },
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
    const sub = await em.findOne(NewsletterSubscriber, { id });
    if (!sub) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
    const tagMap = await this.tagsFor(em, [id]);
    return this.toDetail(sub, tagMap.get(id) ?? []);
  }

  async deactivate(id: string, expectedVersion: number): Promise<SubscriberDetail> {
    const em = this.emFactory();
    const sub = await em.findOne(NewsletterSubscriber, { id });
    if (!sub) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
    if (sub.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Subscriber was modified.');
    }
    sub.status = 'deactivated';
    sub.deactivatedAt = new Date();
    sub.version += 1;
    await em.persistAndFlush(sub);
    await this.auditLog?.record({
      action: 'newsletter_deactivate',
      objectType: 'newsletter_subscriber',
      objectId: sub.id,
      stateAfter: { status: 'deactivated' },
    });
    const tagMap = await this.tagsFor(em, [id]);
    return this.toDetail(sub, tagMap.get(id) ?? []);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const sub = await em.findOne(NewsletterSubscriber, { id });
    if (!sub) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
    // Retain a suppression keyed by email so the address stays unmailable (R6).
    const existing = await em.findOne(NewsletterSuppression, { email: sub.email });
    if (!existing) {
      em.create(NewsletterSuppression, { email: sub.email, reason: 'unsubscribe', detail: 'deleted' });
    }
    await this.auditLog?.record({
      action: 'newsletter_delete',
      objectType: 'newsletter_subscriber',
      objectId: sub.id,
      stateBefore: { email: sub.email },
    });
    await em.removeAndFlush(sub); // bridges cascade via FK
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
