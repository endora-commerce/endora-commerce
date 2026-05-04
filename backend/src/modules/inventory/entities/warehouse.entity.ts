import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Warehouse — a physical or logical stocking location (feature 010).
 *
 * The seeded `Default` warehouse uses the deterministic UUID
 * `00000000-0000-4000-8000-00000000d017` so retried migrations stay
 * idempotent and other modules can reference it from fixtures.
 */
export interface WarehouseAddress {
  street?: string | null | undefined;
  city?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string | null | undefined;
}

export const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
export const DEFAULT_WAREHOUSE_CODE = 'default';

@Entity({ tableName: 'warehouses' })
export class Warehouse {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'active'
    | 'description'
    | 'address'
    | 'contactName'
    | 'contactEmail'
    | 'contactPhone';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'boolean' })
  @Index()
  active: boolean = true;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json', nullable: true })
  address?: WarehouseAddress | null;

  @Property({ type: 'string', length: 160, nullable: true })
  contactName?: string | null;

  @Property({ type: 'string', length: 320, nullable: true })
  contactEmail?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  contactPhone?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
