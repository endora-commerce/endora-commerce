import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type {
  InvoiceLedgerDeliveryAttempt,
  InvoiceLedgerDeliveryKind,
  InvoiceLedgerDeliveryStatus,
  InvoiceLedgerKsefRouting,
  InvoiceLedgerNumberingMode,
} from '@endora-commerce/contracts';

/**
 * Durable ledger work item. UUID invoice_id only; no FK to invoices.
 * Frozen credential / environment / numbering / KSeF routing at enqueue —
 * and the buyer organization with them.
 *
 * ## Why the organization is a column here and not a chain hop
 *
 * It was `@TransitivelyScoped('Invoice', 'invoiceId')`, copied from
 * `KsefSubmission`, and the copy is where it went wrong: `ksef` declares
 * `invoices` in its manifest `dependencies`, so its parent is in every
 * composition `ksef` is in. `invoice_ledger` declares no such thing and
 * **cannot** — it is `nonDeactivatable`, and `module-composition.md` §4a is
 * explicit that a `dependencies` entry from a non-deactivatable module would
 * make `invoices.enabled` a dead switch, which is why the four port edges into
 * `invoices` are `nonBindingDependencies` instead.
 *
 * So a client's instance that installs the locked set and not `invoices` loads
 * this class and no `Invoice`, and the tenancy reconciliation refuses the boot
 * before a single migration runs — A3 of the instance acceptance criterion,
 * measured on pipeline 13835 and on no instrument before it, because this
 * repository composes every module and the parent is always there.
 *
 * The organization is frozen at enqueue exactly as the credential, the
 * environment, the numbering mode and the KSeF routing already are, which is
 * this row's own design rather than a new one; the FK is to `organizations`,
 * the module's own declared dependency, and the table below is where the
 * sibling `invoice_ledger_client_maps` already keeps it. There is still **no**
 * foreign key to `invoices` (`specs/119-infakt-integration/data-model.md` §3).
 */
@OrgScoped()
@Entity({ tableName: 'invoice_ledger_deliveries' })
@Unique({ properties: ['adapterId', 'invoiceId'] })
@Unique({ properties: ['adapterId', 'idempotencyKey'] })
export class InvoiceLedgerDelivery {
  [OptionalProps]?:
    | 'id'
    | 'salesChannelId'
    | 'asyncTaskId'
    | 'remoteDocumentId'
    | 'attemptCount'
    | 'attempts'
    | 'lastError'
    | 'remotePaidAt'
    | 'ksefDelegated'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 64, fieldName: 'adapter_id' })
  adapterId!: string;

  @Property({ type: 'uuid', fieldName: 'invoice_id' })
  invoiceId!: string;

  @Property({ type: 'uuid', fieldName: 'organization_id' })
  @Index()
  organizationId!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'kind' })
  kind!: InvoiceLedgerDeliveryKind;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'varchar', length: 128, fieldName: 'credential_code' })
  credentialCode!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'environment' })
  environment!: 'sandbox' | 'production';

  @Property({ type: 'varchar', length: 16, fieldName: 'numbering_mode' })
  numberingMode!: InvoiceLedgerNumberingMode;

  /**
   * Who submits this invoice to KSeF: `native` (the platform's own submission
   * path) or `vendor` (the accounting vendor this delivery goes to). **Stays in
   * this free module** (`specs/134-paid-module-extraction/` T067): KSeF is
   * Poland's statutory clearing system, not a vendor, and recording how an
   * invoice reached it is ledger routing, not coupling to the `ksef` module.
   * Do not remove it to "finish" that module's extraction;
   * `packages/contracts/src/statutory-ksef-state.test.ts` is the guard.
   */
  @Property({ type: 'varchar', length: 16, fieldName: 'ksef_routing' })
  ksefRouting!: InvoiceLedgerKsefRouting;

  @Property({ type: 'varchar', length: 24, fieldName: 'status' })
  @Index()
  status!: InvoiceLedgerDeliveryStatus;

  @Property({ type: 'varchar', length: 128, fieldName: 'async_task_id', nullable: true })
  asyncTaskId?: string | null;

  @Property({ type: 'varchar', length: 64, fieldName: 'remote_document_id', nullable: true })
  remoteDocumentId?: string | null;

  @Property({ type: 'varchar', length: 128, fieldName: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'integer', fieldName: 'attempt_count' })
  attemptCount: number = 0;

  @Property({ type: 'json', fieldName: 'attempts' })
  attempts: InvoiceLedgerDeliveryAttempt[] = [];

  @Property({ type: 'text', fieldName: 'last_error', nullable: true })
  lastError?: string | null;

  @Property({ type: 'timestamptz', fieldName: 'remote_paid_at', nullable: true })
  remotePaidAt?: Date | null;

  @Property({ type: 'boolean', fieldName: 'ksef_delegated' })
  ksefDelegated: boolean = false;

  @Property({ type: 'timestamptz', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'updated_at', onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
