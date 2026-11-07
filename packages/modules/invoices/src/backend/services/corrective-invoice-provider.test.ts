import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type { CorrectiveInvoiceInput } from '@endora-commerce/contracts';
import { Invoice } from '../entities/invoice.entity.js';
import { InvoiceLine } from '../entities/invoice-line.entity.js';
import { fillPlaceholders, type InvoicesTranslate } from '../invoices-prose.js';
import { CorrectiveInvoiceProvider } from './corrective-invoice.js';

/**
 * Issue #885 — what the provider writes for a complaint settled with money: a
 * price-reduction line stored with quantity 0, named in the document's
 * language, with no discount credit; and what it refuses before any money
 * moves. The entity manager is a fake holding one invoice — 3 × 10.01 at 23 %,
 * 2 × 4.995 at 8 % and a 5.00 discount on a 0 % line — and the corrections
 * issued against it.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

const translate: InvoicesTranslate = async (key, language, params) =>
  fillPlaceholders(bundle(language === 'pl' ? 'pl' : 'en')[key] ?? `invoices.${key}`, params);

const ORDER_ID = 'order-1';

function fakeStore() {
  const invoices: Array<Record<string, unknown>> = [
    {
      id: 'inv-1',
      orderId: ORDER_ID,
      kind: 'invoice',
      status: 'ready',
      currency: 'PLN',
      salesChannelId: null,
      total: '42.73',
      saleDate: '2026-11-01',
      vatSummary: [
        { taxRate: '0', netTotal: '-5.00', vatAmount: '0.00', grossTotal: '-5.00' },
        { taxRate: '0.08', netTotal: '9.99', vatAmount: '0.80', grossTotal: '10.79' },
        { taxRate: '0.23', netTotal: '30.03', vatAmount: '6.91', grossTotal: '36.94' },
      ],
    },
  ];
  const lines: Array<Record<string, unknown>> = [
    {
      invoiceId: 'inv-1',
      ordinal: 1,
      name: 'Bolt',
      unit: 'szt.',
      quantity: '3.000',
      unitNetPrice: '10.0100',
      taxRate: '0.2300',
      netValue: '30.03',
      grossValue: '36.94',
      orderItemId: 'A',
    },
    {
      invoiceId: 'inv-1',
      ordinal: 2,
      name: 'Washer',
      unit: 'szt.',
      quantity: '2.000',
      unitNetPrice: '4.9950',
      taxRate: '0.0800',
      netValue: '9.99',
      grossValue: '10.79',
      orderItemId: 'B',
    },
    {
      invoiceId: 'inv-1',
      ordinal: 3,
      name: 'Rabat',
      unit: 'usł.',
      quantity: '1.000',
      unitNetPrice: '-5.0000',
      taxRate: '0.0000',
      netValue: '-5.00',
      grossValue: '-5.00',
      orderItemId: null,
    },
  ];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && '$in' in v ? (v.$in as unknown[]).includes(row[k]) : row[k] === v,
    );
  const tableOf = (entity: unknown) => (entity === Invoice ? invoices : entity === InvoiceLine ? lines : []);
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => tableOf(entity).find((r) => matches(r, where)) ?? null,
    find: async (entity: unknown, where: Record<string, unknown>) => tableOf(entity).filter((r) => matches(r, where)),
    create: (entity: unknown, data: Record<string, unknown>) => {
      const row = { id: randomUUID(), ...data };
      tableOf(entity).push(row);
      return row;
    },
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
    transactional: async <T>(cb: (tx: unknown) => Promise<T>) => cb(em),
  };
  return { invoices, lines, em: em as unknown as EntityManager };
}

function provider(store: ReturnType<typeof fakeStore>, language: 'pl-PL' | 'en' = 'pl-PL') {
  const audit: Array<Record<string, unknown>> = [];
  const p = new CorrectiveInvoiceProvider(
    () => store.em,
    undefined,
    { record: async (entry) => void audit.push(entry as Record<string, unknown>) },
    undefined,
    undefined,
    { translate, language },
  );
  return { p, audit };
}

const complaint = (amount: number, extra: Partial<CorrectiveInvoiceInput> = {}): CorrectiveInvoiceInput => ({
  orderId: ORDER_ID,
  lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 1, amount, basis: 'price_reduction' }],
  total: amount,
  currency: 'PLN',
  caseReference: 'RMA-2026-0001',
  ...extra,
});

const linesOf = (store: ReturnType<typeof fakeStore>, invoiceId: string) => store.lines.filter((l) => l.invoiceId === invoiceId);

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    return err as { statusCode: number; details: Record<string, unknown> };
  }
  throw new Error('expected a refusal');
}

describe('CorrectiveInvoiceProvider — a complaint refund is a price reduction (issue #885)', () => {
  it('AC-885-1 — stores the line with quantity 0, named in the document’s language, and credits no discount', async () => {
    const store = fakeStore();
    const { p, audit } = provider(store);
    const result = await p.createCorrection(complaint(6.15));
    expect(result.issued).toBe(true);
    const id = (result as { invoiceId: string }).invoiceId;
    const correction = store.invoices.find((i) => i.id === id)!;
    expect([correction.total, correction.netTotal, correction.taxTotal]).toEqual(['6.15', '5.00', '1.15']);
    expect(correction.vatSummary).toEqual([{ taxRate: '0.2300', netTotal: '5.00', vatAmount: '1.15', grossTotal: '6.15' }]);
    // One line: the price reduction. The invoice's discount line is not mirrored.
    expect(linesOf(store, id).map((l) => [l.name, l.quantity, l.unitNetPrice, l.netValue, l.grossValue, l.taxRate, l.orderItemId])).toEqual([
      ['Obniżka ceny (reklamacja RMA-2026-0001): Bolt', '0', '1.6667', '5.00', '6.15', '0.2300', 'A'],
    ]);
    expect(audit[0]).toMatchObject({ action: 'invoice.corrected', stateAfter: { priceReductionLines: 1 } });
  });

  it('names the line in English for an English document, and without a case when none is given', async () => {
    const store = fakeStore();
    const { p } = provider(store, 'en');
    const result = await p.createCorrection(complaint(6.15, { caseReference: undefined }));
    expect(linesOf(store, (result as { invoiceId: string }).invoiceId).map((l) => l.name)).toEqual([
      'Price reduction (complaint): Bolt',
    ]);
  });

  it('a later return still sees the 3 units: one back at 11.03 carrying 1.29 credits 10.01 / 2.31 and the discount', async () => {
    const store = fakeStore();
    const { p } = provider(store);
    await p.createCorrection(complaint(6.15, { idempotencyKey: 'case-1' }));
    const result = await p.createCorrection({
      orderId: ORDER_ID,
      lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 1, amount: 11.03, discount: 1.29, basis: 'returned_goods' }],
      total: 11.03,
      currency: 'PLN',
      idempotencyKey: 'case-2',
    });
    const id = (result as { invoiceId: string }).invoiceId;
    expect(linesOf(store, id).map((l) => [l.name, l.quantity, l.netValue, l.grossValue])).toEqual([
      ['Bolt', '1', '10.01', '12.32'],
      ['Rabat', '1', '-1.29', '-1.29'],
    ]);
  });

  it('AC-885-8 — refuses, before anything is written, a credit above what the invoice still charges at a rate', async () => {
    const store = fakeStore();
    const { p } = provider(store);
    await p.createCorrection(complaint(6.15, { idempotencyKey: 'case-1' }));
    const before = store.invoices.length;
    const err = await refusal(() =>
      p.validateCorrection({
        orderId: ORDER_ID,
        lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 3, amount: 33.07, discount: 3.87 }],
        total: 33.07,
        currency: 'PLN',
        idempotencyKey: 'case-2',
      }),
    );
    // 33.07 is within what the whole invoice keeps (42.73 − 6.15 = 36.58), but its goods,
    // 33.07 + 3.87 = 36.94 at 23 %, are more than the 30.79 the invoice still charges there.
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual({ code: 'correction_exceeds_rate_remaining', taxRate: '0.2300', remaining: '30.79' });
    expect(store.invoices).toHaveLength(before);
  });

  it('AC-885-9 — refuses a price reduction that carries a discount', async () => {
    const store = fakeStore();
    const { p } = provider(store);
    const err = await refusal(() =>
      p.validateCorrection({
        ...complaint(6.15),
        lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 1, amount: 6.15, discount: 1.0, basis: 'price_reduction' }],
      }),
    );
    expect(err.statusCode).toBe(422);
    expect(err.details).toMatchObject({ code: 'price_reduction_carries_discount', orderItemId: 'A' });
  });

  it('a cancelled correction credits nothing, so its quantity is not taken off what the invoice keeps (#873)', async () => {
    const store = fakeStore();
    store.invoices.push({ id: 'kor-cancelled', orderId: ORDER_ID, kind: 'correction', status: 'cancelled', originalInvoiceId: 'inv-1', total: '11.03' });
    store.lines.push({
      invoiceId: 'kor-cancelled',
      ordinal: 1,
      name: 'Bolt',
      unit: 'szt.',
      quantity: '1.000',
      unitNetPrice: '10.0100',
      taxRate: '0.2300',
      netValue: '10.01',
      grossValue: '12.32',
      orderItemId: 'A',
    });
    const { p } = provider(store);
    const result = await p.createCorrection({
      orderId: ORDER_ID,
      lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 1, amount: 11.03, discount: 1.29 }],
      total: 11.03,
      currency: 'PLN',
    });
    // As the first unit back: 10.01 / 2.31. Counting the cancelled one would credit 10.02 / 2.30.
    const id = (result as { invoiceId: string }).invoiceId;
    expect(linesOf(store, id).map((l) => [l.netValue, l.grossValue])).toEqual([
      ['10.01', '12.32'],
      ['-1.29', '-1.29'],
    ]);
  });

  it('AC-885-9 — still stores a returned-goods line sent with quantity 0 as 1', async () => {
    const store = fakeStore();
    const { p } = provider(store);
    const result = await p.createCorrection({
      orderId: ORDER_ID,
      lines: [{ orderItemId: 'A', productName: 'Bolt', quantity: 0, amount: 12.32 }],
      total: 12.32,
      currency: 'PLN',
    });
    expect(linesOf(store, (result as { invoiceId: string }).invoiceId).map((l) => l.quantity)).toEqual(['1']);
  });
});
