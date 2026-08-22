import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type CreateNewsletterTagRequest, type NewsletterTag as NewsletterTagDto, type UpdateNewsletterTagRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

/** Newsletter tag CRUD (feature 048, US3). */
export class NewsletterTagService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'newsletter_tag',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  async list(): Promise<NewsletterTagDto[]> {
    const em = this.emFactory();
    const rows = await em.find(NewsletterTag, {}, { orderBy: { code: 'asc' } });
    return rows.map((t) => this.toDto(t));
  }

  async create(input: CreateNewsletterTagRequest): Promise<NewsletterTagDto> {
    const em = this.emFactory();
    const existing = await em.findOne(NewsletterTag, { code: input.code });
    if (existing) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Tag code already exists.');
    const tag = em.create(NewsletterTag, {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
    });
    em.persist(tag);
    this.#audit(em, 'newsletter_tag.create', tag.id, { code: tag.code });
    await em.flush();
    return this.toDto(tag);
  }

  async update(id: string, input: UpdateNewsletterTagRequest): Promise<NewsletterTagDto> {
    const em = this.emFactory();
    const tag = await em.findOne(NewsletterTag, { id });
    if (!tag) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Tag not found.');
    if (input.name !== undefined) tag.name = input.name;
    if (input.description !== undefined) tag.description = input.description;
    this.#audit(em, 'newsletter_tag.update', tag.id, { name: tag.name });
    await em.persistAndFlush(tag);
    return this.toDto(tag);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const tag = await em.findOne(NewsletterTag, { id });
    if (!tag) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Tag not found.');
    // Guard: block delete if referenced by a campaign target or automation trigger.
    const refs = (await em.getConnection().execute(
      `select 1 from newsletter_campaigns where target_tag_ids @> ?::jsonb
       union all
       select 1 from newsletter_automations where trigger_tag_ids @> ?::jsonb limit 1`,
      [JSON.stringify([id]), JSON.stringify([id])],
      'all',
      em.getTransactionContext(),
    )) as unknown[];
    if (refs.length > 0) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Tag is used by a campaign or automation.', {
        code: 'tag_in_use',
      });
    }
    // Subscriber-tag bridge rows cascade via FK.
    this.#audit(em, 'newsletter_tag.delete', tag.id, null);
    await em.removeAndFlush(tag);
  }

  private toDto(t: NewsletterTag): NewsletterTagDto {
    return { id: t.id, code: t.code, name: t.name, description: t.description };
  }
}
