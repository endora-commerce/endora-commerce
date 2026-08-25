import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateNewsletterCustomFieldRequest,
  type NewsletterCustomField as NewsletterCustomFieldDto,
  type UpdateNewsletterCustomFieldRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { NewsletterCustomField } from '../entities/newsletter-custom-field.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/** Newsletter custom-field definition CRUD (feature 048, US3). */
export class NewsletterCustomFieldService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'newsletter_custom_field',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  async list(): Promise<NewsletterCustomFieldDto[]> {
    const em = this.emFactory();
    const rows = await em.find(NewsletterCustomField, {}, { orderBy: { key: 'asc' } });
    return rows.map((f) => this.toDto(f));
  }

  async create(input: CreateNewsletterCustomFieldRequest): Promise<NewsletterCustomFieldDto> {
    const em = this.emFactory();
    const existing = await em.findOne(NewsletterCustomField, { key: input.key });
    if (existing) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Field key already exists.');
    const field = em.create(NewsletterCustomField, {
      key: input.key,
      label: input.label,
      type: input.type,
    });
    em.persist(field);
    this.#audit(em, 'newsletter_custom_field.create', field.id, { key: field.key });
    await em.flush();
    return this.toDto(field);
  }

  async update(id: string, input: UpdateNewsletterCustomFieldRequest): Promise<NewsletterCustomFieldDto> {
    const em = this.emFactory();
    const field = await em.findOne(NewsletterCustomField, { id });
    if (!field) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Field not found.');
    if (input.label !== undefined) field.label = input.label;
    this.#audit(em, 'newsletter_custom_field.update', field.id, { label: field.label });
    await em.persistAndFlush(field);
    return this.toDto(field);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const field = await em.findOne(NewsletterCustomField, { id });
    if (!field) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Field not found.');
    this.#audit(em, 'newsletter_custom_field.delete', field.id, null);
    await em.removeAndFlush(field);
  }

  private toDto(f: NewsletterCustomField): NewsletterCustomFieldDto {
    return { id: f.id, key: f.key, label: f.label, type: f.type };
  }
}
