import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { SupportedAdminLanguage, TranslationBundleEntries } from '@endora-commerce/contracts';

/**
 * Translation Bundle — feature 019 / data-model.md §1.1.
 *
 * One row per `(module_id, language_code)`. JSONB `entries` carries the
 * flat translation key → string map. `version` defaults to
 * `nextval(translation_bundles_version_seq)` so every UPSERT bumps the
 * vector and the in-process resolver cache invalidates on its next
 * `MAX(version)` check (research §R9).
 *
 * No FK on `module_id` — see migration 040 for the rationale.
 */
@GlobalEntity()
@Entity({ tableName: 'translation_bundles' })
@Index({
  properties: ['languageCode'],
  name: 'idx_translation_bundles_language_code',
})
export class TranslationBundle {
  [OptionalProps]?: 'version' | 'installedAt' | 'updatedAt';

  @PrimaryKey({ type: 'string', length: 64 })
  moduleId!: string;

  @PrimaryKey({ type: 'string', length: 12 })
  languageCode!: SupportedAdminLanguage;

  @Property({ type: 'json', columnType: 'jsonb' })
  entries: TranslationBundleEntries = {};

  @Property({
    type: 'bigint',
    columnType: 'bigint',
    defaultRaw: "nextval('translation_bundles_version_seq')",
  })
  version!: number;

  @Property({ type: 'Date' })
  installedAt: Date = new Date();

  @Property({ type: 'Date', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
