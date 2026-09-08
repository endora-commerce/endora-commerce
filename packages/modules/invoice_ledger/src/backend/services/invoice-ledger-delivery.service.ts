import type { EntityManager } from '@mikro-orm/postgresql';
import {
  type InvoiceLedgerClientMapInput,
  type InvoiceLedgerDeliveryAttempt,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerEnqueueInput,
  type LedgerDeliveryRecord,
} from '@endora-commerce/contracts';
import { InvoiceLedgerClientMap } from '../entities/invoice-ledger-client-map.entity.js';
import { InvoiceLedgerDelivery } from '../entities/invoice-ledger-delivery.entity.js';
import { InvoiceLedgerDocumentMap } from '../entities/invoice-ledger-document-map.entity.js';

function toRecord(row: InvoiceLedgerDelivery): LedgerDeliveryRecord {
  return {
    id: row.id,
    adapterId: row.adapterId,
    invoiceId: row.invoiceId,
    kind: row.kind,
    salesChannelId: row.salesChannelId ?? null,
    credentialCode: row.credentialCode,
    environment: row.environment,
    numberingMode: row.numberingMode,
    ksefRouting: row.ksefRouting,
    status: row.status,
    asyncTaskId: row.asyncTaskId ?? null,
    remoteDocumentId: row.remoteDocumentId ?? null,
    idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    remotePaidAt: row.remotePaidAt ? row.remotePaidAt.toISOString() : null,
    ksefDelegated: row.ksefDelegated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function appendAttempt(
  row: InvoiceLedgerDelivery,
  status: InvoiceLedgerDeliveryAttempt['status'],
  error: string | null,
): void {
  const attempt: InvoiceLedgerDeliveryAttempt = {
    status,
    at: new Date().toISOString(),
    error,
  };
  row.attempts = [...row.attempts, attempt];
  row.attemptCount = row.attempts.length;
  row.lastError = error;
}

export const INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE =
  'KSeF is delegated to the ledger vendor but no vendor is active.';

export class InvoiceLedgerDeliveryService implements InvoiceLedgerDeliveryPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async getById(id: string): Promise<LedgerDeliveryRecord | null> {
    const row = await this.emFactory().findOne(InvoiceLedgerDelivery, { id });
    return row ? toRecord(row) : null;
  }

  async findByInvoice(adapterId: string, invoiceId: string): Promise<LedgerDeliveryRecord | null> {
    const row = await this.emFactory().findOne(InvoiceLedgerDelivery, { adapterId, invoiceId });
    return row ? toRecord(row) : null;
  }

  async enqueue(input: InvoiceLedgerEnqueueInput): Promise<LedgerDeliveryRecord> {
    const em = this.emFactory();
    const existing = await em.findOne(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
    });
    if (existing) return toRecord(existing);

    const row = em.create(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
      kind: input.kind,
      salesChannelId: input.salesChannelId,
      credentialCode: input.credentialCode,
      environment: input.environment,
      numberingMode: input.numberingMode,
      ksefRouting: input.ksefRouting,
      ksefDelegated: input.ksefDelegated,
      status: 'queued',
      idempotencyKey: `${input.adapterId}:${input.invoiceId}`,
    });
    await em.flush();
    return toRecord(row);
  }

  async enqueueClosed(
    input: InvoiceLedgerEnqueueInput,
    error: string,
    opts?: { dead?: boolean },
  ): Promise<LedgerDeliveryRecord> {
    const em = this.emFactory();
    const existing = await em.findOne(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
    });
    if (existing) return toRecord(existing);

    const status = opts?.dead ? 'dead' : 'failed';
    const row = em.create(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
      kind: input.kind,
      salesChannelId: input.salesChannelId,
      credentialCode: input.credentialCode,
      environment: input.environment,
      numberingMode: input.numberingMode,
      ksefRouting: input.ksefRouting,
      ksefDelegated: input.ksefDelegated,
      status,
      idempotencyKey: `${input.adapterId}:${input.invoiceId}`,
    });
    appendAttempt(row, status, error);
    await em.flush();
    return toRecord(row);
  }

  async markAwaitingRemote(id: string, asyncTaskId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.asyncTaskId = asyncTaskId;
    row.status = 'awaiting_remote';
    appendAttempt(row, 'awaiting_remote', null);
    await em.flush();
  }

  async markSucceeded(
    id: string,
    remoteDocumentId: string,
    opts?: { originalInvoiceId?: string | null },
  ): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.remoteDocumentId = remoteDocumentId;
    row.status = 'succeeded';
    appendAttempt(row, 'succeeded', null);

    let map = await em.findOne(InvoiceLedgerDocumentMap, {
      adapterId: row.adapterId,
      invoiceId: row.invoiceId,
    });
    const originalInvoiceId = opts?.originalInvoiceId ?? null;
    if (map === null) {
      map = em.create(InvoiceLedgerDocumentMap, {
        adapterId: row.adapterId,
        invoiceId: row.invoiceId,
        originalInvoiceId,
        remoteDocumentId,
        environment: row.environment,
        credentialCode: row.credentialCode,
      });
    } else {
      map.remoteDocumentId = remoteDocumentId;
      map.environment = row.environment;
      map.credentialCode = row.credentialCode;
      if (originalInvoiceId) map.originalInvoiceId = originalInvoiceId;
    }
    await em.flush();
  }

  async rememberClient(input: InvoiceLedgerClientMapInput): Promise<void> {
    const em = this.emFactory();
    let row = await em.findOne(InvoiceLedgerClientMap, {
      adapterId: input.adapterId,
      organizationId: input.organizationId,
      environment: input.environment,
      credentialCode: input.credentialCode,
    });
    if (row === null) {
      row = em.create(InvoiceLedgerClientMap, {
        adapterId: input.adapterId,
        organizationId: input.organizationId,
        nipUsed: input.nipUsed,
        remoteClientId: input.remoteClientId,
        credentialCode: input.credentialCode,
        environment: input.environment,
        salesChannelId: input.salesChannelId,
      });
    } else {
      row.nipUsed = input.nipUsed;
      row.remoteClientId = input.remoteClientId;
      row.salesChannelId = input.salesChannelId;
    }
    await em.flush();
  }

  async findClientRemoteId(input: {
    adapterId: string;
    organizationId: string;
    environment: 'sandbox' | 'production';
    credentialCode: string;
  }): Promise<string | null> {
    const row = await this.emFactory().findOne(InvoiceLedgerClientMap, {
      adapterId: input.adapterId,
      organizationId: input.organizationId,
      environment: input.environment,
      credentialCode: input.credentialCode,
    });
    return row?.remoteClientId ?? null;
  }

  async findDocumentRemoteId(input: {
    adapterId: string;
    invoiceId: string;
  }): Promise<string | null> {
    const row = await this.emFactory().findOne(InvoiceLedgerDocumentMap, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
    });
    return row?.remoteDocumentId ?? null;
  }

  async markFailed(id: string, error: string, opts?: { dead?: boolean }): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.status = opts?.dead ? 'dead' : 'failed';
    appendAttempt(row, row.status, error);
    await em.flush();
  }
}
