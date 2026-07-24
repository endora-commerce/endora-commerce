import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Long-lived API key for external integrations (FR-120).
 *
 * The plaintext token is shown to the operator once at creation time
 * (`sk_live_<base64url>`). We store only its sha256 hash.
 *
 * `scopes` is a JSONB array of permission strings (e.g. `catalog:read`,
 * `orders:write`). The api-key auth gate checks `scopes.includes(scope)`.
 */
@GlobalEntity()
@Entity({ tableName: 'api_keys' })
export class ApiKey {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'scopes'
    | 'lastUsedAt'
    | 'revokedAt'
    | 'createdByAdminUserId'
    | 'organizationId'
    | 'salesChannelId'
    | 'customerAccountId'
    | 'expiresAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Human-readable label shown in the admin panel ("PIM sync", "ERP nightly"). */
  @Property({ type: 'string', length: 160 })
  name!: string;

  /** SHA-256 hex of the raw bearer token. Indexed for O(1) authenticate(). */
  @Property({ type: 'string', length: 128 })
  @Unique()
  @Index()
  keyHash!: string;

  /** Last 4 chars of the raw token, shown in the UI for identification. */
  @Property({ type: 'string', length: 8 })
  lastFour!: string;

  @Property({ type: 'json' })
  scopes: string[] = [];

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'revoked' = 'active';

  @Property({ type: 'datetime', nullable: true })
  lastUsedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  revokedAt?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  // ── Feature 062 — distributor binding (all-or-none, immutable) ──────────
  // The three binding columns are either all set (bound distributor key:
  // single-org tenant scope + pinned channel + designated service account)
  // or all NULL (legacy unbound platform key). Enforced by the
  // `api_keys_binding_all_or_none` CHECK; the cross-row org-membership rule
  // is validated at creation in ApiKeyService (research §R4).

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  customerAccountId?: string | null;

  /** NULL = non-expiring. `authenticate()` refuses keys past this instant. */
  @Property({ type: 'datetime', nullable: true })
  expiresAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
