import { describe, expect, it, vi } from 'vitest';
import type { CatalogAttributeView, CustomFieldDefinitionWithOptions } from '@endora-commerce/contracts';
import { QuoteDocumentDataBuilder, type QuoteDocumentDataBuilderDeps, type QuoteDocumentLine, type QuoteDocumentQuote } from './data-builder.js';

/** T036 — the quote's document data, built from the owners' ports, one call each. */

const CHANNEL = { id: 'ch-a', code: 'a', name: { 'pl-PL': 'Sklep A', 'en-US': 'Store A' }, defaultLanguage: 'pl-PL' };
const DEFAULT_CHANNEL = { ...CHANNEL, id: 'ch-default', code: 'default', defaultLanguage: 'en-US' };

const quote = (over: Partial<QuoteDocumentQuote> = {}): QuoteDocumentQuote => ({
  id: 'q1',
  businessId: 'QR-7',
  status: 'Pending',
  currentRevisionNumber: 1,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  submittedAt: new Date('2026-10-01T10:05:00.000Z'),
  approvedAt: null,
  expiresAt: null,
  headerNote: 'Hello',
  organizationId: 'org-1',
  customerAccountId: 'cust-1',
  assignedAdminUserId: 'admin-1',
  salesChannelId: 'ch-a',
  customFieldValues: { po: 'PO-1', secret: 'internal note', site: 'north', empty: '' },
  ...over,
});

const line = (over: Partial<QuoteDocumentLine> = {}): QuoteDocumentLine => ({
  id: 'l1',
  productId: 'p1',
  variantId: null,
  productName: 'Bolt',
  variantLabel: null,
  quantity: 4,
  packagingUnitName: null,
  packagingUnitBaseQuantity: null,
  agreedUnitPrice: '2.50',
  desiredUnitPrice: null,
  referenceUnitPrice: '3.00',
  referenceCurrency: 'PLN',
  lineCurrency: 'PLN',
  lineNote: null,
  ...over,
});

const attribute = (key: string, over: Partial<CatalogAttributeView> = {}): CatalogAttributeView =>
  ({ key, label: { 'pl-PL': `PL-${key}`, 'en-US': `EN-${key}` }, labelDefault: key, options: [], ...over }) as CatalogAttributeView;

const definition = (key: string, audience: 'customer' | 'internal', sortOrder: number, options: { value: string; label: Record<string, string>; labelDefault: string }[] = []): CustomFieldDefinitionWithOptions =>
  ({
    definition: { key, audience, sortOrder, label: { 'pl-PL': `PL ${key}`, 'en-US': `EN ${key}` }, labelDefault: key },
    options,
  }) as unknown as CustomFieldDefinitionWithOptions;

