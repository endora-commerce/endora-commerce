import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * CredentialConfiguration — feature 058 / data-model.md §1.
 *
 * A reusable, named instance of a code-registered configuration type (e.g.
 * `llm`, `email_adapter`). The credentials core is type-agnostic: `typeCode` /
 * `providerCode` are resolved against the in-process `ConfigurationTypeRegistry`
 * at read/write time, never enforced by DB constraints.
 *
 * Platform-global (`@GlobalEntity()`, Principle XI) — like `SettingValue`, this
 * carries no tenant key and is administered platform-wide.
 *
 * `values` is a field-value bag keyed by `FieldDefinition.key`: secret fields
 * hold AES-256-GCM envelopes (`{ v, alg, iv, ct, tag }`), non-secret fields hold
 * plain JSON scalars. `version` powers the optimistic lock guarding concurrent
 * edits.
 */
@GlobalEntity()
@Entity({ tableName: 'credential_configurations' })
export class CredentialConfiguration {
  [OptionalProps]?: 'id' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 128, fieldName: 'code' })
  @Unique()
  code!: string;

  @Property({ type: 'varchar', length: 255, fieldName: 'name' })
  name!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'type_code' })
  @Index()
  typeCode!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'provider_code' })
  providerCode!: string;

  @Property({ type: 'json', fieldName: 'values' })
  values: Record<string, unknown> = {};

  @Property({ type: 'integer', version: true, fieldName: 'version' })
  version!: number;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date(), onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt: Date = new Date();
}
