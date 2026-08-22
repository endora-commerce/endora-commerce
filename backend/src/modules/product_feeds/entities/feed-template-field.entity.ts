import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { FeedFieldSourceKind, FeedFieldTransform } from '@endora-commerce/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTemplateField — feature 067 / data-model.md §2.
 *
 * One output column or element: the name written verbatim into the file plus
 * the catalogue source it binds to. Bindings travel as stable definition KEYS
 * (never uuids), which is what makes a template portable across installations
 * (FR-013).
 *
 * Tenancy: `@GlobalEntity()` — see `feed-template.entity.ts`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_template_fields' })
export class FeedTemplateField {
  [OptionalProps]?:
    | 'id'
    | 'providerRequired'
    | 'sortOrder'
    | 'unbound'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'feed_template_id' })
  @Index()
  feedTemplateId!: string;

  /** Written verbatim in the file (`g:price`, `availability`, `item_group_id`). */
  @Property({ type: 'varchar', length: 128, fieldName: 'output_name' })
  outputName!: string;

  @Property({ type: 'varchar', length: 32, fieldName: 'source_kind' })
  sourceKind!: FeedFieldSourceKind;

  /** The attribute/custom-field key, or the product property name. Never a uuid. */
  @Property({ type: 'varchar', length: 128, fieldName: 'source_key', nullable: true })
  sourceKey?: string | null;

  /** Only for `sourceKind = 'constant'`. */
  @Property({ type: 'text', fieldName: 'constant_value', nullable: true })
  constantValue?: string | null;

  @Property({ type: 'text', fieldName: 'fallback_value', nullable: true })
  fallbackValue?: string | null;

  /** Drives skip-vs-omit (FR-037, FR-083) and the removal warning (FR-074). */
  @Property({ type: 'boolean', fieldName: 'provider_required' })
  providerRequired: boolean = false;

  /** Closed list — deliberately not an expression language (FR-067). */
  @Property({ type: 'varchar', length: 32, fieldName: 'transform', nullable: true })
  transform?: FeedFieldTransform | null;

  @Property({ type: 'varchar', length: 64, fieldName: 'transform_arg', nullable: true })
  transformArg?: string | null;

  @Property({ type: 'integer', fieldName: 'sort_order' })
  sortOrder: number = 0;

  /**
   * Translation key for the field's one-sentence gloss in the editor
   * (ux-design §3.3, SC-013), resolved in this module's own i18n namespace.
   * Null for operator-created fields on purpose: the platform can explain a
   * provider's vocabulary, but must not invent meaning for a name an operator
   * chose. An unresolvable key renders as no gloss, never as a raw key.
   */
  @Property({ type: 'varchar', length: 128, fieldName: 'help_key', nullable: true })
  helpKey?: string | null;

  /** Set on import when `sourceKey` does not resolve locally (FR-015); blocks generation (FR-016). */
  @Property({ type: 'boolean', fieldName: 'unbound' })
  unbound: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({
    type: 'datetime',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    fieldName: 'updated_at',
  })
  updatedAt: Date = new Date();
}
