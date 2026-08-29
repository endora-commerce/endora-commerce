import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * PriceDisplayModeOverride — per-Organization / per-Category / per-Product
 * override of the price display mode.
 *
 * Resolves alongside the platform defaults from the settings module
 * (`pricing.default_display_mode`, `pricing.unauthenticated_display_mode`)
 * via the chain Product → Category → Organization → Settings.
 *
 * Composite primary key on `(scope, targetId)` allows at most one override per
 * scope+target pair. The `targetId` is a polymorphic FK to the appropriate
 * table for `scope`; integrity is enforced at the service layer because the
 * target table varies (data-model.md §1.4).
 */
@GlobalEntity()
@Entity({ tableName: 'price_display_mode_overrides' })
export class PriceDisplayModeOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'string', length: 16 })
  scope!: 'organization' | 'category' | 'product';

  @PrimaryKey({ type: 'uuid' })
  targetId!: string;

  @Property({ type: 'string', length: 16 })
  mode!: 'gross_only' | 'net_only' | 'both' | 'none';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
