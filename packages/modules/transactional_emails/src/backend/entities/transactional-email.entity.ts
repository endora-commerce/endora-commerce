import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { EmailVariableDescriptor } from '@endora-commerce/contracts';

/**
 * TransactionalEmail — feature 047 (US1/US5).
 *
 * The canonical definition of one transactional email plus the CURRENT
 * module-provided defaults. Rows are reconciled at boot from module manifests +
 * the EmailDefaultsRegistry; admin customizations live separately in
 * `transactional_email_contents`, so refreshing defaults here never overwrites
 * customizations. `code` is the stable send key.
 */
@GlobalEntity()
@Entity({ tableName: 'transactional_emails' })
export class TransactionalEmail {
  [OptionalProps]?: 'active' | 'description' | 'groupCode' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 64 })
  ownerModule!: string;

  @Property({ type: 'text', nullable: true })
  description: string | null = null;

  @Property({ type: 'string', length: 64, nullable: true })
  groupCode: string | null = null;

  /** Declared variables: [{ key, label, sampleValue?, description? }]. */
  @Property({ type: 'json' })
  variables!: EmailVariableDescriptor[];

  /** Supported BCP-47 language codes. */
  @Property({ type: 'json' })
  languages!: string[];

  /** Module default subject per language: { lang: string }. */
  @Property({ type: 'json' })
  defaultSubject!: Record<string, string>;

  /** Module default content envelope: { schema_version, languages: { lang: tree } }. */
  @Property({ type: 'json' })
  defaultContent!: Record<string, unknown>;

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
