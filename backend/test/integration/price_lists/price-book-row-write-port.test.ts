import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  ERROR_CODES,
  PRICE_BOOK_ROW_WRITE_PORT,
  type PriceBookRowWritePort,
  type PriceBookWritePort,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Issue #1028 — `priceBookRowWritePort`: a module (an ERP or PIM connector)
 * replaces, reads and removes one product's rows in a customer-group,
 * organization, catalogue or sale book, with no admin HTTP call. Its writes
 * are the admin row batch's write path, so what it writes is what every buyer
 * surface charges, each write is one audit entry and one pricing-generation
 * bump naming the book and the product, and base, expired and unknown books
 * are refused before anything is written.
 */
describe('price_lists — priceBookRowWritePort (issue #1028)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let port: PriceBookRowWritePort;
  const resolve = <T>(name: string): T => (h.container as unknown as { resolve<U>(n: string): U }).resolve<T>(name);
  const tiers = (...t: Array<[number, number | null, string]>) =>
    t.map(([minQuantity, maxQuantity, amount]) => ({ minQuantity, maxQuantity, amount }));
  const audits = (bookId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'price_list', objectId: bookId }, { orderBy: { actedAt: 'asc' } });
  const baseBookId = async (): Promise<string> =>
    (await resolve<PriceBookWritePort>('priceBookWritePort').basePrices(f.products.P1.id)).byCurrency['PLN']!.bookId;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    port = resolve<PriceBookRowWritePort>(PRICE_BOOK_ROW_WRITE_PORT);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('an organization book written through the port prices that organization, and only it, until the rows are removed', async () => {
    const book = await f.book({ audience: { organizations: [f.orgs.Gamma] } });
    expect(await port.bookRows(book.id, f.products.P1.id)).toBeNull();

    const answer = await f.system(() =>
      port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, 9, '80'], [10, null, '70']) }),
    );
    expect(answer).toMatchObject({
      bookId: book.id,
      productId: f.products.P1.id,
      currencyCode: 'PLN',
      product: tiers([1, 9, '80.0000'], [10, null, '70.0000']),
      variants: {},
      complete: true,
    });
    expect(await port.bookRows(book.id, f.products.P1.id)).toEqual(answer);

    const gamma = { organization: f.orgs.Gamma };
    expect(await f.amount(gamma, f.products.P1)).toBe('80.0000');
    expect(await f.amount(gamma, f.products.P1, { quantity: 10 })).toBe('70.0000');
    expect(await f.amount({ organization: f.orgs.Beta }, f.products.P1)).toBe('100.0000');
    expect(await f.amount('guest', f.products.P1)).toBe('100.0000');

    await f.system(() => port.removeBookRows(book.id, f.products.P1.id));
    expect(await port.bookRows(book.id, f.products.P1.id)).toBeNull();
    expect(await f.amount(gamma, f.products.P1)).toBe('100.0000');
  });

  it('a customer-group book written through the port prices the group’s buyers, variants included', async () => {
    const book = await f.book({ audience: { groups: [f.groups.VIP] } });
    await f.system(() =>
      port.replaceBookRows(book.id, f.products.P5.id, {
        product: tiers([1, null, '60']),
        variants: { [f.variants.P5r]: { type: 'fixed', tiers: tiers([1, null, '65']) } },
      }),
    );
    const beta = { organization: f.orgs.Beta };
    expect(await f.amount(beta, f.products.P5, { variantId: f.variants.P5b })).toBe('60.0000');
    expect(await f.amount(beta, f.products.P5, { variantId: f.variants.P5r })).toBe('65.0000');
    expect(await f.amount({ organization: f.orgs.Gamma }, f.products.P5, { variantId: f.variants.P5b })).toBe('80.0000');

    // A variant the write does not name keeps its rows; a variant written null loses them.
    await f.system(() => port.replaceBookRows(book.id, f.products.P5.id, { product: tiers([1, null, '58']) }));
    expect((await port.bookRows(book.id, f.products.P5.id))!.variants).toEqual({
      [f.variants.P5r]: { type: 'fixed', tiers: tiers([1, null, '65.0000']) },
    });
    await f.system(() =>
      port.replaceBookRows(book.id, f.products.P5.id, { product: tiers([1, null, '58']), variants: { [f.variants.P5r]: null } }),
    );
    expect((await port.bookRows(book.id, f.products.P5.id))!.variants).toEqual({});
    expect(await f.amount(beta, f.products.P5, { variantId: f.variants.P5r })).toBe('58.0000');
  });

  it('leaves the book’s other rows alone', async () => {
    const book = await f.book({
      audience: 'everyone',
      rows: [
        { category: f.categories.screws, percent: '-5' },
        { product: f.products.P2, fixed: '45' },
      ],
    });
    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '90']) }));
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ product_id: string | null; category_id: string | null }>>(
        `select "product_id", "category_id" from "price_list_matrix_entries" where "price_list_id" = ? order by "created_at"`,
        [book.id],
      );
    expect(rows).toHaveLength(3);
    expect(await f.amount('guest', f.products.P2)).toBe('45.0000');
    expect(await f.amount('guest', f.products.P1)).toBe('90.0000');
  });

  it('keeps the rows an administrator entered that the write shape cannot say, through a replace and a remove, and buyers are still priced by them', async () => {
    // A product-level −10 % from 20 pieces and a variant's −50 % from 10 pieces: neither is a fixed
    // tier nor an adjustment at every quantity, so the port neither writes nor removes them.
    const book = await f.book({
      audience: { organizations: [f.orgs.Gamma] },
      rows: [
        { product: f.products.P1, min: 20, percent: '-10' },
        { product: f.products.P5, variant: f.variants.P5r, min: 10, percent: '-50' },
      ],
    });
    const gamma = { organization: f.orgs.Gamma };
    expect(await port.bookRows(book.id, f.products.P1.id)).toMatchObject({ product: [], complete: false });

    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, 19, '80']) }));
    await f.system(() =>
      port.replaceBookRows(book.id, f.products.P5.id, {
        product: [],
        variants: { [f.variants.P5r]: { type: 'fixed', tiers: tiers([1, 9, '70']) } },
      }),
    );
    expect(await port.bookRows(book.id, f.products.P1.id)).toMatchObject({ product: tiers([1, 19, '80.0000']), complete: false });
    expect(await f.amount(gamma, f.products.P1)).toBe('80.0000');
    expect(await f.amount(gamma, f.products.P1, { quantity: 20 })).toBe('90.0000');
    expect(await f.amount(gamma, f.products.P5, { variantId: f.variants.P5r })).toBe('70.0000');
    // P5r's base is P5's 80 + 10 % = 88; −50 % from 10 pieces.
    expect(await f.amount(gamma, f.products.P5, { variantId: f.variants.P5r, quantity: 10 })).toBe('44.0000');

    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: [] }));
    await f.system(() => port.removeBookRows(book.id, f.products.P5.id));
    expect(await port.bookRows(book.id, f.products.P1.id)).toEqual(expect.objectContaining({ product: [], variants: {}, complete: false }));
    expect(await port.bookRows(book.id, f.products.P5.id)).toEqual(expect.objectContaining({ product: [], variants: {}, complete: false }));
    expect(await f.amount(gamma, f.products.P1)).toBe('100.0000');
    expect(await f.amount(gamma, f.products.P1, { quantity: 20 })).toBe('90.0000');
    expect(await f.amount(gamma, f.products.P5, { variantId: f.variants.P5r })).toBe('88.0000');
    expect(await f.amount(gamma, f.products.P5, { variantId: f.variants.P5r, quantity: 10 })).toBe('44.0000');

    // A fixed tier that would overlap a kept row is refused, as the admin batch refuses it.
    await expect(
      f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '75']) })),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.PRICE_BOOK_ROW_OVERLAP });
  });

  it('never overwrites an administrator’s row the port cannot say that starts where a written tier starts — it refuses the overlap', async () => {
    const book = await f.book({
      audience: { organizations: [f.orgs.Gamma] },
      rows: [
        { product: f.products.P1, min: 1, percent: '-10' },
        { product: f.products.P5, variant: f.variants.P5r, min: 10, percent: '-50' },
      ],
    });
    const [productRow, variantRow] = book.rowIds;
    const gamma = { organization: f.orgs.Gamma };
    const audited = (await audits(book.id)).length;

    await expect(
      f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '80']) })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_ROW_OVERLAP,
      details: { errors: [expect.objectContaining({ field: 'product.0.minQuantity', rowId: productRow })] },
    });
    await expect(
      f.system(() =>
        port.replaceBookRows(book.id, f.products.P5.id, {
          product: [],
          variants: { [f.variants.P5r]: { type: 'fixed', tiers: tiers([10, null, '40']) } },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_ROW_OVERLAP,
      details: { errors: [expect.objectContaining({ rowId: variantRow })] },
    });
    await f.system(() => port.removeBookRows(book.id, f.products.P1.id));
    await f.system(() => port.removeBookRows(book.id, f.products.P5.id));

    expect((await audits(book.id)).length).toBe(audited);
    const ids = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "price_list_matrix_entries" where "price_list_id" = ? order by "id"`, [book.id]);
    expect(ids.map((r) => r.id)).toEqual([productRow, variantRow].sort());
    expect(await f.amount(gamma, f.products.P1)).toBe('90.0000');
    expect(await f.amount(gamma, f.products.P5, { variantId: f.variants.P5r, quantity: 10 })).toBe('44.0000');
  });

  it('audits each write once, with the product, and a write that changes nothing not at all', async () => {
    const book = await f.book({ audience: { organizations: [f.orgs.Gamma] } });
    const before = (await audits(book.id)).length;
    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '80']) }));
    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '80.00']) }));
    await f.system(() => port.removeBookRows(book.id, f.products.P1.id));
    await f.system(() => port.removeBookRows(book.id, f.products.P1.id));
    const entries = (await audits(book.id)).slice(before);
    expect(entries.map((e) => e.action)).toEqual(['price_list.book_rows_set', 'price_list.book_rows_remove']);
    expect(entries[0]!.stateAfter).toMatchObject({ productId: f.products.P1.id, changedFields: ['rows'], addedCount: 1 });
    expect(entries[1]!.stateAfter).toMatchObject({ productId: f.products.P1.id, changedFields: ['rows'], removedCount: 1 });
  });

  it('records names in the audit entry and the prices in the book’s own history (#470, D-288)', async () => {
    const book = await f.book({ audience: { organizations: [f.orgs.Gamma] } });
    const before = (await audits(book.id)).length;
    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, 9, '80'], [10, null, '70']) }));
    await f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, 9, '81']) }));
    await f.system(() => port.removeBookRows(book.id, f.products.P1.id));
    const entries = (await audits(book.id)).slice(before);
    expect(entries.map((e) => e.action)).toEqual([
      'price_list.book_rows_set',
      'price_list.book_rows_set',
      'price_list.book_rows_remove',
    ]);
    for (const entry of entries) {
      // No price, no quantity: the entry names what changed and points at the history row.
      const text = JSON.stringify([entry.stateBefore, entry.stateAfter]);
      expect(text).not.toMatch(/amount|percent|minQuantity|maxQuantity|"rows"\s*:\s*\[/);
      expect(entry.stateAfter).toMatchObject({ valueChangeId: expect.any(String) });
    }
    const sql = <T>(q: string, p: unknown[]) => h.em().getConnection().execute<T[]>(q, p);
    const changes = await sql<{ id: string; action: string; actor_kind: string; line_count: number }>(
      `select "id", "action", "actor_kind", "line_count" from "price_list_value_changes" where "price_list_id" = ? order by "at", "id"`,
      [book.id],
    );
    expect(changes.map((c) => c.id).sort()).toEqual(entries.map((e) => e.stateAfter!['valueChangeId']).sort());
    const lines = async (id: string) =>
      (
        await sql<Record<string, unknown>>(
          `select "kind", "product_id", "min_quantity", "max_quantity", "before_amount", "after_amount", "after_price_type"
             from "price_list_row_value_changes" where "change_id" = ? order by "seq"`,
          [id],
        )
      ).map((l) => ({
        kind: l['kind'],
        min: Number(l['min_quantity']),
        max: l['max_quantity'] === null ? null : Number(l['max_quantity']),
        before: l['before_amount'] === null ? null : Number(l['before_amount']),
        after: l['after_amount'] === null ? null : Number(l['after_amount']),
      }));
    const byEntry = (i: number) => String(entries[i]!.stateAfter!['valueChangeId']);
    expect(await lines(byEntry(0))).toEqual([
      { kind: 'added', min: 1, max: 9, before: null, after: 80 },
      { kind: 'added', min: 10, max: null, before: null, after: 70 },
    ]);
    expect(await lines(byEntry(1))).toEqual([
      { kind: 'changed', min: 1, max: 9, before: 80, after: 81 },
      { kind: 'removed', min: 10, max: null, before: 70, after: null },
    ]);
    expect(await lines(byEntry(2))).toEqual([{ kind: 'removed', min: 1, max: 9, before: 81, after: null }]);
    expect(changes.every((c) => c.actor_kind === 'system')).toBe(true);
  });

  it('bumps the pricing generation once per write, after the commit, naming the book and the product', async () => {
    const book = await f.book({ audience: { groups: [f.groups.VIP] } });
    const generation = resolve<{
      handle: { pricingGeneration: { invalidateAll(change?: unknown): void | Promise<void> } };
    }>('priceLists').handle.pricingGeneration;
    const original = generation.invalidateAll.bind(generation);
    const seen: Array<{ amount: string | undefined; change: unknown }> = [];
    generation.invalidateAll = async (change?: unknown) => {
      const [row] = await h
        .orm.em.fork()
        .getConnection()
        .execute<Array<{ amount: string }>>(
          `select "amount" from "price_list_matrix_entries" where "price_list_id" = ? and "product_id" = ? and "variant_id" is null`,
          [book.id, f.products.P2.id],
        );
      seen.push({ amount: row?.amount, change });
      return original(change as never);
    };
    try {
      await f.system(() => port.replaceBookRows(book.id, f.products.P2.id, { product: tiers([1, null, '41']) }));
    } finally {
      generation.invalidateAll = original;
    }
    expect(seen).toHaveLength(1);
    expect(Number(seen[0]!.amount)).toBe(41);
    expect(seen[0]!.change).toMatchObject({
      kind: 'books',
      books: [
        {
          facts: [expect.objectContaining({ bookId: book.id })],
          selections: [expect.objectContaining({ productId: f.products.P2.id })],
        },
      ],
    });
  });

  it('refuses a base book, an expired book, an unknown book and product, and rule-breaking tiers — writing nothing', async () => {
    const base = await baseBookId();
    const baseAudits = (await audits(base)).length;
    await expect(
      f.system(() => port.replaceBookRows(base, f.products.P1.id, { product: tiers([1, null, '1']) })),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.PRICE_BOOK_BASE_BOOK });
    await expect(f.system(() => port.removeBookRows(base, f.products.P1.id))).rejects.toMatchObject({
      code: ERROR_CODES.PRICE_BOOK_BASE_BOOK,
    });
    await expect(port.bookRows(base, f.products.P1.id)).rejects.toMatchObject({ code: ERROR_CODES.PRICE_BOOK_BASE_BOOK });
    expect((await audits(base)).length).toBe(baseAudits);
    expect(await f.amount('guest', f.products.P1)).toBe('100.0000');

    const expired = await f.book({
      audience: { organizations: [f.orgs.Gamma] },
      startsAt: new Date('2020-01-01T00:00:00Z'),
      endsAt: new Date('2020-02-01T00:00:00Z'),
    });
    await expect(
      f.system(() => port.replaceBookRows(expired.id, f.products.P1.id, { product: tiers([1, null, '1']) })),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.PRICE_BOOK_EXPIRED });

    await expect(
      f.system(() => port.replaceBookRows('00000000-0000-4000-8000-0000000fffff', f.products.P1.id, { product: [] })),
    ).rejects.toMatchObject({ statusCode: 404 });

    const book = await f.book({ audience: { organizations: [f.orgs.Gamma] } });
    const bookAudits = (await audits(book.id)).length;
    await expect(
      f.system(() => port.replaceBookRows(book.id, '00000000-0000-4000-8000-0000000fffff', { product: tiers([1, null, '1']) })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, 5, '10'], [3, null, '9']) })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_ROW_OVERLAP,
      details: { errors: [expect.objectContaining({ field: 'product.1.minQuantity' })] },
    });
    await expect(
      f.system(() => port.replaceBookRows(book.id, f.products.P1.id, { product: tiers([1, null, '-1']) })),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
    await expect(
      f.system(() =>
        port.replaceBookRows(book.id, f.products.P1.id, { product: [], variants: { [f.variants.P5r]: null } }),
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.PRICE_BOOK_ROW_SHAPE,
      details: { errors: [expect.objectContaining({ field: `variants.${f.variants.P5r}`, code: 'PRICE_BOOK_ROW_TARGET' })] },
    });
    expect((await audits(book.id)).length).toBe(bookAudits);
    expect(await port.bookRows(book.id, f.products.P1.id)).toBeNull();
  });
});
