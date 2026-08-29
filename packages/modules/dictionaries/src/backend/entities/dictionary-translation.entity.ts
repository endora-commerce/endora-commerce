import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * DictionaryTranslation — per-Language display-label override for a Country,
 * Currency, or Language entry (feature 017 / R3).
 *
 * Polymorphic by `entryType`. Postgres cannot enforce a polymorphic FK to
 * three different parent tables, so the parent-existence invariant is
 * enforced at the service layer (`TranslationService.upsert`) inside the
 * same transaction that performs the write. The `language_code` FK to
 * `languages(code)` IS database-enforced — that's the only side the schema
 * knows is uniform. ON DELETE CASCADE there: hard-deleting a Language
 * wipes its translations everywhere.
 */
@GlobalEntity()
@Entity({ tableName: 'dictionary_translations' })
export class DictionaryTranslation {
  [OptionalProps]?: 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'string', length: 16 })
  entryType!: 'country' | 'currency' | 'language';

  /** The natural code of the parent entry. 2 chars for country, 3 for currency, 2..12 for language. */
  @PrimaryKey({ type: 'string', length: 12 })
  entryCode!: string;

  /** The locale this translation is FOR. FK to `languages(code)` ON DELETE CASCADE. */
  @PrimaryKey({ type: 'string', length: 12 })
  @Index()
  languageCode!: string;

  @Property({ type: 'string', length: 160 })
  label!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
