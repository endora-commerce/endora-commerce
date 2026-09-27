import { describe, expect, it } from 'vitest';
import { INVOICE_LEDGER_KSEF_ROUTINGS } from './invoice-ledger.js';
import { invoiceSchema } from './invoices.js';

/**
 * `specs/134-paid-module-extraction/` T067 — the KSeF state the free tier
 * records stays in the free contract.
 *
 * KSeF is Poland's statutory e-invoicing clearing system, not a vendor. Whether
 * an invoice reached it, under which number and when, is a fact about the
 * invoice, and it is recorded whichever module delivered it: the `ksef` module
 * submitting directly, or an accounting vendor behind `invoice_ledger`
 * submitting on the operator's behalf (`ksefRouting: 'vendor'`). A deployment
 * whose finance system reads invoices through the free API reads the same
 * fields.
 *
 * So these names carry a `ksef` prefix and are **not** coupling to the module of
 * that name. An extraction that sweeps a departing module's id out of the free
 * packages will find them, and this test is what it meets if it "finishes the
 * job". `research.md` D16 §5 scopes the extraction script's name gate to the
 * composition roots for the same reason.
 */
describe('the free tier keeps the KSeF state it records', () => {
  it('keeps the KSeF number and processing time on the invoice', () => {
    expect(Object.keys(invoiceSchema.shape)).toEqual(
      expect.arrayContaining(['ksefReferenceNumber', 'ksefProcessedAt']),
    );
  });

  it('keeps the ledger routing that says who submits to KSeF', () => {
    expect([...INVOICE_LEDGER_KSEF_ROUTINGS]).toEqual(['native', 'vendor']);
  });
});
