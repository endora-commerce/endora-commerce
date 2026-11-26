import { describe, expect, it, vi } from 'vitest';
import type { CatalogAttributeView, DocumentValue, QuoteRequestDocumentData } from '@endora-commerce/contracts';
import { createQuoteLinesCollection, quoteLineItems, quoteLineSections, quoteSummary } from './quote-lines.js';
import { sampleQuoteRequestData } from './sample.js';
import { formatDocumentValue, isValidSectionPartition } from '@endora-commerce/contracts';
import { QUOTE_DOCUMENT_TEXTS } from './texts.js';
import { summarize } from '../services/summarize.js';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';

/**
 * T021 — the quote's line field catalogue and its derivations
 * (`specs/153-quote-request-pdf-template/research.md` R-11, data-model §4.2).
 */

type Line = QuoteRequestDocumentData['lines'][number];

const line = (over: Partial<Line> = {}): Line => ({
  id: 'l1',
  productId: 'p1',
  productName: 'Bolt',
  variantLabel: null,
  sku: 'B-1',
  quantity: 10,
  packagingUnitName: null,
  packagingUnitBaseQuantity: null,
  agreedUnitPrice: 8,
  proposedUnitPrice: null,
  referenceUnitPrice: 10,
  referenceCurrency: 'PLN',
  lineCurrency: 'PLN',
  lineNote: null,
  attributes: {},
  groupId: null,
  position: 0,
  productUrl: null,
  ...over,
});

const data = (lines: Line[], taxRate = 0.23): QuoteRequestDocumentData => ({
  generatedAt: '2026-10-17T10:00:00.000Z',
  quote: {
    id: 'q',
    businessId: 'QR-1',
    status: 'Approved',
    revisionNumber: 2,
    createdAt: '2026-10-01T10:00:00.000Z',
    submittedAt: null,
    approvedAt: null,
    expiresAt: null,
    headerNote: null,
    taxRate,
    currency: 'PLN',
  },
  channel: null,
  buyer: { organizationName: 'Acme', legalName: null, taxId: null, address: null, customerName: null, customerEmail: null },
  salesRep: null,
  details: [],
  groups: [],
  lines,
});

const money = (amount: number, currency = 'PLN'): DocumentValue => ({ kind: 'money', amount, currency });
/** Issue #430: a discount that is real but rounds to no cent. */
const belowCent = (currency = 'PLN'): DocumentValue => ({ kind: 'money', amount: 0, currency, belowMinorUnit: true });
/** A unit price (§10.18): carried at four places and marked, so it is shown with its significant places. */
const unit = (amount: number, currency = 'PLN') => ({ kind: 'money', amount, currency, unitPrice: true });

