import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * InventoryThreshold — display-band thresholds (high / medium / low)
 * scoped at one of three levels: global (one row), category (one row
 * per category), product (one row per product).
 *
 * Category and product thresholds also live directly on the respective
 * entities for read-path performance; this table holds the global
 * row as the canonical source and is mirrored from the settings
 * module via `threshold-settings-mirror.ts`.
 */
export type InventoryThresholdScopeKind = 'global' | 'category' | 'product';

@Entity({ tableName: 'inventory_thresholds' })
export class InventoryThreshold {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'scopeId'
    | 'thresholdHigh'
    | 'thresholdMedium'
    | 'thresholdLow';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  scopeKind!: InventoryThresholdScopeKind;

  @Property({ type: 'uuid', nullable: true })
  scopeId?: string | null;

  @Property({ type: 'integer', nullable: true })
  thresholdHigh?: number | null;

  @Property({ type: 'integer', nullable: true })
  thresholdMedium?: number | null;

  @Property({ type: 'integer', nullable: true })
  thresholdLow?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
