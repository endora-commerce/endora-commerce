import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
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
 * Legacy fields preserved for one release cycle (research.md R-12):
 *   - `isPublic` — anonymous-price visibility for the storefront. Will
 *     be folded into the new `active` flag's downstream effects later.
 *   - `status` — superseded by the boolean `active`. Keeping both for
 *     reversibility of migration 025; consumers should read `active`.
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
@Entity({ tableName: 'sales_channels' })
export class SalesChannel {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isPublic'
    | 'status'
    | 'logoAssetId'
    | 'themeCode'
    | 'languages'
    | 'currencies'
    | 'active'
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

  /** True for exactly one row platform-wide (partial unique index in migration 025). */
  @Property({ type: 'boolean' })
  systemDefault: boolean = false;

  /** Optimistic-concurrency guard for identity edits (FR-005); service-layer bump. */
  @Property({ type: 'integer' })
  version: number = 1;

  // -- Legacy columns (preserved for one release per research.md R-12) ------

  @Property({ type: 'boolean' })
  isPublic: boolean = false;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
