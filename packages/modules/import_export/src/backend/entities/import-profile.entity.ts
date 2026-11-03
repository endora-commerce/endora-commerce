import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { PimLocaleMappingEntry } from '@endora-commerce/contracts';
import { randomUUID } from 'node:crypto';

/**
 * A named locale mapping a products import runs with (`specs/170-product-editor-scope-switcher/`
 * `data-model.md` §11, research R14; FR-048).
 *
 * Platform-global configuration (Principle XI): a profile describes how a source file's locales
 * land on this shop's channels and languages, shared by every operator with `catalog:write`; no
 * tenant data is in it. The name is unique case-insensitively through the migration's raw
 * `lower(name)` index, so the entity declares no `@Unique`.
 *
 * Written only by the module's Commands (`commands/import-profile.commands.ts`).
 */
@GlobalEntity()
@Entity({ tableName: 'import_profiles' })
export class ImportProfile {
  [OptionalProps]?: 'id' | 'sourceLanguageForGlobal' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 120 })
  name!: string;

  @Property({ type: 'string', length: 32 })
  entity!: 'products';

  @Property({ type: 'string', length: 16, nullable: true })
  sourceLanguageForGlobal: string | null = null;

  @Property({ type: 'json' })
  localeMapping!: PimLocaleMappingEntry[];

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
