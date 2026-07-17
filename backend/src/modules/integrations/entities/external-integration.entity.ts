import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * External integration registry (FR-122). Holds per-vendor configuration —
 * the API URL, auth credentials, sync schedule. `encryptedConfig` is opaque
 * to callers; the IntegrationService encrypts at rest with a key from env.
 */
@GlobalEntity()
@Entity({ tableName: 'external_integrations' })
export class ExternalIntegration {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'lastTestedAt'
    | 'lastError'
    | 'createdByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 64 })
  @Unique()
  @Index()
  vendor!: string;

  @Property({ type: 'string', length: 32 })
  kind!: string;

  /** Base64-of-AES-GCM(json(plaintextConfig)) — opaque blob. */
  @Property({ type: 'text' })
  encryptedConfig!: string;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' | 'error' = 'inactive';

  @Property({ type: 'datetime', nullable: true })
  lastTestedAt?: Date | null;

  @Property({ type: 'string', length: 4000, nullable: true })
  lastError?: string | null;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
