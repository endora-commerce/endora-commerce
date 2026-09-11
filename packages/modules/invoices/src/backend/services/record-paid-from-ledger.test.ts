import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceService } from './invoice-service.js';

function invoiceRow(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    number: 'FV/TMP/1',
    status: 'ready',
    total: '250.00',
    paidTotal: '0.00',
    ...overrides,
  } as Invoice;
}

function fakeEm(store: { invoice: Invoice | null }) {
  const em = {
    fork() {
      return em;
    },
    async findOne(entity: unknown, where: { id?: string }) {
      if (entity !== Invoice) throw new Error('unexpected entity');
      return store.invoice?.id === where.id ? store.invoice : null;
    },
    async persistAndFlush() {
      return undefined;
    },
  };
  return () => em as never;
}

function service(store: { invoice: Invoice | null }) {
  return new InvoiceService(
    fakeEm(store),
    { findById: async () => null } as never,
    {} as never,
    {} as never,
  );
}

describe('recordPaidFromLedger', () => {
  it('stamps paidTotal to the invoice gross once', async () => {
    const invoice = invoiceRow({ paidTotal: '10.00', total: '250.00' });
    const svc = service({ invoice });
    await svc.recordPaidFromLedger(invoice.id);
    expect(invoice.paidTotal).toBe('250.00');
    await svc.recordPaidFromLedger(invoice.id);
    expect(invoice.paidTotal).toBe('250.00');
  });

  it('is a no-op when paidTotal already covers the gross', async () => {
    const invoice = invoiceRow({ paidTotal: '250.00', total: '250.00' });
    await service({ invoice }).recordPaidFromLedger(invoice.id);
    expect(invoice.paidTotal).toBe('250.00');
  });

  it('refuses a missing invoice', async () => {
    await expect(
      service({ invoice: null }).recordPaidFromLedger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
