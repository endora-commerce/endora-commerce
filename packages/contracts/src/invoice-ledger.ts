import { z } from 'zod';
import { listQuerySchema } from './pagination.js';

/**
 * Shared invoice-ledger vocabulary — feature 119 (`invoice_ledger` package).
 * Infakt-specific HTTP and connection DTOs live in `infakt.ts`.
 */

export const INVOICE_LEDGER_NUMBERING_MODES = ['endora', 'vendor'] as const;
export const invoiceLedgerNumberingModeSchema = z.enum(INVOICE_LEDGER_NUMBERING_MODES);
export type InvoiceLedgerNumberingMode = z.infer<typeof invoiceLedgerNumberingModeSchema>;

/**
 * Who submits a delivered invoice to KSeF — the platform's own path (`native`)
 * or the accounting vendor (`vendor`). Free vocabulary on purpose (feature 134,
 * T067): KSeF is Poland's statutory clearing system, not a vendor, and the
 * routing to it belongs to the free ledger, not to the `ksef` module.
 */
export const INVOICE_LEDGER_KSEF_ROUTINGS = ['native', 'vendor'] as const;
export const invoiceLedgerKsefRoutingSchema = z.enum(INVOICE_LEDGER_KSEF_ROUTINGS);
export type InvoiceLedgerKsefRouting = z.infer<typeof invoiceLedgerKsefRoutingSchema>;

export const INVOICE_LEDGER_NATIVE_KSEF_ACTIONS = ['submit', 'skip'] as const;
export const invoiceLedgerNativeKsefActionSchema = z.enum(INVOICE_LEDGER_NATIVE_KSEF_ACTIONS);
export type InvoiceLedgerNativeKsefAction = z.infer<typeof invoiceLedgerNativeKsefActionSchema>;

export const INVOICE_LEDGER_DELIVERY_STATUSES = [
  'queued',
  'awaiting_remote',
  'succeeded',
  'failed',
  'dead',
] as const;
export const invoiceLedgerDeliveryStatusSchema = z.enum(INVOICE_LEDGER_DELIVERY_STATUSES);
export type InvoiceLedgerDeliveryStatus = z.infer<typeof invoiceLedgerDeliveryStatusSchema>;

export const INVOICE_LEDGER_DELIVERY_KINDS = ['invoice', 'correction'] as const;
export const invoiceLedgerDeliveryKindSchema = z.enum(INVOICE_LEDGER_DELIVERY_KINDS);
export type InvoiceLedgerDeliveryKind = z.infer<typeof invoiceLedgerDeliveryKindSchema>;

export const INVOICE_LEDGER_SETTING_CODES = {
  NUMBERING_MODE: 'invoice_ledger.numbering.mode',
  KSEF_ROUTING: 'invoice_ledger.ksef.routing',
} as const;

export const INVOICE_LEDGER_READ_PERMISSION = 'invoice_ledger:read';
export const INVOICE_LEDGER_WRITE_PERMISSION = 'invoice_ledger:write';

export const INVOICE_LEDGER_REGISTRY_PORT = 'invoiceLedgerRegistryPort' as const;
export const INVOICE_LEDGER_ROUTING_PORT = 'invoiceLedgerRoutingPort' as const;
export const INVOICE_LEDGER_DELIVERY_PORT = 'invoiceLedgerDeliveryPort' as const;
export const INVOICE_LEDGER_WEBHOOK_PORT = 'invoiceLedgerWebhookPort' as const;
export const INVOICE_LEDGER_DELIVERY_QUEUED_EVENT = 'invoice_ledger.delivery.queued.v1' as const;
export const INVOICE_LEDGER_VENDOR_FREEZE_REGISTRY = 'invoiceLedgerVendorFreezeRegistry' as const;

export const INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE =
  'KSeF is delegated to the ledger vendor but no vendor is active.';
export const INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR =
  'The ledger vendor returned an unreadable error.';
export const INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE =
  'The ledger vendor could not create this invoice.';
export const INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE =
  'The ledger vendor could not send this invoice to KSeF.';

export interface InvoiceLedgerVendorFreeze {
  credentialCode: string;
  environment: 'sandbox' | 'production';
}

/**
 * Container name: `invoiceLedgerVendorFreezeRegistry`. Owner: `invoice_ledger`.
 *
 * A contribution seam (plain `di.register`, not `providePort`). Vendors push a
 * freeze resolver keyed by `adapterId` from a boot hook. Ledger HTTP stays out
 * of this registry; each vendor reads its own credentials.
 */
export interface InvoiceLedgerVendorFreezeRegistryPort {
  register(
    adapterId: string,
    resolve: (salesChannelId: string | null) => Promise<InvoiceLedgerVendorFreeze>,
    module: string,
  ): void;
  resolve(
    adapterId: string,
    salesChannelId: string | null,
  ): Promise<InvoiceLedgerVendorFreeze | null>;
}

