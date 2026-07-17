import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import type { KnownIconName } from '@b2b/contracts';

/**
 * Module Action — feature 020 / data-model.md.
 *
 * One row per `(module_id, action_id)`. Written by the lifecycle install
 * hook from each module's manifest `actions` array; never edited by
 * hand. The `version` column defaults to `nextval(module_actions_version_seq)`
 * so every UPSERT bumps the vector — useful for cache diagnostics.
 *
 * No FK on `module_id` for the same reason as `translation_bundles`
 * (feature 019): modules are filesystem-driven and lifecycle ordering
 * already owns cleanup on hard-uninstall.
 */
@GlobalEntity()
@Entity({ tableName: 'module_actions' })
@Index({
  properties: ['weight', 'labelKey'],
  name: 'idx_module_actions_weight_label_key',
})
export class ModuleAction {
  [OptionalProps]?:
    | 'descriptionKey'
    | 'requiredPermission'
    | 'keywords'
    | 'weight'
    | 'version'
    | 'installedAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'string', length: 64 })
  moduleId!: string;

  @PrimaryKey({ type: 'string', length: 64 })
  actionId!: string;

  @Property({ type: 'string', length: 255 })
  labelKey!: string;

  @Property({ type: 'string', length: 255, nullable: true })
  descriptionKey: string | null = null;

  @Property({ type: 'string', length: 64 })
  icon!: KnownIconName;

  @Property({ type: 'string', length: 255 })
  targetRoute!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  requiredPermission: string | null = null;

  @Property({ type: 'json', columnType: 'jsonb' })
  keywords: string[] = [];

  @Property({ type: 'integer' })
  weight: number = 100;

  @Property({
    type: 'bigint',
    columnType: 'bigint',
    defaultRaw: "nextval('module_actions_version_seq')",
  })
  version!: number;

  @Property({ type: 'Date' })
  installedAt: Date = new Date();

  @Property({ type: 'Date', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
