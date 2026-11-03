import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { FormDefinition } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * One published version of a form (`specs/170-forms-module/data-model.md` §2, research R-3): the
 * frozen definition a shopper submitted against. **Immutable** — the service has no update path,
 * and every entry references the version it was submitted to (FR-009, FR-010), so an entry always
 * renders with its own version's labels and options.
 *
 * A snapshot of operator content: platform-wide (research § Principle XI review).
 */
@GlobalEntity()
@Entity({ tableName: 'form_versions' })
export class FormVersion {
  [OptionalProps]?: 'id' | 'publishedAt' | 'publishedByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  formId!: string;

  /** 1…n, unique per form. */
  @Property({ type: 'integer' })
  number!: number;

  /** The definition as published, with `definitionIssues` = none. */
  @Property({ type: 'json' })
  definition!: FormDefinition;

  /** Copied from the form at publish. */
  @Property({ type: 'string', length: 16 })
  defaultLanguage!: string;

  @Property({ type: 'datetime' })
  publishedAt: Date = new Date();

  @Property({ type: 'uuid', nullable: true })
  publishedByAdminUserId: string | null = null;
}
