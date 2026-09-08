import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Organization → remote client, keyed per Infakt company (credential_code).
 * Unique `(adapter_id, organization_id, environment, credential_code)`.
 */
@OrgScoped()
@Entity({ tableName: 'invoice_ledger_client_maps' })
@Unique({ properties: ['adapterId', 'organizationId', 'environment', 'credentialCode'] })
export class InvoiceLedgerClientMap {
  [OptionalProps]?: 'id' | 'salesChannelId' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 64, fieldName: 'adapter_id' })
  adapterId!: string;

  @Property({ type: 'uuid', fieldName: 'organization_id' })
  @Index()
  organizationId!: string;

  @Property({ type: 'varchar', length: 32, fieldName: 'nip_used' })
  nipUsed!: string;

  @Property({ type: 'varchar', length: 64, fieldName: 'remote_client_id' })
  remoteClientId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'varchar', length: 128, fieldName: 'credential_code' })
  credentialCode!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'environment' })
  environment!: 'sandbox' | 'production';

  @Property({ type: 'timestamptz', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
