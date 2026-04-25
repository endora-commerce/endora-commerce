import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Currency — ISO 4217 codes the platform accepts (T238 / FR-105).
 * Exactly zero or one row has `isDefault=true`, enforced by a partial
 * unique index in the migration.
 */
@Entity({ tableName: 'currencies' })
export class Currency {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'isActive'
    | 'sortOrder';

  @PrimaryKey({ type: 'string', length: 3 })
  code!: string;

  @Property({ type: 'string', length: 64 })
  label!: string;

  @Property({ type: 'string', length: 8 })
  symbol!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'boolean' })
  isActive: boolean = true;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
