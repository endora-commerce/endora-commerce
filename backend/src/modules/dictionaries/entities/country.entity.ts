import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Country — ISO 3166-1 alpha-2 territories the platform recognises (feature 017).
 * The natural code is the stable handle every consumer module references
 * (Address, Tax, Warehouse, Organisation registered address). The "exactly
 * one default" invariant is enforced by a partial unique index in the
 * migration. Hard-delete is service-layer guarded: refused while any
 * consumer references the row (FR-021).
 */
@Entity({ tableName: 'countries' })
export class Country {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'isActive'
    | 'sortOrder'
    | 'isEuMember'
    | 'subregion'
    | 'dialCode'
    | 'defaultCurrencyCode';

  /** ISO 3166-1 alpha-2 code, immutable. Stable handle for every reference. */
  @PrimaryKey({ type: 'string', length: 2 })
  code!: string;

  @Property({ type: 'string', length: 3, fieldName: 'alpha3_code' })
  alpha3Code!: string;

  /** Zero-padded ISO 3166-1 numeric code (e.g. `616` for `PL`). */
  @Property({ type: 'string', length: 3, fieldName: 'numeric_code' })
  numericCode!: string;

  /** Canonical English display name. Per-locale overrides live in `dictionary_translations`. */
  @Property({ type: 'string', length: 120 })
  label!: string;

  /** UN-style top-level region (`Africa`, `Americas`, `Asia`, `Europe`, `Oceania`, `Antarctic`). */
  @Property({ type: 'string', length: 32 })
  region!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  subregion?: string | null;

  /** Phone-prefix string with leading `+` (e.g. `+48`). */
  @Property({ type: 'string', length: 8, nullable: true })
  dialCode?: string | null;

  /** Drives VAT logic in the Tax module. */
  @Property({ type: 'boolean' })
  isEuMember: boolean = false;

  /** Hint for storefront pre-selection; soft FK to `currencies(code)`. */
  @Property({ type: 'string', length: 3, nullable: true })
  defaultCurrencyCode?: string | null;

  @Property({ type: 'boolean' })
  @Index()
  isActive: boolean = true;

  /** Exactly one row has `true` (partial unique index). */
  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  sortOrder: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
