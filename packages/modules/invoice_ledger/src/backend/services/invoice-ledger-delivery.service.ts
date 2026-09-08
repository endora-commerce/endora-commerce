import type { EntityManager } from '@mikro-orm/postgresql';
import {
  type InvoiceLedgerDeliveryAttempt,
  type InvoiceLedgerDeliveryPort,
  type LedgerDeliveryRecord,
} from '@endora-commerce/contracts';
import { InvoiceLedgerDelivery } from '../entities/invoice-ledger-delivery.entity.js';

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

export class InvoiceLedgerDeliveryService implements InvoiceLedgerDeliveryPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async getById(id: string): Promise<LedgerDeliveryRecord | null> {
    const row = await this.emFactory().findOne(InvoiceLedgerDelivery, { id });
    return row ? toRecord(row) : null;
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

  async markSucceeded(id: string, remoteDocumentId: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id });
    if (!row) return;
    row.remoteDocumentId = remoteDocumentId;
    row.status = 'succeeded';
    appendAttempt(row, 'succeeded', null);
    await em.flush();
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
