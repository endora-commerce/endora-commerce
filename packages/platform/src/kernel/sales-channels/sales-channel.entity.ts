import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Sales Channel — feature 005.
 *
 * The platform-wide stable handle through which every other module scopes
 * its data (FR-013/FR-015). One row carries `systemDefault = true`
 * (enforced by a partial unique index — feature 005, migration 025); the
 * boot-time reconciler is the single source of truth for that flag
 * (research.md R-4).
 *
 * Legacy field preserved for one release cycle (research.md R-12):
 *   - `status` — superseded by the boolean `active`. Keeping both for
 *     reversibility of migration 025; consumers should read `active`.
 *
 * Whether a channel shows prices is not this entity's question (issue #492):
 * the retired public-channel flag withheld them from every viewer, signed-in
 * buyers included, beside a display-mode chain that already answered it. A
 * channel that hides prices until sign-in sets
 * `pricing.unauthenticated_display_mode = none` for itself.
 *
 * Optimistic concurrency for identity edits (FR-005) is enforced by the
 * `version` column. The service layer bumps `version` on every mutation
 * and `PATCH` handlers gate on `If-Match: W/"<id>:<version>"` — same
 * pattern as `quote_requests` and the settings module.
 *
 * Bridge tables (sales_channel_<entity>) are declared by their owning
 * modules as separate entity classes; this class does not declare any
 * MikroORM relation properties for them so that adding / removing
 * bridges in later features stays a per-module concern.
 */
@GlobalEntity()
@Entity({ tableName: 'sales_channels' })
export class SalesChannel {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'logoAssetId'
    | 'themeCode'
    | 'languages'
    | 'currencies'
    | 'active'
    | 'anonymousAccess'
    | 'prefixDefaultLanguage'
    | 'systemDefault'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 32 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'uuid', nullable: true })
  logoAssetId?: string | null = null;

  @Property({ type: 'string', length: 64, nullable: true })
  themeCode?: string | null = null;

  /** Ordered array of language codes; `defaultLanguage` MUST be one of these. */
  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'string', length: 10 })
  defaultLanguage!: string;

  /** Ordered array of ISO-4217 currency codes; `defaultCurrency` MUST be one of these. */
  @Property({ type: 'json' })
  currencies: string[] = [];

  @Property({ type: 'string', length: 3 })
  defaultCurrency!: string;

  @Property({ type: 'boolean' })
  active: boolean = true;

  /**
   * May an anonymous request use this channel (feature 154, FR-001)? When
   * false, the kernel's access step refuses anonymous requests with
   * `SALES_CHANNEL_SIGN_IN_REQUIRED`; customers are decided by their
   * Organization's channel assignment either way. Whether an anonymous visitor
   * sees prices on an open channel is the display-mode chain's question
   * (`pricing.unauthenticated_display_mode`), not this flag's.
   */
  @Property({ type: 'boolean' })
  anonymousAccess: boolean = true;

  /**
   * Does the default language carry its path prefix in storefront URLs
   * (`specs/167-storefront-locale-path/`, OR-1)? Every other channel language is
   * always prefixed. On for new channels; the feature's migration switched every
   * channel that existed at upgrade off so its URLs did not move (OR-10). The
   * prefixes themselves are derived, never stored (`channelUrlLanguages`).
   */
  @Property({ type: 'boolean' })
  prefixDefaultLanguage: boolean = true;

  /** True for exactly one row platform-wide (partial unique index in migration 025). */
  @Property({ type: 'boolean' })
  systemDefault: boolean = false;

  /** Optimistic-concurrency guard for identity edits (FR-005); service-layer bump. */
  @Property({ type: 'integer' })
  version: number = 1;

  // -- Legacy column (preserved for one release per research.md R-12) -------

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
