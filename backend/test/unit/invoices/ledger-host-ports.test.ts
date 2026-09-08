import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Invoice } from '../../../../packages/modules/invoices/src/backend/entities/invoice.entity.js';
import { InvoiceService } from '../../../../packages/modules/invoices/src/backend/services/invoice-service.js';

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    number: 'FV/TMP/1',
    status: 'pending',
    total: '100.00',
    paidTotal: '0.00',
    ...overrides,
  } as Invoice;
}

function fakeEm(store: { invoice: Invoice | null; byNumber?: Invoice | null }) {
  const em = {
    fork() {
      return em;
    },
    async findOne(entity: unknown, where: { id?: string; number?: string }) {
      if (entity !== Invoice) throw new Error('unexpected entity');
      if (where.number !== undefined) {
        return store.byNumber ?? (store.invoice?.number === where.number ? store.invoice : null);
      }
      return store.invoice?.id === where.id ? store.invoice : null;
    },
    async persistAndFlush() {
      return undefined;
    },
  };
  return () => em as never;
}

function service(store: { invoice: Invoice | null; byNumber?: Invoice | null }) {
  return new InvoiceService(
    fakeEm(store),
    { findById: async () => null } as never,
    {} as never,
    {} as never,
  );
}

describe('invoices ledger host ports', () => {
  it('applyVendorAssignedNumber sets ready and the vendor number', async () => {
    const invoice = invoiceRow();
    await service({ invoice }).applyVendorAssignedNumber(invoice.id, 'K/1');
    expect(invoice.number).toBe('K/1');
    expect(invoice.status).toBe('ready');
  });

  it('applyVendorAssignedNumber is a no-op when already ready with that number', async () => {
    const invoice = invoiceRow({ number: 'K/1', status: 'ready' });
    await service({ invoice }).applyVendorAssignedNumber(invoice.id, 'K/1');
    expect(invoice.status).toBe('ready');
  });

  it('applyVendorAssignedNumber refuses a cancelled invoice', async () => {
    const invoice = invoiceRow({ status: 'cancelled' });
    await expect(service({ invoice }).applyVendorAssignedNumber(invoice.id, 'K/1')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(409);
        return true;
      },
    );
  });

  it('applyVendorAssignedNumber refuses a number another invoice holds', async () => {
    const invoice = invoiceRow();
    const holder = invoiceRow({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      number: 'K/1',
    });
    await expect(
      service({ invoice, byNumber: holder }).applyVendorAssignedNumber(invoice.id, 'K/1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.INVOICE_NUMBER_ALREADY_ISSUED,
    });
  });

  it('recordPaidFromLedger stamps paidTotal to the gross once', async () => {
    const invoice = invoiceRow({ paidTotal: '0.00', total: '250.00' });
    const svc = service({ invoice });
    await svc.recordPaidFromLedger(invoice.id);
    expect(invoice.paidTotal).toBe('250.00');
    await svc.recordPaidFromLedger(invoice.id);
    expect(invoice.paidTotal).toBe('250.00');
  });
});
