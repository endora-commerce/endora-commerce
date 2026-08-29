import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * LanguageCountry — many-to-many association between Languages and the
 * Countries they are primarily associated with (feature 017).
 *
 * Used by storefront locale auto-detection ("user is in DE, prefer de-DE
 * if the channel offers it"). The `is_primary` flag pins at most one
 * primary Language per Country (partial unique index in the migration).
 */
@GlobalEntity()
@Entity({ tableName: 'language_countries' })
export class LanguageCountry {
  [OptionalProps]?: 'createdAt' | 'isPrimary';

  @PrimaryKey({ type: 'string', length: 12 })
  languageCode!: string;

  @PrimaryKey({ type: 'string', length: 2 })
  @Index()
  countryCode!: string;

  @Property({ type: 'boolean' })
  isPrimary: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
