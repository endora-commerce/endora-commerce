import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * A pricing profile of the price surface (feature 160, research R6–R7,
 * data-model §6): the buyers of one channel and currency who meet the same
 * applicable buyer books at the same chain depths, under one precedence
 * version. `bookVector` is the sorted `[{ bookId, audienceKind, depth }]`;
 * `[]` is the everyone profile. Rows are built only by the surface worker; a request
 * at most registers a profile (`state = 'building'`), never builds it.
 */
@RuleScoped()
@Entity({ tableName: 'price_profiles' })
@Unique({
  properties: ['salesChannelId', 'currencyCode', 'precedenceVersion', 'keyHash'],
  name: 'price_profiles_key_unique',
})
export class PriceProfile {
  [OptionalProps]?: 'id' | 'uniformPercent' | 'builtAt' | 'servingGeneration' | 'stale' | 'markedAt' | 'revision';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 3, columnType: 'char(3)' })
  currencyCode!: string;

  @Property({ type: 'integer' })
  precedenceVersion!: number;

  @Property({ type: 'string', length: 64, columnType: 'char(64)' })
  keyHash!: string;

  @Property({ type: 'json' })
  bookVector!: Array<{ bookId: string; audienceKind: string; depth: number | null }>;

  /** Reserved for the *profile factor* mitigation (research R7); unused unless the bench requires it. */
  @Property({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  uniformPercent: string | null = null;

  @Property({ type: 'string', length: 16 })
  state!: 'building' | 'ready';

  @Property({ type: 'datetime', nullable: true })
  builtAt: Date | null = null;

  /** The generation of `price_profile_prices` readers are served (`contracts/price-surface.md` §3). */
  @Property({ type: 'integer', default: 0 })
  servingGeneration: number = 0;

  /** A pricing write since the served build: still served, rebuilt by the worker. */
  @Property({ type: 'boolean', default: false })
  stale: boolean = false;

  /** When the profile was last marked stale; a build clears `stale` only if nothing marked it after it began. */
  @Property({ type: 'datetime', nullable: true })
  markedAt: Date | null = null;

  /**
   * Moved by every build and every targeted refresh (`price_profile_stale_products`):
   * a targeted refresh replaces rows of the served generation without moving
   * it, so what keys a memo of the served rows is this.
   */
  @Property({ type: 'integer', default: 0 })
  revision: number = 0;
}
