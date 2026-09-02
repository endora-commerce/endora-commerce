import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** Fixed primary key — one diagnostic row per deployment (feature 089, data-model.md). */
export const PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Mirrors the last successful PIM connector activation write for audit/diagnostics.
 * Authoritative mutual-exclusion checks read sibling activation Settings.
 */
@GlobalEntity()
@Entity({ tableName: 'pim_connector_activation_lock' })
export class PimConnectorActivationLock {
  [OptionalProps]?: 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = PIM_CONNECTOR_ACTIVATION_LOCK_SINGLETON_ID;

  @Property({ type: 'varchar', length: 64, fieldName: 'active_module_id', nullable: true })
  activeModuleId?: string | null;

  @Property({ type: 'timestamptz', fieldName: 'updated_at' })
  updatedAt: Date = new Date();

  @Property({ type: 'uuid', fieldName: 'updated_by_admin_id', nullable: true })
  updatedByAdminId?: string | null;
}