// Feature 132 — `INVOICE_LEDGER_MODULES` is **gone**. The vendor family is declared
// by its members (`capabilities: ['invoice-ledger-vendor']`) and derived by the
// platform; `invoice_ledger` owns the key and mints the refusal code.

/**
 * Container name: `invoiceLedgerRegistryPort`. Owner: `invoice_ledger`.
 */
export interface InvoiceLedgerRegistryPort {
  /** Refuses when another invoice-ledger vendor's activation Setting is true. */
  assertCanActivate(moduleId: string): Promise<void>;
  recordActive(moduleId: string, adminId: string | null): Promise<void>;
  clearActive(moduleId: string): Promise<void>;
  getActiveModuleId(): Promise<string | null>;
}

/**
 * Container name: `invoiceLedgerRoutingPort`. Owner: `invoice_ledger`.
 *
 * `numberingModeFor` reads the numbering Setting (channel then instance). It
 * MAY return `endora` when no vendor is active. It MUST NOT drive native KSeF.
 *
 * `nativeKsefActionFor` follows `invoice_ledger.ksef.routing` only (F1):
 * routing `vendor` ⇒ `skip` even when Infakt / vendor is off; routing `native`
 * ⇒ `submit`. It MUST NOT consult vendor presence.
 */
export interface InvoiceLedgerRoutingPort {
  numberingModeFor(salesChannelId: string | null): Promise<InvoiceLedgerNumberingMode>;
  nativeKsefActionFor(salesChannelId: string | null): Promise<InvoiceLedgerNativeKsefAction>;
  activeVendorModuleId(): Promise<string | null>;
}

export const invoiceLedgerDeliveryAttemptSchema = z.object({
  status: invoiceLedgerDeliveryStatusSchema,
  at: z.string().datetime(),
  error: z.string().nullable(),
  /** The vendor-assigned document number on a succeeded attempt (feature 129). */
  remoteVendorNumber: z.string().nullable().optional(),
});
export type InvoiceLedgerDeliveryAttempt = z.infer<typeof invoiceLedgerDeliveryAttemptSchema>;

export const ledgerDeliveryRecordSchema = z.object({
  id: z.string().uuid(),
  adapterId: z.string().min(1),
  invoiceId: z.string().uuid(),
  kind: invoiceLedgerDeliveryKindSchema,
  salesChannelId: z.string().uuid().nullable(),
  credentialCode: z.string().min(1),
  environment: z.enum(['sandbox', 'production']),
  numberingMode: invoiceLedgerNumberingModeSchema,
  ksefRouting: invoiceLedgerKsefRoutingSchema,
  status: invoiceLedgerDeliveryStatusSchema,
  asyncTaskId: z.string().nullable(),
  remoteDocumentId: z.string().nullable(),
  idempotencyKey: z.string().min(1),
  attemptCount: z.number().int().nonnegative(),
  attempts: z.array(invoiceLedgerDeliveryAttemptSchema),
  lastError: z.string().nullable(),
  remotePaidAt: z.string().datetime().nullable(),
  remoteVendorNumber: z.string().nullable(),
  ksefDelegated: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LedgerDeliveryRecord = z.infer<typeof ledgerDeliveryRecordSchema>;

export const invoiceLedgerDeliveryQueuedEventSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  deliveryId: z.string().uuid(),
  adapterId: z.string().min(1),
});
export type InvoiceLedgerDeliveryQueuedEvent = z.infer<typeof invoiceLedgerDeliveryQueuedEventSchema>;

export interface InvoiceLedgerEnqueueInput {
  adapterId: string;
  invoiceId: string;
  /**
   * The buyer organization, frozen on the delivery row at enqueue.
   *
   * It is the row's tenant key rather than something the reader recovers by
   * joining `invoices`: `invoice_ledger` is `nonDeactivatable` and may not
   * declare `invoices` in its manifest `dependencies`, so an instance can
   * compose this module with no `Invoice` entity registered at all. The caller
   * resolves it through `invoiceCopyHostPort`, which is the only way this
   * module learns anything about an invoice.
   */
  organizationId: string;
  kind: InvoiceLedgerDeliveryKind;
  salesChannelId: string | null;
  credentialCode: string;
  environment: 'sandbox' | 'production';
  numberingMode: InvoiceLedgerNumberingMode;
  ksefRouting: InvoiceLedgerKsefRouting;
  ksefDelegated: boolean;
}

export interface InvoiceLedgerClientMapInput {
  adapterId: string;
  organizationId: string;
  nipUsed: string;
  remoteClientId: string;
  credentialCode: string;
  environment: 'sandbox' | 'production';
  salesChannelId: string | null;
}

/**
 * Container name: `invoiceLedgerDeliveryPort`. Owner: `invoice_ledger`.
 */
