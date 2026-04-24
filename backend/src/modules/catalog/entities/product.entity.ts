import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Product — the central catalog object. Supports four `type`s (FR-002).
 * Soft-deleted via `deletedAt` (data-model.md cross-cutting section); archived
 * products still resolve from historical Orders, Invoices, RFQs, Shopping Lists
 * but are excluded from search/filters.
 *
 * Multilingual fields (`name`, `description`) are stored as JSONB per
 * data-model.md; `attributeValues` is a JSONB keyed by ProductAttribute.key.
 */
@Entity({ tableName: 'products' })
export class Product {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'stockMode'
    | 'deletedAt'
    | 'archivedAt'
    | 'allowedOrganizationIds';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  sku!: string;

  @Property({ type: 'string', length: 160 })
  @Index()
  @Unique()
  slug!: string;

  @Property({ type: 'string', length: 16 })
  type!: 'simple' | 'variant' | 'grouped' | 'virtual';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'active' | 'archived' = 'draft';

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'json' })
  description!: Record<string, string>;

  /** Per-product override of global stock mode (categorical/numeric/null=inherit). */
  @Property({ type: 'string', length: 16, nullable: true })
  stockMode?: 'categorical' | 'numeric' | null;

  @Property({ type: 'string', length: 32 })
  visibility: 'public' | 'logged_in_only' | 'organization_restricted' = 'public';

  /** JSONB `{ attributeKey: value }` validated against ProductAttribute definitions. */
  @Property({ type: 'json' })
  attributeValues: Record<string, unknown> = {};

  /**
   * allowedOrganizationIds is denormalised as JSONB for read convenience; the
   * canonical M:N source of truth is the `product_allowed_organizations` bridge
   * (managed in the initial migration).
   */
  @Property({ type: 'json' })
  allowedOrganizationIds: string[] = [];

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  @Index()
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  @Index()
  archivedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
