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
import { mappedDeliveryError } from './mapped-delivery-error.js';

function remoteVendorNumberFromAttempts(
  attempts: InvoiceLedgerDeliveryAttempt[],
): string | null {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i];
    if (attempt?.status === 'succeeded' && attempt.remoteVendorNumber) {
      return attempt.remoteVendorNumber;
    }
  }
  return null;
}

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
    lastError: mappedDeliveryError(row.lastError ?? null),
    remotePaidAt: row.remotePaidAt ? row.remotePaidAt.toISOString() : null,
    remoteVendorNumber: remoteVendorNumberFromAttempts(row.attempts),
    ksefDelegated: row.ksefDelegated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function appendAttempt(
  row: InvoiceLedgerDelivery,
  status: InvoiceLedgerDeliveryAttempt['status'],
  error: string | null,
  opts?: { remoteVendorNumber?: string | null },
): void {
  const attempt: InvoiceLedgerDeliveryAttempt = {
    status,
    at: new Date().toISOString(),
    error,
    ...(opts?.remoteVendorNumber
      ? { remoteVendorNumber: opts.remoteVendorNumber }
      : {}),
  };
  row.attempts = [...row.attempts, attempt];
  row.attemptCount = row.attempts.length;
  row.lastError = mappedDeliveryError(error);
}


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
    // command-coverage-ignore: ledger delivery queue stamp — the row is the
    // worker's job token; connection / routing / retry stay on CommandBus.
    const em = this.emFactory();
    const existing = await em.findOne(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
    });
    if (existing) return toRecord(existing);

    const row = em.create(InvoiceLedgerDelivery, {
      adapterId: input.adapterId,
      invoiceId: input.invoiceId,
      organizationId: input.organizationId,
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
    // command-coverage-ignore: ledger delivery queue stamp for a copy that
    // never leaves the platform (missing NIP, Infakt off, proforma).
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
      organizationId: input.organizationId,
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

  async markAwaitingRemote(
    id: string,
    asyncTaskId: string,
    opts?: {
      remoteDocumentId?: string;
      originalInvoiceId?: string | null;
      remoteVendorNumber?: string | null;
    },
  ): Promise<void> {
    // command-coverage-ignore: Infakt worker queue stamp — parks the delivery
    // on the vendor async-task id until the webhook or poll completes.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.asyncTaskId = asyncTaskId;
    row.status = 'awaiting_remote';
    appendAttempt(row, 'awaiting_remote', null, {
      remoteVendorNumber: opts?.remoteVendorNumber ?? null,
    });

    const remoteDocumentId = opts?.remoteDocumentId;
    if (remoteDocumentId) {
      row.remoteDocumentId = remoteDocumentId;
      let map = await em.findOne(InvoiceLedgerDocumentMap, {
        adapterId: row.adapterId,
        invoiceId: row.invoiceId,
      });
      const originalInvoiceId = opts?.originalInvoiceId ?? null;
      if (map === null) {
        map = em.create(InvoiceLedgerDocumentMap, {
          adapterId: row.adapterId,
          invoiceId: row.invoiceId,
          organizationId: row.organizationId,
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
    }

    await em.flush();
  }

  async markSucceeded(
    id: string,
    remoteDocumentId: string,
    opts?: { originalInvoiceId?: string | null; remoteVendorNumber?: string | null },
  ): Promise<void> {
    // command-coverage-ignore: Infakt worker queue stamp plus the document-map
    // projection the webhook lookup uses.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.remoteDocumentId = remoteDocumentId;
    row.status = 'succeeded';
    appendAttempt(row, 'succeeded', null, {
      remoteVendorNumber: opts?.remoteVendorNumber ?? null,
    });

    let map = await em.findOne(InvoiceLedgerDocumentMap, {
      adapterId: row.adapterId,
      invoiceId: row.invoiceId,
    });
    const originalInvoiceId = opts?.originalInvoiceId ?? null;
    if (map === null) {
      map = em.create(InvoiceLedgerDocumentMap, {
        adapterId: row.adapterId,
        invoiceId: row.invoiceId,
        // The delivery froze the buyer organization at enqueue and this is its
        // projection, so the map takes the row's value rather than resolving
        // the invoice a second time — two reads of one fact are two answers
        // waiting to disagree, and the second one would need `invoices` to be
        // composed, which is what this column exists to stop needing.
        organizationId: row.organizationId,
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
    // command-coverage-ignore: Infakt worker stamp of the org → remote client
    // map; not an operator write.
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

  async lookupUniqueMappedInvoice(input: {
    adapterId: string;
    remoteDocumentId: string;
    environment?: 'sandbox' | 'production';
    credentialCode?: string;
  }): Promise<{ invoiceId: string } | null> {
    const where: {
      adapterId: string;
      remoteDocumentId: string;
      environment?: 'sandbox' | 'production';
      credentialCode?: string;
    } = {
      adapterId: input.adapterId,
      remoteDocumentId: input.remoteDocumentId,
    };
    if (input.environment) where.environment = input.environment;
    if (input.credentialCode) where.credentialCode = input.credentialCode;
    const maps = await this.emFactory().find(InvoiceLedgerDocumentMap, where);
    if (maps.length !== 1) return null;
    const invoiceId = maps[0]?.invoiceId;
    return invoiceId ? { invoiceId } : null;
  }

  async recordQueuedWait(id: string, error: string): Promise<void> {
    // command-coverage-ignore: Infakt worker queue stamp — the correction
    // stays queued until the original remote id exists; last_error is the wait.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.status = 'queued';
    appendAttempt(row, 'queued', error);
    await em.flush();
  }

  async markRemotePaid(id: string): Promise<void> {
    // command-coverage-ignore: Infakt worker / webhook stamp that the remote
    // invoice is paid — the invoices paidTotal write is the operator-visible one.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row || row.remotePaidAt) return;
    row.remotePaidAt = new Date();
    await em.flush();
  }

  async markFailed(id: string, error: string, opts?: { dead?: boolean }): Promise<void> {
    // command-coverage-ignore: Infakt worker queue stamp for a mapped failure.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.status = opts?.dead ? 'dead' : 'failed';
    appendAttempt(row, row.status, error);
    await em.flush();
  }

  async requeue(id: string): Promise<LedgerDeliveryRecord | null> {
    // command-coverage-ignore: queue stamp inside the audited retry Command.
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return null;
    row.status = 'queued';
    await em.flush();
    return toRecord(row);
  }

  async listRows(input: {
    status?: LedgerDeliveryRecord['status'];
    salesChannelId?: string;
    invoiceId?: string;
    limit: number;
    cursor?: string;
  }): Promise<InvoiceLedgerDelivery[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (input.status) where['status'] = input.status;
    if (input.salesChannelId) where['salesChannelId'] = input.salesChannelId;
    if (input.invoiceId) where['invoiceId'] = input.invoiceId;
    if (input.cursor) where['id'] = { $lt: input.cursor };
    return em.find(InvoiceLedgerDelivery, where, {
      orderBy: { updatedAt: 'DESC', id: 'DESC' },
      limit: input.limit + 1,
    });
  }
}