function deps(over: Partial<QuoteDocumentDataBuilderDeps> = {}) {
  const d = {
    catalogProducts: {
      findByIds: vi.fn(async () => [
        { id: 'p1', sku: 'BOLT-1', attributeValues: { brand: 'acme', colour: { 'pl-PL': 'czerwony', 'en-US': 'red' }, hidden: 'x' } },
        { id: 'p2', sku: 'NUT-1', attributeValues: { brand: 'other', heavy: true } },
      ]),
      listVariantsByProductIds: vi.fn(async () => [{ id: 'v1', parentProductId: 'p2', sku: 'NUT-1-M8', variantAttributeValues: { size: ['m8', 'm10'] } }]),
    },
    attributes: {
      listByFlag: vi.fn(async () => [
        attribute('brand', { options: [{ value: 'acme', label: { 'pl-PL': 'Acme PL', 'en-US': 'Acme' }, labelDefault: 'Acme' }] as never }),
        attribute('colour'),
        attribute('size', { options: [{ value: 'm8', label: {}, labelDefault: 'M8' }, { value: 'm10', label: {}, labelDefault: 'M10' }] as never }),
        attribute('heavy'),
      ]),
    },
    customFieldDefinitions: {
      listForEntity: vi.fn(async () => [
        definition('site', 'customer', 2, [{ value: 'north', label: { 'pl-PL': 'Północ' }, labelDefault: 'North' }]),
        definition('secret', 'internal', 0),
        definition('po', 'customer', 1),
        definition('empty', 'customer', 3),
      ]),
    },
    organizations: {
      findById: vi.fn(async () => ({
        id: 'org-1', name: 'Acme', legalName: 'Acme Sp. z o.o.', taxId: 'PL123', isPersonal: false,
        registeredAddress: { street: 'Main 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
      })),
    },
    customerAccounts: { findById: vi.fn(async () => ({ id: 'cust-1', firstName: 'Ola', lastName: 'Buyer', email: 'ola@example.com' })) },
    adminUsers: { findById: vi.fn(async () => ({ id: 'admin-1', firstName: 'Rep', lastName: 'One', email: 'rep@example.com' })) },
    salesChannels: {
      getById: vi.fn(async (id: string) => (id === 'ch-a' ? CHANNEL : null)),
      getSystemDefault: vi.fn(async () => DEFAULT_CHANNEL),
    },
    taxRate: vi.fn(async () => 0.23),
    now: () => new Date('2026-10-17T10:00:00.000Z'),
    ...over,
  };
  return d as unknown as QuoteDocumentDataBuilderDeps & typeof d;
}

describe('QuoteDocumentDataBuilder', () => {
  it('builds the quote, buyer, representative, channel and lines in the language, one call per port', async () => {
    const d = deps();
    const data = await new QuoteDocumentDataBuilder(d).build({
      quote: quote(),
      lines: [line(), line({ id: 'l2', productId: 'p2', variantId: 'v1', productName: 'Nut', agreedUnitPrice: null, desiredUnitPrice: '1.20' })],
      language: 'pl-PL',
    });
    expect(data.quote).toMatchObject({ businessId: 'QR-7', status: 'Pending', revisionNumber: 1, taxRate: 0.23, currency: 'PLN', headerNote: 'Hello' });
    expect(data.generatedAt).toBe('2026-10-17T10:00:00.000Z');
    expect(data.channel).toEqual({ id: 'ch-a', name: 'Sklep A' });
    expect(data.buyer).toEqual({
      organizationName: 'Acme',
      legalName: 'Acme Sp. z o.o.',
      taxId: 'PL123',
      address: { line1: 'Main 1', line2: null, postalCode: '30-001', city: 'Kraków', country: 'PL' },
      customerName: 'Ola Buyer',
      customerEmail: 'ola@example.com',
    });
    expect(data.salesRep).toEqual({ name: 'Rep One', email: 'rep@example.com' });
    expect(data.lines[0]).toMatchObject({ sku: 'BOLT-1', agreedUnitPrice: 2.5, referenceUnitPrice: 3, attributes: { brand: 'Acme PL', colour: 'czerwony' } });
    expect(data.lines[1]).toMatchObject({ sku: 'NUT-1-M8', agreedUnitPrice: null, proposedUnitPrice: 1.2, attributes: { size: 'M8, M10', heavy: 'Tak' } });
    for (const fn of [d.catalogProducts.findByIds, d.catalogProducts.listVariantsByProductIds, d.attributes.listByFlag, d.customFieldDefinitions.listForEntity, d.organizations.findById, d.customerAccounts.findById, d.adminUsers.findById, d.taxRate]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(d.attributes.listByFlag).toHaveBeenCalledWith('isVisibleOnProductPage');
  });

  it('prints only the custom fields customers may see, with a value, in their order, labelled in the language', async () => {
    const data = await new QuoteDocumentDataBuilder(deps()).build({ quote: quote(), lines: [], language: 'pl-PL' });
    expect(data.details).toEqual([
      { label: 'PL po', value: 'PO-1' },
      { label: 'PL site', value: 'Północ' },
    ]);
  });

  it('a deleted product keeps its stored name; SKU and attributes are empty', async () => {
    const d = deps({ catalogProducts: { findByIds: vi.fn(async () => []), listVariantsByProductIds: vi.fn(async () => []) } as never });
    const data = await new QuoteDocumentDataBuilder(d).build({ quote: quote(), lines: [line()], language: 'en-US' });
    expect(data.lines[0]).toMatchObject({ productName: 'Bolt', sku: null, attributes: {} });
  });

  it('no representative assigned: none; a submission-record proposal fills a line that lost it', async () => {
    const d = deps();
    const data = await new QuoteDocumentDataBuilder(d).build({
      quote: quote({ assignedAdminUserId: null }),
      lines: [line()],
      language: 'en-US',
      proposals: new Map([['l1', 2.75]]),
    });
    expect(data.salesRep).toBeNull();
    expect(d.adminUsers.findById).not.toHaveBeenCalled();
    expect(data.lines[0]!.proposedUnitPrice).toBe(2.75);
  });

  it('feature 159 — answers the lines in display order with their group, and only the groups holding a line', async () => {
    const groups = [
      { id: 'g-later', name: 'Later', position: 1 },
      { id: 'g-first', name: 'First', position: 0 },
      { id: 'g-empty', name: 'Empty', position: 2 },
    ];
    const data = await new QuoteDocumentDataBuilder(deps()).build({
      quote: quote(),
      groups,
      lines: [
        line({ id: 'u', groupId: null, position: 0 }),
        line({ id: 'later-1', groupId: 'g-later', position: 1 }),
        line({ id: 'later-0', groupId: 'g-later', position: 0 }),
        line({ id: 'first', groupId: 'g-first', position: 0 }),
      ],
      language: 'en-US',
    });
    expect(data.lines.map((l) => l.id)).toEqual(['first', 'later-0', 'later-1', 'u']);
    expect(data.lines.map((l) => [l.groupId, l.position])).toEqual([
      ['g-first', 0],
      ['g-later', 0],
      ['g-later', 1],
      [null, 0],
    ]);
    expect(data.groups).toEqual([
      { id: 'g-first', name: 'First', position: 0 },
      { id: 'g-later', name: 'Later', position: 1 },
    ]);
  });

  it('feature 159 — an ungrouped quote keeps the order it was handed and carries no group', async () => {
    const data = await new QuoteDocumentDataBuilder(deps()).build({
      quote: quote(),
      lines: [line({ id: 'b' }), line({ id: 'a' })],
      language: 'en-US',
    });
    expect(data.lines.map((l) => l.id)).toEqual(['b', 'a']);
    expect(data.groups).toEqual([]);
    expect(data.lines.map((l) => l.groupId)).toEqual([null, null]);
  });

  describe('issue #767 — the buyer of a personal and of a company Organization', () => {
    it('prints a company Organization with its legal name, tax id and registered address', async () => {
      const data = await new QuoteDocumentDataBuilder(deps()).build({ quote: quote(), lines: [line()], language: 'en-US' });
      expect(data.buyer).toMatchObject({
        organizationName: 'Acme',
        legalName: 'Acme Sp. z o.o.',
        taxId: 'PL123',
        address: { line1: 'Main 1', city: 'Kraków' },
      });
    });

    it('prints the person for a personal Organization: no placeholder tax id, no placeholder head office', async () => {
      const d = deps({
        organizations: {
          findById: vi.fn(async () => ({
            id: 'org-1', name: 'Ola Buyer', legalName: null, taxId: '79963f233e3843bd84e144a8fcdd37f8', isPersonal: true,
            registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
          })),
        } as never,
      });
      const data = await new QuoteDocumentDataBuilder(d).build({ quote: quote(), lines: [line()], language: 'en-US' });
      expect(data.buyer).toEqual({
        organizationName: 'Ola Buyer',
        legalName: null,
        taxId: null,
        address: null,
        customerName: 'Ola Buyer',
        customerEmail: 'ola@example.com',
      });
    });
  });

  it('suggests the channel’s default language, or the system default channel’s for a quote with none', async () => {
    const builder = new QuoteDocumentDataBuilder(deps());
    expect(await builder.suggestedLanguage('ch-a')).toBe('pl-PL');
    expect(await builder.suggestedLanguage(null)).toBe('en-US');
    expect(await builder.suggestedLanguage('ch-gone')).toBe('en-US');
  });
});
