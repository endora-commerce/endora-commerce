import { z } from 'zod';

/**
 * Shared invoice-ledger vocabulary — feature 119 (`invoice_ledger` package).
 * Infakt-specific HTTP and connection DTOs live in `infakt.ts`.
 */

export const INVOICE_LEDGER_NUMBERING_MODES = ['endora', 'vendor'] as const;
export const invoiceLedgerNumberingModeSchema = z.enum(INVOICE_LEDGER_NUMBERING_MODES);
export type InvoiceLedgerNumberingMode = z.infer<typeof invoiceLedgerNumberingModeSchema>;

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
export const INVOICE_LEDGER_DELIVERY_QUEUED_EVENT = 'invoice_ledger.delivery.queued.v1' as const;

/**
 * Known invoice-ledger vendor modules and their activation setting codes.
 * Consumed by the mutex registry. Production second vendors arrive in a later spec.
 */
export const INVOICE_LEDGER_MODULES = [
  { id: 'infakt', activationSettingCode: 'infakt.activation' },
] as const;

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
  markAwaitingRemote(id: string, asyncTaskId: string): Promise<void>;
  markSucceeded(id: string, remoteDocumentId: string): Promise<void>;
  markFailed(id: string, error: string, opts?: { dead?: boolean }): Promise<void>;
  rememberClient(input: InvoiceLedgerClientMapInput): Promise<void>;
  findClientRemoteId(input: {
    adapterId: string;
    organizationId: string;
    environment: 'sandbox' | 'production';
    credentialCode: string;
  }): Promise<string | null>;
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
  updatedAt: z.string().datetime(),
});
export type InvoiceLedgerDeliveryListItem = z.infer<typeof invoiceLedgerDeliveryListItemSchema>;
