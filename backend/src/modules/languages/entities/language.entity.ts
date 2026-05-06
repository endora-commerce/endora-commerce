import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Language — installation-wide pool of supported BCP-47 language tags
 * (T238 / FR-105). Exactly zero or one row has `isDefault=true`, enforced
 * by a partial unique index in the migration.
 */
@Entity({ tableName: 'languages' })
export class Language {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'isActive'
    | 'sortOrder'
    | 'nativeLabel'
    | 'isRtl'
    | 'fallbackCode';

  /** BCP-47 tag: `en-US`, `pl-PL`, `de`, …. Acts as the natural primary key. */
  @PrimaryKey({ type: 'string', length: 12 })
  code!: string;

  @Property({ type: 'string', length: 64 })
  label!: string;

  /** The language's name in itself (e.g. `Polski`, `Deutsch`). Added by feature 017. */
  @Property({ type: 'string', length: 64 })
  nativeLabel: string = '';

  @Property({ type: 'boolean' })
  isRtl: boolean = false;

  /** Optional fallback code for missing translations. Self-FK; cycles forbidden at the service layer. */
  @Property({ type: 'string', length: 12, nullable: true })
  fallbackCode?: string | null;

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