export interface InvoiceLedgerDeliveryPort {
  getById(id: string): Promise<LedgerDeliveryRecord | null>;
  findByInvoice(adapterId: string, invoiceId: string): Promise<LedgerDeliveryRecord | null>;
  enqueue(input: InvoiceLedgerEnqueueInput): Promise<LedgerDeliveryRecord>;
  enqueueClosed(
    input: InvoiceLedgerEnqueueInput,
    error: string,
    opts?: { dead?: boolean },
  ): Promise<LedgerDeliveryRecord>;
  markAwaitingRemote(
    id: string,
    asyncTaskId: string,
    opts?: {
      remoteDocumentId?: string;
      originalInvoiceId?: string | null;
      remoteVendorNumber?: string | null;
    },
  ): Promise<void>;
  markSucceeded(
    id: string,
    remoteDocumentId: string,
    opts?: { originalInvoiceId?: string | null; remoteVendorNumber?: string | null },
  ): Promise<void>;
  markFailed(id: string, error: string, opts?: { dead?: boolean }): Promise<void>;
  rememberClient(input: InvoiceLedgerClientMapInput): Promise<void>;
  findClientRemoteId(input: {
    adapterId: string;
    organizationId: string;
    environment: 'sandbox' | 'production';
    credentialCode: string;
  }): Promise<string | null>;
  findDocumentRemoteId(input: { adapterId: string; invoiceId: string }): Promise<string | null>;
  /**
   * T089 unique-map: exactly one row for
   * `(adapter_id, remote_document_id, environment, credential_code)` when those
   * are named. Omit environment / credential_code when the caller cannot name
   * the company — zero or two-plus matches on the remaining key return null.
   */
  lookupUniqueMappedInvoice(input: {
    adapterId: string;
    remoteDocumentId: string;
    environment?: 'sandbox' | 'production';
    credentialCode?: string;
  }): Promise<{ invoiceId: string } | null>;
  markRemotePaid(id: string): Promise<void>;
  /** Keep status `queued` and persist a mapped wait sentence on `last_error`. */
  recordQueuedWait(id: string, error: string): Promise<void>;
}

/**
 * Container name: `invoiceLedgerWebhookPort`. Owner: `invoice_ledger`.
 * Authenticated Infakt events only. HMAC lives on the Infakt route.
 */
export interface InvoiceLedgerWebhookEventInput {
  adapterId: string;
  eventId: string;
  eventType: string;
  remoteDocumentId: string | null;
  vendorNumber: string | null;
  asyncTaskId: string | null;
  ksefReferenceNumber: string | null;
  errorMessage: string | null;
}

export interface InvoiceLedgerWebhookPort {
  handleAuthenticatedEvent(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<{ outcome: 'applied' | 'duplicate' | 'acknowledged' }>;
}

export const invoiceLedgerChannelOverrideSchema = z.object({
  salesChannelId: z.string().uuid(),
  numberingMode: invoiceLedgerNumberingModeSchema.optional(),
  ksefRouting: invoiceLedgerKsefRoutingSchema.optional(),
});
export type InvoiceLedgerChannelOverride = z.infer<typeof invoiceLedgerChannelOverrideSchema>;

export const invoiceLedgerRoutingDtoSchema = z.object({
  numberingMode: invoiceLedgerNumberingModeSchema,
  ksefRouting: invoiceLedgerKsefRoutingSchema,
  activeVendorModuleId: z.string().nullable(),
  channelOverrides: z.array(invoiceLedgerChannelOverrideSchema),
});
export type InvoiceLedgerRoutingDto = z.infer<typeof invoiceLedgerRoutingDtoSchema>;

export const invoiceLedgerRoutingWriteBodySchema = z.object({
  numberingMode: invoiceLedgerNumberingModeSchema.optional(),
  ksefRouting: invoiceLedgerKsefRoutingSchema.optional(),
  confirm: z.boolean().optional(),
  channelOverrides: z.array(invoiceLedgerChannelOverrideSchema).optional(),
});
export type InvoiceLedgerRoutingWriteBody = z.infer<typeof invoiceLedgerRoutingWriteBodySchema>;

export const invoiceLedgerDeliveryListItemSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().nullable(),
  adapterId: z.string(),
  status: invoiceLedgerDeliveryStatusSchema,
  lastError: z.string().nullable(),
  environment: z.string(),
  remoteDocumentId: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type InvoiceLedgerDeliveryListItem = z.infer<typeof invoiceLedgerDeliveryListItemSchema>;

export const invoiceLedgerDeliveryListQuerySchema = listQuerySchema.extend({
  status: invoiceLedgerDeliveryStatusSchema.optional(),
  salesChannelId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
});
export type InvoiceLedgerDeliveryListQuery = z.infer<typeof invoiceLedgerDeliveryListQuerySchema>;
