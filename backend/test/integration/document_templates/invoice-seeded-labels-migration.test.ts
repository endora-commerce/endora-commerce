import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261107T110328DocumentTemplatesInvoiceSeededLabels } from '@endora-commerce/mod-document-templates/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #437 — the invoice built-in layout carried English literals in its
 * label props, and a template created from it copied them into its stored
 * content, where they print on a Polish invoice. The migration empties a
 * label prop only where it holds **exactly** the literal the layout seeded,
 * in every language tree of every invoice template, and bumps `version` on
 * the rows it changes. Anything else is an operator's and stays.
 *
 * Each case runs in a transaction that is rolled back; the statements come
 * from the migration class.
 */

const FOOTER = 'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}';

type Node = { type: string; props: Record<string, unknown> };

function seededTree(): { root: { props: object }; content: Node[]; zones: object } {
  return {
    root: { props: {} },
    content: [
      {
        type: 'invoices.InvoiceHeader',
        props: {
          id: 'inv-header',
          labelIssuedAt: 'Issue date',
          labelSaleDate: 'Sale date',
          labelPaymentDue: 'Payment due',
          labelPaymentMethod: 'Payment method',
          titleSize: 14,
        },
      },
      { type: 'invoices.InvoiceParties', props: { id: 'inv-parties', sellerLabel: 'Seller', buyerLabel: 'Buyer' } },
      { type: 'invoices.InvoiceVatSummary', props: { id: 'inv-vat', totalLabel: 'Total' } },
      {
        type: 'invoices.InvoiceTotals',
        props: {
          id: 'inv-totals',
          labelPaid: 'Paid',
          labelAmountDue: 'Amount due',
          labelOverpayment: '',
          labelGross: 'Total',
          labelInWords: 'In words',
        },
      },
      { type: 'invoices.InvoiceFooter', props: { id: 'inv-footer', text: FOOTER, align: 'center' } },
    ],
    zones: {},
  };
}

describe('document_templates — invoice seeded-label migration (issue #437)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function up(em: EntityManager): Promise<void> {
    const m = new Migration20261107T110328DocumentTemplatesInvoiceSeededLabels(em.getDriver(), em.config);
    await m.up();
    for (const query of m.getQueries()) await em.execute(query as string);
  }

  async function insert(em: EntityManager, documentType: string, name: string, content: unknown): Promise<string> {
    const rows = await em.execute<Array<{ id: string }>>(
      `insert into "document_templates" ("id", "document_type", "name", "sales_channel_id", "content", "version")
       values (gen_random_uuid(), ?, ?, null, ?::jsonb, 4) returning "id"`,
      [documentType, name, JSON.stringify(content)],
    );
    return rows[0]!.id;
  }

  async function read(em: EntityManager, id: string): Promise<{ version: number; content: any }> {
    const rows = await em.execute<Array<{ version: number; content: any }>>(
      `select "version", "content" from "document_templates" where "id" = ?`,
      [id],
    );
    return rows[0]!;
  }

  const propsOf = (content: any, language: string, type: string): Record<string, unknown> =>
    (content.languages[language].content as Node[]).find((node) => node.type === type)!.props;

  it('empties every seeded English literal in both language trees and bumps the version', async () => {
    try {
      const em = db.em();
      const id = await insert(em, 'invoices.invoice', 'm437 seeded', {
        schemaVersion: 1,
        languages: { 'pl-PL': seededTree(), 'en-US': seededTree() },
      });
      await up(em);

      const row = await read(em, id);
      expect(row.version).toBe(5);
      for (const language of ['pl-PL', 'en-US']) {
        expect(propsOf(row.content, language, 'invoices.InvoiceHeader')).toEqual({
          id: 'inv-header',
          labelIssuedAt: '',
          labelSaleDate: '',
          labelPaymentDue: '',
          labelPaymentMethod: '',
          titleSize: 14,
        });
        expect(propsOf(row.content, language, 'invoices.InvoiceParties')).toEqual({
          id: 'inv-parties',
          sellerLabel: '',
          buyerLabel: '',
        });
        expect(propsOf(row.content, language, 'invoices.InvoiceVatSummary')).toEqual({ id: 'inv-vat', totalLabel: '' });
        expect(propsOf(row.content, language, 'invoices.InvoiceTotals')).toEqual({
          id: 'inv-totals',
          labelPaid: '',
          labelAmountDue: '',
          labelOverpayment: '',
          labelGross: '',
          labelInWords: '',
        });
        expect(propsOf(row.content, language, 'invoices.InvoiceFooter')).toEqual({
          id: 'inv-footer',
          text: '',
          align: 'center',
        });
      }
      expect(row.content.schemaVersion).toBe(1);
      expect(row.content.languages['pl-PL'].root).toEqual({ props: {} });
    } finally {
      await db.rollbackTx();
    }
  });

  it('keeps every value an operator typed, and the row it sits in untouched when nothing else changed', async () => {
    try {
      const em = db.em();
      const edited = seededTree();
      edited.content[0]!.props = { id: 'inv-header', labelIssuedAt: 'Data wystawienia', labelSaleDate: 'Sale date ' };
      edited.content[1]!.props = { id: 'inv-parties', sellerLabel: 'seller', buyerLabel: 'Kupujący' };
      edited.content[2]!.props = { id: 'inv-vat', totalLabel: 'Razem' };
      edited.content[3]!.props = { id: 'inv-totals', labelPaid: 'Wpłacono', labelGross: 'Total gross' };
      edited.content[4]!.props = { id: 'inv-footer', text: `${FOOTER}\nBank: PKO` };
      // The same literal on a prop the layout never seeded, and on another block type.
      edited.content.push({ type: 'invoices.InvoiceNotes', props: { id: 'inv-notes', text: 'Paid' } });
      const id = await insert(em, 'invoices.invoice', 'm437 edited', {
        schemaVersion: 1,
        languages: { 'pl-PL': edited },
      });
      await up(em);

      const row = await read(em, id);
      expect(row.version).toBe(4);
      expect(row.content.languages['pl-PL']).toEqual(edited);
    } finally {
      await db.rollbackTx();
    }
  });

  it('touches no other document type', async () => {
    try {
      const em = db.em();
      const id = await insert(em, 'comparisons.comparison', 'm437 other type', {
        schemaVersion: 1,
        languages: { 'pl-PL': seededTree() },
      });
      await up(em);

      const row = await read(em, id);
      expect(row.version).toBe(4);
      expect(propsOf(row.content, 'pl-PL', 'invoices.InvoiceTotals')['labelPaid']).toBe('Paid');
    } finally {
      await db.rollbackTx();
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    try {
      const em = db.em();
      const id = await insert(em, 'invoices.invoice', 'm437 twice', {
        schemaVersion: 1,
        languages: { 'pl-PL': seededTree() },
      });
      await up(em);
      const once = await read(em, id);
      await up(em);
      const twice = await read(em, id);
      expect(twice).toEqual(once);
      expect(twice.version).toBe(5);
    } finally {
      await db.rollbackTx();
    }
  });
});
