import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * A pricing profile of the price surface (feature 160, research R6–R7,
 * data-model §6): the buyers of one channel and currency who meet the same
 * applicable buyer books at the same chain depths, under one precedence
 * version. `bookVector` is the sorted `[{ bookId, audienceKind, depth }]`;
 * `[]` is the everyone profile. Written only by the surface worker and the
 * synchronous profile-miss build, never by an admin write.
 */
@RuleScoped()
@Entity({ tableName: 'price_profiles' })
@Unique({
  properties: ['salesChannelId', 'currencyCode', 'precedenceVersion', 'keyHash'],
  name: 'price_profiles_key_unique',
})
export class PriceProfile {
  [OptionalProps]?: 'id' | 'uniformPercent' | 'builtAt';

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
}
