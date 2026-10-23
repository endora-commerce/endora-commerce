import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookLinesResponse, PriceBookResolvedLine, PriceBookRowLabels } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import {
  addLines,
  buildSave,
  cellText,
  createEditState,
  editCell,
  selectionKeyOf,
  withLines,
  type BookEditState,
  type NewLine,
} from '../../../../packages/modules/price_lists/src/admin/lib/book-edit-state.js';

/**
 * Feature 161 (T064) — the grid's save is what the server stores.
 *
 * The bodies are built by the editor's own edit state
 * (`price_lists/src/admin/lib/book-edit-state.ts`), from the texts an operator
 * types, exactly as the grid builds them; nothing here hand-writes a row. Each
 * worked example (E1, E2, E3 of `specs/pricing/worked-examples.md` §10) is
 * typed into an empty book, saved with the book's version, activated, and
 * priced through the explanation endpoint; then the stored lines are read back
 * into a fresh edit state, whose cells must show what was typed and whose next
 * save must be empty — a round trip with no drift.
 */

const NO_LABELS: PriceBookRowLabels = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

describe('the editor batch round trip (161 T064)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const B = '/api/v1/admin/price-books';

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createBook(audience: { kind: string; memberIds: string[] }, name: string): Promise<PriceBook> {
    const res = await api.post<{ data: PriceBook }>(B, {
      name,
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience,
      priority: 0,
    });
    expect(res.status, res.raw).toBe(201);
    return res.body.data;
  }

  /** Type `cells` (line → start → text) into a fresh state over the book, save, activate. */
  async function typeAndSave(book: PriceBook, lines: readonly NewLine[], cells: ReadonlyArray<readonly [number, number, string]>): Promise<void> {
    let state: BookEditState = createEditState({ version: book.version, isBase: false });
    state = addLines(state, lines).state;
    for (const [lineIndex, start, text] of cells) {
      state = editCell(state, selectionKeyOf(lines[lineIndex]!.selection), start, text);
    }
    const plan = buildSave(state);
    if ('blocked' in plan) throw new Error(`blocked: ${JSON.stringify(plan.blocked)}`);
    const saved = await api.put<{ data: { version: number } }>(`${B}/${book.id}/rows`, { ...plan.body, expectedVersion: book.version });
    expect(saved.status, saved.raw).toBe(200);
    const activated = await api.post(`${B}/${book.id}/activate`, {});
    expect(activated.status, activated.raw).toBe(200);
  }

  /** Read the book's lines back into a fresh state: the typed texts, and an empty next save. */
  async function expectRoundTrip(bookId: string, expected: ReadonlyArray<readonly [string, number, string]>): Promise<void> {
    const book = (await api.get<{ data: PriceBook }>(`${B}/${bookId}`)).body.data;
    const lines = await api.get<PriceBookLinesResponse>(`${B}/${bookId}/lines?page=1&pageSize=100`);
    expect(lines.status, lines.raw).toBe(200);
    const state = withLines(createEditState({ version: book.version, isBase: false }), lines.body.data);
    for (const [key, start, text] of expected) expect(cellText(state, key, start, 'pl'), `${key}@${start}`).toBe(text);
    const next = buildSave(state);
    if ('blocked' in next) throw new Error('blocked');
    expect(next.body).toEqual({ mode: 'merge', upsert: [], delete: [] });
  }

  async function price(buyer: Record<string, string>, productId: string, quantity = 1): Promise<PriceBookResolvedLine> {
    const res = await api.post<{ data: PriceBookResolvedLine[] }>(`${B}/resolve`, {
      salesChannelId: f.channels.CH1.id,
      buyer,
      lines: [{ key: 'x', productId, quantity }],
    });
    expect(res.status, res.raw).toBe(200);
    return res.body.data[0]!;
  }

  it('E1 — a category ∩ attribute price for everyone, typed as 120 → E1.1 is 120.00', async () => {
    const book = await createBook({ kind: 'everyone', memberIds: [] }, 'L1');
    const line: NewLine = {
      selection: { categoryId: f.categories.screws, attribute: { key: 'color', value: 'red' } },
      kind: 'category_attribute',
      labels: NO_LABELS,
    };
    await typeAndSave(book, [line], [[0, 1, '120']]);
    const answer = await price({}, f.products.P1.id);
    expect(answer.price).toMatchObject({ amount: '120.0000', source: 'catalogue' });
    expect(answer.explanation.bookId).toBe(book.id);
    await expectRoundTrip(book.id, [[selectionKeyOf(line.selection), 1, '120,00']]);
  });

  it('E2 — organization × category and × product percentages, typed with a Unicode minus → E2.1 is 80.00', async () => {
    const book = await createBook({ kind: 'organizations', memberIds: [f.orgs.Acme.id] }, 'L2');
    const lines: NewLine[] = [
      { selection: { categoryId: f.categories.screws }, kind: 'category', labels: NO_LABELS },
      { selection: { productId: f.products.P1.id }, kind: 'product', labels: NO_LABELS },
    ];
    await typeAndSave(book, lines, [
      [0, 1, '−10 %'],
      [1, 1, '-20%'],
    ]);
    expect((await price({ organizationId: f.orgs.Acme.id }, f.products.P1.id)).price).toMatchObject({ amount: '80.0000', source: 'buyer' });
    expect((await price({ organizationId: f.orgs.Acme.id }, f.products.P2.id)).price).toMatchObject({ amount: '45.0000' });
    await expectRoundTrip(book.id, [
      [selectionKeyOf(lines[0]!.selection), 1, '-10%'],
      [selectionKeyOf(lines[1]!.selection), 1, '-20%'],
    ]);
  });

  it('E3 — a group book and an organization book → E3.1 is 95.00', async () => {
    const vip = await createBook({ kind: 'customer_groups', memberIds: [f.groups.VIP] }, 'L3');
    await typeAndSave(vip, [{ selection: { productId: f.products.P1.id }, kind: 'product', labels: NO_LABELS }], [[0, 1, '-10%']]);
    const acme = await createBook({ kind: 'organizations', memberIds: [f.orgs.Acme.id] }, 'L4');
    await typeAndSave(
      acme,
      [
        { selection: { productId: f.products.P1.id }, kind: 'product', labels: NO_LABELS },
        { selection: { categoryId: f.categories.screws }, kind: 'category', labels: NO_LABELS },
      ],
      [
        [0, 1, '-5%'],
        [1, 1, '-15%'],
      ],
    );
    expect((await price({ organizationId: f.orgs.Acme.id }, f.products.P1.id)).price).toMatchObject({ amount: '95.0000' });
    expect((await price({ organizationId: f.orgs.Beta.id }, f.products.P1.id)).price).toMatchObject({ amount: '90.0000' });
  });

  it('chains quantity tiers so they never overlap, and re-reads them unchanged', async () => {
    const book = await createBook({ kind: 'everyone', memberIds: [] }, 'Tiers');
    const p1: NewLine = { selection: { productId: f.products.P1.id }, kind: 'product', labels: NO_LABELS };
    await typeAndSave(book, [p1], [
      [0, 1, '99'],
      [0, 10, '1 234,5 zł'],
      [0, 100, '89.9'],
    ]);
    const rows = await api.get<{ data: Array<{ minQuantity: number; maxQuantity: number | null; price: unknown }> }>(
      `${B}/${book.id}/rows?page=1&pageSize=100`,
    );
    expect(rows.body.data.map((r) => [r.minQuantity, r.maxQuantity])).toEqual([
      [1, 9],
      [10, 99],
      [100, null],
    ]);
    expect((await price({}, f.products.P1.id, 50)).price).toMatchObject({ amount: '1234.5000' });
    await expectRoundTrip(book.id, [
      [selectionKeyOf(p1.selection), 1, '99,00'],
      [selectionKeyOf(p1.selection), 10, '1234,50'],
      [selectionKeyOf(p1.selection), 100, '89,90'],
    ]);
  });
});
