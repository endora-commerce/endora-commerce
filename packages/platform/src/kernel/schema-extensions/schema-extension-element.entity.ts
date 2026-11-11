import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../tenancy/org-scoped.decorator.js';

/** What a ledger row records. */
export type SchemaExtensionElementKind = 'column' | 'index';
/** `applied → orphaned → applied | dropped`; `dropped` is terminal (`data-model.md` §1). */
export type SchemaExtensionElementStatus = 'applied' | 'orphaned' | 'dropped';

/**
 * One row of the `schema_extensions` ledger (`specs/178-extensible-columns/`
 * FR-022, `data-model.md` §1): a column or an index a declared extension added
 * to a host table.
 *
 * Global (Constitution XI): it describes the instance's schema, which no tenant
 * owns. Written by the generated migration step and the audited drop command,
 * read by the verifier — never by a module.
 */
@GlobalEntity()
@Entity({ tableName: 'schema_extensions' })
export class SchemaExtensionElement {
  [OptionalProps]?: 'packageVersion' | 'orphanedAt' | 'droppedAt' | 'dropAuditId';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'text' })
  moduleId!: string;

  @Property({ type: 'text' })
  hostTable!: string;

  @Property({ type: 'text' })
  kind!: SchemaExtensionElementKind;

  @Property({ type: 'text' })
  physicalName!: string;

  @Property({ type: 'text' })
  declaredKey!: string;

  @Property({ type: 'json' })
  spec!: Record<string, unknown>;

  @Property({ type: 'text' })
  specHash!: string;

  @Property({ type: 'text' })
  status!: SchemaExtensionElementStatus;

  @Property({ type: 'text' })
  platformVersion!: string;

  @Property({ type: 'text', nullable: true })
  packageVersion?: string | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz' })
  appliedAt!: Date;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  orphanedAt?: Date | null = null;

  @Property({ type: 'Date', columnType: 'timestamptz', nullable: true })
  droppedAt?: Date | null = null;

  @Property({ type: 'uuid', nullable: true })
  dropAuditId?: string | null = null;
}
