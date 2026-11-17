import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookWritePort } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Issue #470 (D-288; owner ruling O-3), **Stage 2 of 5 — dual write**. Every
 * price-book Command that changes a value writes one `price_list_value_changes`
 * row per book it changed, with one `price_list_row_value_changes` line per
 * added, changed or removed row, in the Command's own transaction, and the
 * audit entry points at it by `valueChangeId` while it keeps its current state
 * (removing the values from the audit entry is Stage 5).
 *
 * Every write here is to books this file creates, or to the base rows of the
 * fixture's own products (restored at the end), so the assertions and the
 * cleanup touch only this file's rows.
 */
describe('price_lists — every value-changing Command writes the book’s price-change history (#470, Stage 2)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const B = '/api/v1/admin/price-books';
  const ownBooks: string[] = [];

  type Change = {
    id: string;
    action: string;
    actor_kind: string;
    actor_admin_user_id: string | null;
    header_before: Record<string, unknown> | null;
    header_after: Record<string, unknown> | null;
    line_count: number;
  };
  type Line = {
    kind: string;
    variant_id: string | null;
    product_id: string | null;
    category_id: string | null;
    min_quantity: number;
    max_quantity: number | null;
    before_price_type: string | null;
    before_amount: string | null;
    before_percent: string | null;
    after_price_type: string | null;
    after_amount: string | null;
    after_percent: string | null;
  };

  const sql = <T>(q: string, p: unknown[] = []) => h.em().fork().getConnection().execute<T[]>(q, p);
  const changesOf = (bookId: string) =>
    sql<Change>(
      `select "id", "action", "actor_kind", "actor_admin_user_id", "header_before", "header_after", "line_count"
         from "price_list_value_changes" where "price_list_id" = ? order by "at", "id"`,
      [bookId],
    );
  const linesOf = async (changeId: string) =>
    (
      await sql<Line>(
        `select "kind", "variant_id", "product_id", "category_id", "min_quantity", "max_quantity",
                "before_price_type", "before_amount"::text as "before_amount", "before_percent"::text as "before_percent",
                "after_price_type", "after_amount"::text as "after_amount", "after_percent"::text as "after_percent"
           from "price_list_row_value_changes" where "change_id" = ? order by "seq"`,
        [changeId],
      )
    ).map((l) => ({ ...l, min_quantity: Number(l.min_quantity), max_quantity: l.max_quantity === null ? null : Number(l.max_quantity) }));
  const audits = (bookId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'price_list', objectId: bookId }, { orderBy: { actedAt: 'asc', id: 'asc' } });

  /**
   * Run one write and answer the history rows and audit entries it added to
   * `bookId`. Every assertion below goes through it, so "exactly one" is
   * checked per Command.
   */
  async function step(bookId: string, run: () => Promise<{ status: number; raw: string }>) {
    const changesBefore = (await changesOf(bookId)).length;
    const auditsBefore = (await audits(bookId)).length;
    const res = await run();
    expect(res.status, res.raw).toBeLessThan(300);
    return {
      res,
      changes: (await changesOf(bookId)).slice(changesBefore),
      entries: (await audits(bookId)).slice(auditsBefore),
    };
  }

  async function createBook(name: string, memberIds: string[]): Promise<PriceBook> {
    const created = await api.post<{ data: PriceBook }>(B, {
      name,
      type: 'regular',
      currencyCode: 'PLN',
      priority: 3,
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'organizations', memberIds },
    });
    expect(created.status, created.raw).toBe(201);
    ownBooks.push(created.body.data.id);
    return created.body.data;
  }

  const version = async (bookId: string) => (await api.get<{ data: PriceBook }>(`${B}/${bookId}`)).body.data.version;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    if (ownBooks.length > 0) await sql(`delete from "price_lists" where "id" = any(?::uuid[])`, [`{${ownBooks.join(',')}}`]);
    await f.resetBase();
    await teardownBackendServer(h);
  });

  it('create: one history row with the whole header, no lines, the admin as actor, and the entry points at it', async () => {
    const before = await sql<{ n: string }>(`select count(*) as "n" from "price_list_value_changes"`);
    const book = await createBook('S470-HISTORY-CREATE', [f.orgs.Beta.id, f.orgs.Acme.id]);
    const changes = await changesOf(book.id);
    expect(changes).toHaveLength(1);
    expect(Number((await sql<{ n: string }>(`select count(*) as "n" from "price_list_value_changes"`))[0]!.n)).toBe(Number(before[0]!.n) + 1);
    const [entry] = await audits(book.id);
    expect(changes[0]).toMatchObject({
      action: 'price_list.create',
      actor_kind: 'admin',
      header_before: null,
      header_after: {
        name: 'S470-HISTORY-CREATE',
        priority: 3,
        audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.orgs.Beta.id].sort() },
      },
      line_count: 0,
    });
    expect(changes[0]!.actor_admin_user_id).not.toBeNull();
    expect(changes[0]!.actor_admin_user_id).toBe(entry!.actorAdminUserId);
    expect(entry!.stateAfter).toMatchObject({ valueChangeId: changes[0]!.id, name: 'S470-HISTORY-CREATE' });
  });

  it('rows: added, changed and removed lines with the unrounded amounts; a no-op batch writes no history', async () => {
    const book = await createBook('S470-HISTORY-ROWS', [f.orgs.Acme.id]);
    const P1 = f.products.P1.id;
    const P5 = f.products.P5.id;

    const added = await step(book.id, async () =>
      api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        upsert: [
          { selection: { productId: P1 }, minQuantity: 1, maxQuantity: 9, price: { type: 'fixed', amount: '0.0125' } },
          { selection: { productId: P1 }, minQuantity: 10, price: { type: 'fixed', amount: '0.0100' } },
          { selection: { productId: P5, variantId: f.variants.P5r }, minQuantity: 1, price: { type: 'percent', percent: '12.5' } },
          { selection: { categoryId: f.categories.bolts }, minQuantity: 1, price: { type: 'amount', amount: '-1.2345' } },
        ],
      }),
    );
    expect(added.changes).toHaveLength(1);
    expect(added.entries).toHaveLength(1);
    expect(added.changes[0]).toMatchObject({ action: 'price_list.rows_replace', actor_kind: 'admin', header_before: null, header_after: null, line_count: 4 });
    expect(added.entries[0]!.stateAfter).toMatchObject({ valueChangeId: added.changes[0]!.id });
    // Stage 2 is additive: the value-bearing audit state is still there.
    expect(added.entries[0]!.stateAfter).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ amount: '0.0125' })]) });
    const addedLines = await linesOf(added.changes[0]!.id);
    expect(addedLines).toHaveLength(4);
    expect(addedLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'added', product_id: P1, variant_id: null, min_quantity: 1, max_quantity: 9, before_price_type: null, before_amount: null, after_price_type: 'fixed', after_amount: '0.0125' }),
        expect.objectContaining({ kind: 'added', product_id: P1, min_quantity: 10, max_quantity: null, after_amount: '0.0100' }),
        expect.objectContaining({ kind: 'added', variant_id: f.variants.P5r, after_price_type: 'percent', after_amount: null, after_percent: '12.50' }),
        expect.objectContaining({ kind: 'added', category_id: f.categories.bolts, product_id: null, after_price_type: 'amount', after_amount: '-1.2345' }),
      ]),
    );

    const stored = await sql<{ id: string; min_quantity: number }>(
      `select "id", "min_quantity" from "price_list_matrix_entries" where "price_list_id" = ? and "product_id" = ? and "variant_id" is null order by "min_quantity"`,
      [book.id, P1],
    );
    const changed = await step(book.id, async () =>
      api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        upsert: [{ selection: { productId: P1 }, minQuantity: 1, maxQuantity: 9, price: { type: 'fixed', amount: '0.0130' } }],
        delete: [stored[1]!.id],
      }),
    );
    expect(changed.changes).toHaveLength(1);
    expect(changed.changes[0]!.line_count).toBe(2);
    expect(changed.entries[0]!.stateAfter).toMatchObject({ valueChangeId: changed.changes[0]!.id });
    expect(await linesOf(changed.changes[0]!.id)).toEqual([
      expect.objectContaining({ kind: 'changed', product_id: P1, min_quantity: 1, max_quantity: 9, before_price_type: 'fixed', before_amount: '0.0125', after_price_type: 'fixed', after_amount: '0.0130' }),
      expect.objectContaining({ kind: 'removed', product_id: P1, min_quantity: 10, max_quantity: null, before_amount: '0.0100', after_price_type: null, after_amount: null }),
    ]);

    // The same row again: the Command still runs and audits, and writes no history.
    const noop = await step(book.id, async () =>
      api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        upsert: [{ selection: { productId: P1 }, minQuantity: 1, maxQuantity: 9, price: { type: 'fixed', amount: '0.0130' } }],
      }),
    );
    expect(noop.entries).toHaveLength(1);
    expect(noop.changes).toEqual([]);
    expect(noop.entries[0]!.stateAfter).not.toHaveProperty('valueChangeId');

    // A row moved to another start by its id: its coordinate moved.
    const moved = await step(book.id, async () =>
      api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        upsert: [{ id: stored[0]!.id, selection: { productId: P1 }, minQuantity: 2, maxQuantity: 9, price: { type: 'fixed', amount: '0.0130' } }],
      }),
    );
    expect(moved.changes).toHaveLength(1);
    expect((await linesOf(moved.changes[0]!.id)).map((l) => [l.kind, l.min_quantity, l.before_amount, l.after_amount])).toEqual(
      expect.arrayContaining([
        ['removed', 1, '0.0130', null],
        ['added', 2, null, '0.0130'],
      ]),
    );

    // The import's `replace` mode: every row the file does not hold is removed.
    const replaced = await step(book.id, async () =>
      api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        mode: 'replace',
        upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'fixed', amount: '470.4747' } }],
      }),
    );
    expect(replaced.changes).toHaveLength(1);
    const replacedLines = await linesOf(replaced.changes[0]!.id);
    expect(replaced.changes[0]!.line_count).toBe(replacedLines.length);
    expect(replacedLines.filter((l) => l.kind === 'removed')).toHaveLength(3);
    expect(replacedLines.filter((l) => l.kind === 'added')).toEqual([
      expect.objectContaining({ product_id: f.products.P2.id, after_amount: '470.4747' }),
    ]);
  });

  it('header: name, priority and audience members only; dates, channels and status write no history', async () => {
    const book = await createBook('S470-HISTORY-HEADER', [f.orgs.Acme.id]);

    const renamed = await step(book.id, async () =>
      api.patch(`${B}/${book.id}`, { name: 'S470-HISTORY-HEADER-2', priority: 7, endsAt: '2099-01-01T00:00:00.000Z', expectedVersion: await version(book.id) }),
    );
    expect(renamed.changes).toHaveLength(1);
    expect(renamed.changes[0]).toMatchObject({
      action: 'price_list.update',
      header_before: { name: 'S470-HISTORY-HEADER', priority: 3 },
      header_after: { name: 'S470-HISTORY-HEADER-2', priority: 7 },
      line_count: 0,
    });
    expect(Object.keys(renamed.changes[0]!.header_after!).sort()).toEqual(['name', 'priority']);
    expect(renamed.entries[0]!.stateAfter).toMatchObject({ valueChangeId: renamed.changes[0]!.id, name: 'S470-HISTORY-HEADER-2' });

    const members = await step(book.id, async () =>
      api.patch(`${B}/${book.id}`, {
        audience: { kind: 'organizations', memberIds: [f.orgs.Beta.id, f.orgs.Acme.id] },
        expectedVersion: await version(book.id),
      }),
    );
    expect(members.changes).toHaveLength(1);
    expect(members.changes[0]).toMatchObject({
      header_before: { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] } },
      header_after: { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.orgs.Beta.id].sort() } },
    });

    for (const [label, run] of [
      ['dates', async () => api.patch(`${B}/${book.id}`, { startsAt: '2026-01-01T00:00:00.000Z', expectedVersion: await version(book.id) })],
      ['same name', async () => api.patch(`${B}/${book.id}`, { name: 'S470-HISTORY-HEADER-2', expectedVersion: await version(book.id) })],
      ['same members', async () =>
        api.patch(`${B}/${book.id}`, { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.orgs.Beta.id] }, expectedVersion: await version(book.id) })],
      ['channels', async () => api.patch(`${B}/${book.id}`, { channelIds: [f.channels.CH1.id, f.channels.CH2.id], expectedVersion: await version(book.id) })],
      ['activate', async () => api.post(`${B}/${book.id}/activate`)],
      ['draftify', async () => api.post(`${B}/${book.id}/draftify`)],
    ] as const) {
      const done = await step(book.id, run);
      expect(done.entries, label).toHaveLength(1);
      expect(done.changes, label).toEqual([]);
      expect(done.entries[0]!.stateAfter, label).not.toHaveProperty('valueChangeId');
    }
  });

  // #470 stage 3, ruling 7 (amends stage 2): the audience is recorded with its
  // kind, and a kind change on a never-activated book is a value change even
  // when the member set stays empty.
  it('header: an audience kind change alone writes the audience, kind included', async () => {
    const created = await api.post<{ data: PriceBook }>(B, {
      name: 'S470-HISTORY-KIND',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'customer_groups', memberIds: [] },
    });
    expect(created.status, created.raw).toBe(201);
    const book = created.body.data;
    ownBooks.push(book.id);
    expect((await changesOf(book.id))[0]!.header_after).toMatchObject({ audience: { kind: 'customer_groups', memberIds: [] } });

    const kind = await step(book.id, async () =>
      api.patch(`${B}/${book.id}`, { audience: { kind: 'organizations', memberIds: [] }, expectedVersion: await version(book.id) }),
    );
    expect(kind.changes).toHaveLength(1);
    expect(kind.changes[0]).toMatchObject({
      action: 'price_list.update',
      header_before: { audience: { kind: 'customer_groups', memberIds: [] } },
      header_after: { audience: { kind: 'organizations', memberIds: [] } },
      line_count: 0,
    });
    expect(kind.entries[0]!.stateAfter).toMatchObject({ valueChangeId: kind.changes[0]!.id });
  });

  it('duplicate: one history row on the copy with its header and multiplier, and every copied row as an added line', async () => {
    const source = await createBook('S470-HISTORY-SOURCE', [f.orgs.Acme.id]);
    await api.put(`${B}/${source.id}/rows`, {
      expectedVersion: await version(source.id),
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '0.0130' } },
        { selection: { productId: f.products.P5.id, variantId: f.variants.P5b }, minQuantity: 1, price: { type: 'percent', percent: '7' } },
      ],
    });
    const copy = await api.post<{ data: PriceBook }>(`${B}/${source.id}/duplicate`, {
      name: 'S470-HISTORY-COPY',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'PLN',
      audience: { kind: 'everyone', memberIds: [] },
      amountMultiplier: '1.5',
    });
    expect(copy.status, copy.raw).toBe(201);
    ownBooks.push(copy.body.data.id);
    const changes = await changesOf(copy.body.data.id);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      action: 'price_list.duplicate',
      header_before: null,
      header_after: { name: 'S470-HISTORY-COPY', priority: 3, audience: { kind: 'everyone', memberIds: [] }, amountMultiplier: '1.5' },
      line_count: 2,
    });
    const [entry] = await audits(copy.body.data.id);
    expect(entry!.stateAfter).toMatchObject({ valueChangeId: changes[0]!.id, amountMultiplier: '1.5' });
    expect(await linesOf(changes[0]!.id)).toEqual(
      expect.arrayContaining([
        // 0.0130 × 1.5, the copy's own stored amount, four places.
        expect.objectContaining({ kind: 'added', product_id: f.products.P1.id, after_amount: '0.0195' }),
        expect.objectContaining({ kind: 'added', variant_id: f.variants.P5b, after_price_type: 'percent', after_percent: '7.00' }),
      ]),
    );
  });

  it('base prices: one history row per base book changed, from the admin and from the PIM port; a no-op writes none', async () => {
    const P3 = f.products.P3.id;
    const linesOnP3 = (bookId: string) =>
      sql<{ change_id: string }>(
        `select distinct l."change_id" from "price_list_row_value_changes" l where l."price_list_id" = ? and l."product_id" = ?`,
        [bookId, P3],
      );
    const res = await api.put(`${B}/base-prices/${P3}`, {
      byCurrency: {
        PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '31.0125' }], variants: {} },
        EUR: { product: [{ minQuantity: 1, maxQuantity: null, amount: '7' }], variants: {} },
      },
    });
    expect(res.status, res.raw).toBe(200);
    const lastBaseEntry = async () =>
      (
        await sql<{ state_after: Record<string, unknown> }>(
          `select "state_after" from "audit_log_entries"
            where "action" = 'price_list.base_prices_set' and "state_after"->>'productId' = ?
            order by "acted_at" desc, "id" desc limit 1`,
          [P3],
        )
      )[0]!.state_after;
    const ids = (await lastBaseEntry())['valueChangeIds'] as Record<string, string>;
    expect(Object.keys(ids).sort()).toEqual(['EUR', 'PLN']);
    const base = (await f.books.basePrices(P3)).byCurrency;
    for (const code of ['PLN', 'EUR'] as const) {
      const changes = await linesOnP3(base[code]!.bookId);
      expect(changes.map((c) => c.change_id)).toContain(ids[code]);
      const [change] = await sql<Change>(`select * from "price_list_value_changes" where "id" = ?`, [ids[code]]);
      expect(change).toMatchObject({ price_list_id: base[code]!.bookId, action: 'price_list.base_prices_set', actor_kind: 'admin' });
    }
    expect(await linesOf(ids['PLN']!)).toEqual([
      expect.objectContaining({ kind: 'changed', product_id: P3, before_amount: '30.0000', after_amount: '31.0125' }),
    ]);
    expect(await linesOf(ids['EUR']!)).toEqual([expect.objectContaining({ kind: 'added', product_id: P3, after_amount: '7.0000' })]);

    // The PIM import's port: a system actor, so no admin user.
    const port = (h.container as unknown as { resolve<T>(n: string): T }).resolve<PriceBookWritePort>('priceBookWritePort');
    const plnBook = base['PLN']!.bookId;
    const beforePim = (await linesOnP3(plnBook)).length;
    await f.system(() => port.replaceProductBaseTiers(P3, { PLN: [{ minQuantity: 1, maxQuantity: null, amount: '0.0125' }] }));
    const afterPim = await sql<Change & { price_list_id: string }>(
      `select c.* from "price_list_value_changes" c
        where c."price_list_id" = ? and exists (select 1 from "price_list_row_value_changes" l where l."change_id" = c."id" and l."product_id" = ?)
        order by c."at" desc, c."id" desc`,
      [plnBook, P3],
    );
    expect(afterPim.length).toBe(beforePim + 1);
    expect(afterPim[0]).toMatchObject({ actor_kind: 'system', actor_admin_user_id: null, line_count: 1 });
    expect(await linesOf(afterPim[0]!.id)).toEqual([
      expect.objectContaining({ kind: 'changed', before_amount: '31.0125', after_amount: '0.0125' }),
    ]);

    // The same tiers again: no row of the product's base price moved.
    await f.system(() => port.replaceProductBaseTiers(P3, { PLN: [{ minQuantity: 1, maxQuantity: null, amount: '0.0125' }] }));
    expect((await linesOnP3(plnBook)).length).toBe(beforePim + 1);
    expect(await lastBaseEntry()).not.toHaveProperty('valueChangeIds');
  });

  it('a rolled-back Command leaves neither the history row nor the audit entry', async () => {
    const book = await createBook('S470-HISTORY-ROLLBACK', [f.orgs.Acme.id]);
    const auditLog = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ recordWithin: (...args: unknown[]) => unknown }>(
      'auditLogService',
    );
    const original = auditLog.recordWithin;
    // The bus records the entry after the write, in the same transaction: an
    // entry that cannot be written rolls the whole Command back.
    auditLog.recordWithin = function (this: unknown, ...args: unknown[]) {
      const input = args[1] as { action?: string };
      if (input?.action === 'price_list.update' || input?.action === 'price_list.rows_replace') throw new Error('S470 audit write refused');
      return original.apply(this, args);
    };
    const changesBefore = (await changesOf(book.id)).length;
    const auditsBefore = (await audits(book.id)).length;
    try {
      const patched = await api.patch(`${B}/${book.id}`, { name: 'S470-HISTORY-ROLLED-BACK', expectedVersion: await version(book.id) });
      expect(patched.status).toBeGreaterThanOrEqual(500);
      const rows = await api.put(`${B}/${book.id}/rows`, {
        expectedVersion: await version(book.id),
        upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '1' } }],
      });
      expect(rows.status).toBeGreaterThanOrEqual(500);
    } finally {
      auditLog.recordWithin = original;
    }
    expect((await changesOf(book.id)).length).toBe(changesBefore);
    expect((await audits(book.id)).length).toBe(auditsBefore);
    expect(await sql(`select 1 from "price_list_row_value_changes" where "price_list_id" = ?`, [book.id])).toEqual([]);
    const [header] = await sql<{ name: string }>(`select "name" from "price_lists" where "id" = ?`, [book.id]);
    expect(header!.name).toBe('S470-HISTORY-ROLLBACK');
    // The control: the same write, with the entry written, commits both.
    const committed = await step(book.id, async () =>
      api.patch(`${B}/${book.id}`, { name: 'S470-HISTORY-COMMITTED', expectedVersion: await version(book.id) }),
    );
    expect(committed.changes).toHaveLength(1);
    expect(committed.entries[0]!.stateAfter).toMatchObject({ valueChangeId: committed.changes[0]!.id });
  });

  it('delete: the book’s history goes with it, and the delete’s audit entry still records the row count', async () => {
    const book = await createBook('S470-HISTORY-DELETE', [f.orgs.Acme.id]);
    await api.put(`${B}/${book.id}/rows`, {
      expectedVersion: await version(book.id),
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
        { selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'fixed', amount: '2' } },
      ],
    });
    const changes = await changesOf(book.id);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const deleted = await step(book.id, () => api.delete(`${B}/${book.id}`));
    expect(deleted.entries).toHaveLength(1);
    expect(deleted.entries[0]).toMatchObject({ action: 'price_list.delete' });
    expect(deleted.entries[0]!.stateBefore).toMatchObject({ rowCount: 2 });
    expect(deleted.entries[0]!.stateAfter ?? null).toBeNull();
    expect(await changesOf(book.id)).toEqual([]);
    expect(await sql(`select 1 from "price_list_row_value_changes" where "change_id" = any(?::uuid[])`, [`{${changes.map((c) => c.id).join(',')}}`])).toEqual([]);
  });
});