describe('quoteLineItems — derivations (R-11)', () => {
  it('a line priced below its list price in the same currency has a discount', () => {
    const [item] = quoteLineItems(data([line()]));
    expect(item!.values).toMatchObject({
      productName: { kind: 'text', value: 'Bolt' },
      sku: { kind: 'text', value: 'B-1' },
      quantity: { kind: 'number', value: 10 },
      listUnitPrice: unit(10),
      unitPrice: unit(8),
      unitGrossPrice: unit(9.84),
      discountPercent: { kind: 'percent', value: 20 },
      unitDiscount: unit(2),
      lineDiscount: money(20),
      lineListValue: money(100),
      lineNet: money(80),
      vatRate: { kind: 'percent', value: 23 },
      lineVat: money(18.4),
      lineGross: money(98.4),
    });
  });

  it.each([
    ['priced at list', { agreedUnitPrice: 10 }],
    ['priced above list', { agreedUnitPrice: 12 }],
    ['a list price in another currency', { referenceCurrency: 'EUR' }],
    ['no list price', { referenceUnitPrice: null, referenceCurrency: null }],
    ['a zero list price', { referenceUnitPrice: 0 }],
    ['no agreed price', { agreedUnitPrice: null }],
  ])('%s has no discount value (null, never 0)', (_label, over) => {
    const [item] = quoteLineItems(data([line(over as Partial<Line>)]));
    expect(item!.values['discountPercent']).toBeNull();
    expect(item!.values['unitDiscount']).toBeNull();
    expect(item!.values['lineDiscount']).toBeNull();
  });

  it('issue #1904 — the product page address, or no value for a line without one', () => {
    const [linked, gone] = quoteLineItems(
      data([line({ productUrl: 'https://shop.example.com/en/p/bolt' }), line({ id: 'l2', productUrl: null })]),
    );
    expect(linked!.values['productUrl']).toEqual({ kind: 'text', value: 'https://shop.example.com/en/p/bolt' });
    expect(gone!.values['productUrl']).toBeNull();
  });

  it('the sample quote links every line to an invented product page (the editor shows the link)', () => {
    for (const language of ['en-US', 'pl-PL']) {
      for (const item of quoteLineItems(sampleQuoteRequestData(language))) {
        expect(item.values['productUrl']).toMatchObject({ kind: 'text', value: expect.stringMatching(/^https:\/\/shop\.example\.com\//) });
      }
    }
  });

  it('a line without an agreed price has no price, net, VAT or gross', () => {
    const [item] = quoteLineItems(data([line({ agreedUnitPrice: null })]));
    for (const key of ['unitPrice', 'unitGrossPrice', 'lineNet', 'lineVat', 'lineGross']) {
      expect(item!.values[key]).toBeNull();
    }
    expect(item!.values['listUnitPrice']).toEqual(unit(10));
  });

  it('packaging: the unit name and the quantity in packaging units', () => {
    const [item] = quoteLineItems(data([line({ quantity: 30, packagingUnitName: 'Box', packagingUnitBaseQuantity: 12 })]));
    expect(item!.values['packagingUnit']).toEqual({ kind: 'text', value: 'Box' });
    expect(item!.values['packagingQuantity']).toEqual({ kind: 'number', value: 2.5 });
    const [plain] = quoteLineItems(data([line()]));
    expect(plain!.values['packagingUnit']).toBeNull();
    expect(plain!.values['packagingQuantity']).toBeNull();
  });

  it('the proposal, the variant, the note, and one value per product attribute', () => {
    const [item] = quoteLineItems(
      data([line({ proposedUnitPrice: 7.5, variantLabel: 'M8', lineNote: 'Urgent', attributes: { brand: 'Acme', lead_time: '' } })]),
    );
    expect(item!.values).toMatchObject({
      proposedUnitPrice: unit(7.5),
      variant: { kind: 'text', value: 'M8' },
      lineNote: { kind: 'text', value: 'Urgent' },
      'attributes.brand': { kind: 'text', value: 'Acme' },
      'attributes.lead_time': null,
    });
  });

  it('rounds every amount to the minor unit', () => {
    const [item] = quoteLineItems(data([line({ agreedUnitPrice: 0.335, quantity: 3, referenceUnitPrice: 0.5 })], 0.08));
    expect(item!.values['lineNet']).toEqual(money(1.01));
    expect(item!.values['lineVat']).toEqual(money(0.08));
    expect(item!.values['lineGross']).toEqual(money(1.09));
    // A sub-cent net carries its gross unit price at four places: 0.335 × 1.08 = 0.3618.
    expect(item!.values['unitGrossPrice']).toEqual(unit(0.3618));
  });

  it('carries a sub-cent unit price unrounded; only the line values are rounded (§10.18)', () => {
    const [item] = quoteLineItems(data([line({ agreedUnitPrice: 0.0125, quantity: 10_000, referenceUnitPrice: 0.015 })]));
    expect(item!.values).toMatchObject({
      listUnitPrice: unit(0.015),
      unitPrice: unit(0.0125),
      // 0.0125 × 1.23 = 0.015375 → 0.0154.
      unitGrossPrice: unit(0.0154),
      unitDiscount: unit(0.0025),
      lineListValue: money(150),
      lineNet: money(125),
      // List value less net, so the document adds up.
      lineDiscount: money(25),
      lineVat: money(28.75),
      lineGross: money(153.75),
    });
    // 0.0150 × 3 = 0.045 → 0.05; the list value 0.0155 × 3 = 0.0465 → 0.05: no cent of discount shows.
    const [small] = quoteLineItems(data([line({ agreedUnitPrice: 0.015, quantity: 3, referenceUnitPrice: 0.0155 })]));
    expect(small!.values).toMatchObject({ lineNet: money(0.05), lineListValue: money(0.05), lineDiscount: belowCent() });
  });

  it('issue #430: a discount that rounds to no cent is marked, so it prints "—" rather than 0,00', () => {
    // 0.0125 × 3 = 0.0375 → 0.04 and 0.0124 × 3 = 0.0372 → 0.04: the unit discount is real, the line one rounds away.
    const [item] = quoteLineItems(data([line({ agreedUnitPrice: 0.0124, quantity: 3, referenceUnitPrice: 0.0125 })]));
    expect(item!.values['unitDiscount']).toEqual(unit(0.0001));
    expect(item!.values['lineDiscount']).toEqual(belowCent());
    // The arithmetic is kept: list value − discount (0) = net.
    expect(item!.values['lineListValue']).toEqual(money(0.04));
    expect(item!.values['lineNet']).toEqual(money(0.04));
    expect(formatDocumentValue(item!.values['lineDiscount'], { decimals: 2 }, 'pl-PL')).toBe('—');
    // The same line's discount at a quantity that reaches a cent is an ordinary amount.
    const [large] = quoteLineItems(data([line({ agreedUnitPrice: 0.0124, quantity: 100, referenceUnitPrice: 0.0125 })]));
    expect(large!.values['lineDiscount']).toEqual(money(0.01));
    // A line without a discount still has no value at all — never a dash.
    const [none] = quoteLineItems(data([line({ agreedUnitPrice: 10 })]));
    expect(none!.values['lineDiscount']).toBeNull();
  });
});

describe('quoteSummary — totals (R-11, FR-028)', () => {
  it('every line priced: net, VAT from the net total, gross = net + VAT', () => {
    const summary = quoteSummary(data([line(), line({ id: 'l2', agreedUnitPrice: 3.33, quantity: 3, referenceUnitPrice: 3.33 })]));
    expect(summary).toEqual({
      listTotal: money(109.99),
      discountTotal: money(20),
      netTotal: money(89.99),
      vatRate: { kind: 'percent', value: 23 },
      vatTotal: money(20.7),
      grossTotal: money(110.69),
    });
  });

  it('one unpriced line leaves the totals that need every price out', () => {
    const summary = quoteSummary(data([line(), line({ id: 'l2', agreedUnitPrice: null })]));
    expect(summary['netTotal']).toBeNull();
    expect(summary['vatTotal']).toBeNull();
    expect(summary['grossTotal']).toBeNull();
    expect(summary['discountTotal']).toEqual(money(20));
  });

  it('issue #430: a discount total that rounds to no cent is marked like the line one', () => {
    const below = quoteSummary(data([line({ agreedUnitPrice: 0.0124, quantity: 3, referenceUnitPrice: 0.0125 })]));
    expect(below['discountTotal']).toEqual(belowCent());
    const mixed = quoteSummary(
      data([line({ agreedUnitPrice: 0.0124, quantity: 3, referenceUnitPrice: 0.0125 }), line({ id: 'l2' })]),
    );
    expect(mixed['discountTotal']).toEqual(money(20));
  });

  it('no discount anywhere: the discount total has no value', () => {
    expect(quoteSummary(data([line({ agreedUnitPrice: 10 })]))['discountTotal']).toBeNull();
  });

  it('a list total only when every line has a list price in its currency', () => {
    expect(quoteSummary(data([line(), line({ id: 'l2', referenceUnitPrice: null })]))['listTotal']).toBeNull();
  });

  it('mixed line currencies: no money total at all', () => {
    const summary = quoteSummary(data([line(), line({ id: 'l2', lineCurrency: 'EUR', referenceCurrency: 'EUR' })]));
    for (const key of ['listTotal', 'discountTotal', 'netTotal', 'vatTotal', 'grossTotal']) expect(summary[key]).toBeNull();
  });
});

describe('the lines collection — catalogue', () => {
  const attribute = (key: string, over: Partial<CatalogAttributeView> = {}): CatalogAttributeView =>
    ({ key, label: { 'pl-PL': `PL ${key}`, 'en-US': `EN ${key}` }, labelDefault: key, isVisibleOnProductPage: true, ...over }) as CatalogAttributeView;

  it('offers the static fields grouped and labelled in the language, internal ones marked (Q7)', async () => {
    const collection = createQuoteLinesCollection({ attributes: async () => [] });
    const pl = await collection.fields('pl-PL');
    expect(pl.map((f) => f.path)).toEqual([
      'productName', 'variant', 'sku', 'quantity', 'packagingUnit', 'packagingQuantity',
      'listUnitPrice', 'proposedUnitPrice', 'unitPrice', 'unitGrossPrice', 'discountPercent', 'unitDiscount',
      'lineDiscount', 'lineListValue', 'lineNet', 'vatRate', 'lineVat', 'lineGross', 'lineNote', 'productUrl',
    ]);
    expect(pl.find((f) => f.path === 'unitPrice')?.label).toBe(QUOTE_DOCUMENT_TEXTS['pl-PL'].fields['unitPrice']);
    expect((await collection.fields('en-US')).find((f) => f.path === 'unitPrice')?.label).toBe('Price after discount');
    expect(pl.filter((f) => f.audience === 'internal').map((f) => f.path)).toEqual([
      'listUnitPrice', 'discountPercent', 'unitDiscount', 'lineDiscount', 'lineListValue',
    ]);
    expect(pl.find((f) => f.path === 'lineNet')).toMatchObject({ valueKind: 'money', group: 'pricing', defaultFormat: { decimals: 2 } });
  });

  it('issue #1904 — the product page address is a customer text field, and the product name may link to it', async () => {
    const collection = createQuoteLinesCollection({ attributes: async () => [] });
    const en = await collection.fields('en-US');
    expect(en.find((f) => f.path === 'productUrl')).toMatchObject({ label: 'Product page URL', valueKind: 'text', group: 'line', audience: 'customer' });
    expect((await collection.fields('pl-PL')).find((f) => f.path === 'productUrl')?.label).toBe('Adres strony produktu');
    expect(en.find((f) => f.path === 'productName')?.linkPath).toBe('productUrl');
    expect(en.find((f) => f.path === 'productUrl')?.linkPath).toBe('productUrl');
    expect(en.filter((f) => f.linkPath !== undefined).map((f) => f.path)).toEqual(['productName', 'productUrl']);
  });

  it('adds one field per attribute shown on the product page, labelled in the language, with a sample value', async () => {
    const attributes = vi.fn(async () => [attribute('brand'), attribute('lead_time', { label: {}, labelDefault: 'Lead time' })]);
    const collection = createQuoteLinesCollection({ attributes });
    const fields = await collection.fields('pl-PL');
    const brand = fields.find((f) => f.path === 'attributes.brand');
    expect(brand).toMatchObject({ label: 'PL brand', group: 'product', audience: 'customer', valueKind: 'text', sampleValue: { kind: 'text', value: 'Przykład' } });
    expect(fields.find((f) => f.path === 'attributes.lead_time')?.label).toBe('Lead time');
  });

  it('summary fields: list and discount totals are internal', async () => {
    const collection = createQuoteLinesCollection({ attributes: async () => [] });
    const totals = await collection.summaryFields!('en-US');
    expect(totals.map((f) => [f.path, f.audience])).toEqual([
      ['listTotal', 'internal'],
      ['discountTotal', 'internal'],
      ['netTotal', 'customer'],
      ['vatRate', 'customer'],
      ['vatTotal', 'customer'],
      ['grossTotal', 'customer'],
    ]);
  });
});

describe('SC-008 — the PDF totals equal the quote screens’ (summarize)', () => {
  const rfq = { id: 'q', createdAt: new Date(), updatedAt: new Date(), status: 'Approved' } as unknown as QuoteRequest;
  const entity = (l: Line) =>
    ({
      ...l,
      agreedUnitPrice: l.agreedUnitPrice === null ? null : l.agreedUnitPrice.toFixed(2),
      desiredUnitPrice: null,
    }) as unknown as QuoteRequestItem;
  const many = Array.from({ length: 120 }, (_, i) =>
    line({ id: `l${i}`, quantity: (i % 7) + 1, agreedUnitPrice: Math.round((1 + i * 0.37) * 100) / 100, referenceUnitPrice: 2 + i * 0.4 }),
  );
  const cases: [string, Line[]][] = [
    ['one discounted line', [line()]],
    ['no discount', [line({ agreedUnitPrice: 10 })]],
    ['an unpriced line', [line(), line({ id: 'l2', agreedUnitPrice: null })]],
    ['packaging units and notes', [line({ packagingUnitName: 'Box', packagingUnitBaseQuantity: 12, quantity: 24, lineNote: 'n' })]],
    ['attributes', [line({ attributes: { brand: 'Acme' } })]],
    ['120 lines', many],
  ];
  it.each(cases)('%s', (_label, lines) => {
    const screen = summarize(rfq, lines.map(entity), { taxRate: 0.23 });
    const pdf = quoteSummary(data(lines));
    const net = pdf['netTotal'];
    if (screen.totalAtAgreedPrice === null) {
      expect(net).toBeNull();
    } else {
      expect(net).toEqual({ kind: 'money', amount: Math.round(screen.totalAtAgreedPrice * 100) / 100, currency: 'PLN' });
      const gross = Math.round(screen.totalAtAgreedPrice * 1.23 * 100) / 100;
      expect((pdf['grossTotal'] as { amount: number }).amount).toBeCloseTo(gross, 2);
    }
  });
});

describe('feature 159 — the quote’s sections (document-sections.md §5)', () => {
  const groups = [
    { id: 'g-a', name: 'Ground floor', position: 0 },
    { id: 'g-b', name: 'First floor', position: 1 },
  ];
  const grouped = (lines: Line[]): QuoteRequestDocumentData => ({ ...data(lines), groups });

  it('a quote with no group is one ungrouped section over every line — the table prints flat', () => {
    const doc = data([line({ id: 'a' }), line({ id: 'b' })]);
    const sections = quoteLineSections(doc);
    expect(sections).toEqual([{ key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [0, 1], summary: quoteSummary(doc) }]);
    expect(quoteLineSections(data([]))).toEqual([]);
  });

  it('partitions the lines in display order: groups by position, then the ungrouped lines', () => {
    const doc = grouped([
      line({ id: 'a1', groupId: 'g-a', position: 0 }),
      line({ id: 'a2', groupId: 'g-a', position: 1 }),
      line({ id: 'b1', groupId: 'g-b', position: 0 }),
      line({ id: 'u1', groupId: null, position: 0 }),
    ]);
    const sections = quoteLineSections(doc);
    expect(sections.map((s) => [s.key, s.kind, s.label, s.itemIndexes])).toEqual([
      ['g-a', 'group', 'Ground floor', [0, 1]],
      ['g-b', 'group', 'First floor', [2]],
      ['ungrouped', 'ungrouped', null, [3]],
    ]);
    expect(isValidSectionPartition(sections, doc.lines.length)).toBe(true);
  });

  it('each section’s totals by the document’s rule over its own lines', () => {
    const doc = grouped([
      line({ id: 'a1', groupId: 'g-a', agreedUnitPrice: 8, referenceUnitPrice: 10, quantity: 10 }),
      line({ id: 'b1', groupId: 'g-b', agreedUnitPrice: 5, referenceUnitPrice: 5, quantity: 2 }),
      line({ id: 'b2', groupId: 'g-b', agreedUnitPrice: null, quantity: 1, position: 1 }),
    ]);
    const [a, b] = quoteLineSections(doc);
    expect(a!.summary).toMatchObject({
      netTotal: money(80),
      vatTotal: money(18.4),
      grossTotal: money(98.4),
      discountTotal: money(20),
      listTotal: money(100),
    });
    // An unpriced line leaves the section without net, VAT and gross; no discount where none applies.
    expect(b!.summary).toMatchObject({ netTotal: null, vatTotal: null, grossTotal: null, discountTotal: null });
  });

  it('SC-002 — the section nets add up to the document net', () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      line({
        id: `l${i}`,
        groupId: i < 15 ? 'g-a' : i < 30 ? 'g-b' : null,
        position: i,
        quantity: (i % 7) + 1,
        agreedUnitPrice: Math.round((1 + i * 0.37) * 100) / 100,
      }),
    );
    const doc = grouped(lines);
    const total = quoteLineSections(doc).reduce((sum, s) => sum + (s.summary['netTotal'] as { amount: number }).amount, 0);
    expect(Math.round(total * 100) / 100).toBe((quoteSummary(doc)['netTotal'] as { amount: number }).amount);
  });

  it('the lines collection declares its sections', () => {
    const collection = createQuoteLinesCollection({ attributes: async () => [] });
    expect(collection.sections).toBe(quoteLineSections);
  });

  it('the sample quote has two groups and an ungrouped line, in both languages (FR-044)', () => {
    for (const language of ['en-US', 'pl-PL']) {
      const sample = sampleQuoteRequestData(language);
      const sections = quoteLineSections(sample);
      expect(sections.map((s) => s.kind)).toEqual(['group', 'group', 'ungrouped']);
      expect(isValidSectionPartition(sections, quoteLineItems(sample).length)).toBe(true);
      expect(sample.groups).toHaveLength(2);
    }
    expect(sampleQuoteRequestData('pl-PL').groups[0]!.name).not.toBe(sampleQuoteRequestData('en-US').groups[0]!.name);
  });
});

/**
 * Issue #417 — the quote document's amounts in exact decimal arithmetic, under
 * its own rule: a line's VAT on the line's net, the summary's VAT on the net
 * total, a unit gross on the agreed unit price. On doubles, 29.50 at 23 % gave
 * a unit gross of 36.28 and a VAT of 6.78.
 */
describe('quote document amounts — exact decimal (#417)', () => {
  const amount = (value: DocumentValue): number | null => (value && value.kind === 'money' ? value.amount : null);

  it('rounds a line’s VAT and gross half-up on the exact product (G1)', () => {
    const [item] = quoteLineItems(data([line({ quantity: 1, agreedUnitPrice: 29.5, referenceUnitPrice: null })]));
    expect(amount(item!.values.unitGrossPrice!)).toBe(36.29);
    expect(amount(item!.values.lineVat!)).toBe(6.79);
    expect(amount(item!.values.lineGross!)).toBe(36.29);
  });

  it('takes the summary VAT on the exact net total (T1 at 5 %)', () => {
    const summary = quoteSummary(data([line({ quantity: 1, agreedUnitPrice: 0.7, referenceUnitPrice: null })], 0.05));
    expect([amount(summary.netTotal!), amount(summary.vatTotal!), amount(summary.grossTotal!)]).toEqual([0.7, 0.04, 0.74]);
  });
});
