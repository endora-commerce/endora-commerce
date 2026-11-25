import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  PriceBook,
  PriceBookHistoryChange,
  PriceBookHistoryChangesResponse,
  PriceBookHistoryLine,
  PriceBookHistoryLinesResponse,
  PriceBookHistoryProductLine,
  PriceBookHistoryProductLinesResponse,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { AdminUser } from '../../helpers/package-entities.js';

/**
 * Issue #470 stage 3 (architect rulings 2026-11-17) — the reader over a price
 * book's own price-change history:
 *
 * - `GET …/:id/price-history` — changes, `(at desc, id desc)`;
 * - `GET …/:id/price-history/:changeId/lines` — `seq` ascending;
 * - `GET …/:id/price-history/products/:productId` — the product's and its
 *   variants' lines, `(at desc, changeId desc, seq asc)`.
 *
 * Keyset pages; amounts as stored; the book is loaded through the price-book
 * scope, so an out-of-reach book answers as an unknown one; organization ids a
 * scoped reader may not see are withheld and counted.
 *
 * Every write is to books this file creates (deleted at the end, their history
 * with them by cascade), and the admin user it creates is deleted too.
 */
describe('price_lists — reading a price book’s price-change history (#470, stage 3)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  const B = '/api/v1/admin/price-books';
  const UNKNOWN = '00000000-0000-4000-8000-0000004700cc';
  const ownBooks: string[] = [];
  const ownAdmins: string[] = [];

  const sql = <T>(q: string, p: unknown[] = []) => h.em().fork().getConnection().execute<T[]>(q, p);
  const version = async (bookId: string) => (await api.get<{ data: PriceBook }>(`${B}/${bookId}`)).body.data.version;
  type ErrorEnvelope = { error: Record<string, unknown> };
  const refusal = (body: unknown): unknown => {
    const { requestId: _requestId, message: _message, ...rest } = (body as ErrorEnvelope).error;
    return rest;
  };

  async function walk<T>(first: string, cookies?: Record<string, string>): Promise<{ items: T[]; pages: number }> {
    const items: T[] = [];
    let url: string | null = first;
    let pages = 0;
    while (url) {
      const res: { status: number; raw: string; body: { data: T[]; pagination: { cursor: string | null; hasMore: boolean } } } =
        await api.get(url, cookies);
      expect(res.status, res.raw).toBe(200);
      items.push(...res.body.data);
      pages += 1;
      expect(res.body.pagination.hasMore).toBe(res.body.pagination.cursor !== null);
      url = res.body.pagination.cursor
        ? `${first}${first.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(res.body.pagination.cursor)}`
        : null;
      expect(pages).toBeLessThan(100);
    }
    return { items, pages };
  }

  /** Seed one history row (and its lines) by SQL, at a chosen instant — the keyset ties need several at the same `at`. */
  async function seedChange(input: {
    bookId: string;
    at: string;
    action?: string;
    actorKind?: string;
    actorAdminUserId?: string | null;
    headerBefore?: unknown;
    headerAfter?: unknown;
    lines?: Array<{
      kind: 'added' | 'changed' | 'removed';
      productId?: string | null;
      variantId?: string | null;
      categoryId?: string | null;
      minQuantity?: number;
      before?: string | null;
      after?: string | null;
    }>;
  }): Promise<string> {
    const id = randomUUID();
    const lines = input.lines ?? [];
    await sql(
      `insert into "price_list_value_changes"
         ("id", "price_list_id", "action", "actor_kind", "actor_admin_user_id", "at", "header_before", "header_after", "line_count")
       values (?, ?, ?, ?, ?, ?::timestamptz, ?::jsonb, ?::jsonb, ?)`,
      [
        id,
        input.bookId,
        input.action ?? 'price_list.rows_replace',
        input.actorKind ?? 'system',
        input.actorAdminUserId ?? null,
        input.at,
        input.headerBefore === undefined ? null : JSON.stringify(input.headerBefore),
        input.headerAfter === undefined ? null : JSON.stringify(input.headerAfter),
        lines.length,
      ],
    );
    for (const [seq, line] of lines.entries()) {
      await sql(
        `insert into "price_list_row_value_changes"
           ("change_id", "seq", "price_list_id", "at", "kind", "variant_id", "product_id", "category_id", "min_quantity",
            "before_price_type", "before_amount", "after_price_type", "after_amount")
         values (?, ?, ?, ?::timestamptz, ?, ?, ?, ?, ?, ?, ?::numeric, ?, ?::numeric)`,
        [
          id,
          seq,
          input.bookId,
          input.at,
          line.kind,
          line.variantId ?? null,
          line.productId ?? null,
          line.categoryId ?? null,
          line.minQuantity ?? 1,
          line.kind === 'added' ? null : 'fixed',
          line.kind === 'added' ? null : (line.before ?? '1.0000'),
          line.kind === 'removed' ? null : 'fixed',
          line.kind === 'removed' ? null : (line.after ?? '2.0000'),
        ],
      );
    }
    return id;
  }

  async function orgBook(name: string, memberIds: string[]): Promise<PriceBook> {
    const created = await api.post<{ data: PriceBook }>(B, {
      name,
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'organizations', memberIds },
    });
    expect(created.status, created.raw).toBe(201);
    ownBooks.push(created.body.data.id);
    return created.body.data;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, {
      assignedOrganizationIds: [f.orgs.Acme.id],
      otherOrganizationIds: [f.orgs.Beta.id, f.orgs.Gamma.id, f.orgs.AcmeW.id],
    });
    ownAdmins.push(rep.adminUserId);
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    if (ownBooks.length > 0) await sql(`delete from "price_lists" where "id" = any(?::uuid[])`, [`{${ownBooks.join(',')}}`]);
    await sql(`delete from "admin_users" where "id" = any(?::uuid[])`, [`{${ownAdmins.join(',')}}`]);
    await teardownBackendServer(h);
  });

  it('serves the stored amounts unrounded, newest change first, each change’s lines in seq order', async () => {
    const book = await orgBook('S470-READ-VALUES', [f.orgs.Acme.id]);
    const added = await api.put(`${B}/${book.id}/rows`, {
      expectedVersion: await version(book.id),
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '0.0125' } },
        { selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'amount', amount: '-1.2345' } },
        { selection: { productId: f.products.P3.id }, minQuantity: 1, price: { type: 'percent', percent: '12.5' } },
      ],
    });
    expect(added.status, added.raw).toBe(200);
    const changed = await api.put(`${B}/${book.id}/rows`, {
      expectedVersion: await version(book.id),
      upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '0.0130' } }],
    });
    expect(changed.status, changed.raw).toBe(200);

    const res = await api.get<PriceBookHistoryChangesResponse>(`${B}/${book.id}/price-history`);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.pagination).toEqual({ cursor: null, hasMore: false, limit: 50 });
    expect(res.body).not.toHaveProperty('meta');
    expect(res.body.data.map((c) => [c.action, c.lineCount])).toEqual([
      ['price_list.rows_replace', 1],
      ['price_list.rows_replace', 3],
      ['price_list.create', 0],
    ]);
    const [latest, first, create] = res.body.data as [PriceBookHistoryChange, PriceBookHistoryChange, PriceBookHistoryChange];
    expect(create.headerBefore).toBeNull();
    expect(create.headerAfter).toEqual({
      name: 'S470-READ-VALUES',
      priority: 0,
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
    });

    const lines = await api.get<PriceBookHistoryLinesResponse>(`${B}/${book.id}/price-history/${first.id}/lines`);
    expect(lines.status, lines.raw).toBe(200);
    expect(lines.body.data.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(lines.body.data.map((l) => [l.kind, l.selection.productId, l.before, l.after])).toEqual(
      expect.arrayContaining([
        ['added', f.products.P1.id, null, { type: 'fixed', amount: '0.0125' }],
        ['added', f.products.P2.id, null, { type: 'amount', amount: '-1.2345' }],
        ['added', f.products.P3.id, null, { type: 'percent', percent: '12.50' }],
      ]),
    );
    const latestLines = await api.get<PriceBookHistoryLinesResponse>(`${B}/${book.id}/price-history/${latest.id}/lines`);
    expect(latestLines.body.data).toEqual([
      {
        seq: 0,
        kind: 'changed',
        selection: { variantId: null, productId: f.products.P1.id, categoryId: null, attributeKey: null, attributeValue: null },
        minQuantity: 1,
        maxQuantity: null,
        before: { type: 'fixed', amount: '0.0125' },
        after: { type: 'fixed', amount: '0.0130' },
      },
    ]);
  });

  it('an out-of-reach book answers on every history route exactly as an unknown id; so does another book’s change', async () => {
    const mixed = await orgBook('S470-READ-MIXED', [f.orgs.Acme.id, f.orgs.Beta.id]);
    const [change] = (await api.get<PriceBookHistoryChangesResponse>(`${B}/${mixed.id}/price-history`)).body.data;
    for (const suffix of ['/price-history', `/price-history/${change!.id}/lines`, `/price-history/products/${f.products.P1.id}`]) {
      const hidden = await api.get(`${B}/${mixed.id}${suffix}`, rep.cookies);
      const unknown = await api.get(`${B}/${UNKNOWN}${suffix}`, rep.cookies);
      expect(hidden.status, suffix).toBe(404);
      expect(unknown.status, suffix).toBe(404);
      expect(refusal(hidden.body), suffix).toEqual(refusal(unknown.body));
      expect(hidden.raw).not.toContain(mixed.id);
    }

    const other = await orgBook('S470-READ-OTHER', [f.orgs.Acme.id]);
    const foreignChange = await api.get(`${B}/${other.id}/price-history/${change!.id}/lines`);
    const unknownChange = await api.get(`${B}/${other.id}/price-history/${UNKNOWN}/lines`);
    const notUuid = await api.get(`${B}/${other.id}/price-history/not-a-uuid/lines`);
    for (const res of [foreignChange, unknownChange, notUuid]) expect(res.status, res.raw).toBe(404);
    expect(refusal(foreignChange.body)).toEqual(refusal(unknownChange.body));
    expect(refusal(notUuid.body)).toEqual(refusal(unknownChange.body));
    expect((await api.get(`${B}/${other.id}/price-history/products/not-a-uuid`)).status).toBe(404);
    expect((await api.get(`${B}/not-a-uuid/price-history`)).status).toBe(404);
  });

  it('a malformed cursor or limit is a 400', async () => {
    const book = await orgBook('S470-READ-CURSOR', [f.orgs.Acme.id]);
    expect((await api.get(`${B}/${book.id}/price-history?cursor=%%%`)).status).toBe(400);
    expect((await api.get(`${B}/${book.id}/price-history?cursor=bm90LWpzb24`)).status).toBe(400);
    expect((await api.get(`${B}/${book.id}/price-history?limit=201`)).status).toBe(400);
  });

  it('a scoped reader gets the organization ids outside their reach withheld and counted; a platform admin gets them as stored', async () => {
    const book = await orgBook('S470-READ-WITHHELD', [f.orgs.Beta.id, f.orgs.Acme.id]);
    const patched = await api.patch(`${B}/${book.id}`, {
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
      expectedVersion: await version(book.id),
    });
    expect(patched.status, patched.raw).toBe(200);
    // A header written before the kind was recorded (development databases only): read as organizations, so it fails closed.
    await seedChange({
      bookId: book.id,
      at: '2001-01-01T00:00:00.000Z',
      action: 'price_list.update',
      headerBefore: { audience: { memberIds: [f.orgs.Gamma.id, f.orgs.Acme.id] } },
      headerAfter: { audience: { memberIds: [f.orgs.Acme.id] } },
    });

    const asRep = await api.get<PriceBookHistoryChangesResponse>(`${B}/${book.id}/price-history`, rep.cookies);
    expect(asRep.status, asRep.raw).toBe(200);
    const [update, create, legacy] = asRep.body.data as [PriceBookHistoryChange, PriceBookHistoryChange, PriceBookHistoryChange];
    expect(update.headerBefore!.audience).toEqual({ kind: 'organizations', memberIds: [f.orgs.Acme.id], withheldMemberCount: 1 });
    expect(update.headerAfter!.audience).toEqual({ kind: 'organizations', memberIds: [f.orgs.Acme.id], withheldMemberCount: 0 });
    expect(create.headerAfter!.audience).toEqual({ kind: 'organizations', memberIds: [f.orgs.Acme.id], withheldMemberCount: 1 });
    expect(legacy.headerBefore!.audience).toEqual({ kind: 'organizations', memberIds: [f.orgs.Acme.id], withheldMemberCount: 1 });
    expect(asRep.raw).not.toContain(f.orgs.Beta.id);
    expect(asRep.raw).not.toContain(f.orgs.Gamma.id);

    const asAdmin = await api.get<PriceBookHistoryChangesResponse>(`${B}/${book.id}/price-history`);
    expect(asAdmin.body.data[1]!.headerAfter!.audience).toEqual({
      kind: 'organizations',
      memberIds: [f.orgs.Acme.id, f.orgs.Beta.id].sort(),
    });
    expect(asAdmin.body.data[2]!.headerBefore!.audience).toEqual({
      kind: 'organizations',
      memberIds: [f.orgs.Gamma.id, f.orgs.Acme.id], // as stored
    });
  });

  it('a scoped reader on a customer-group book withholds nothing', async () => {
    const { id } = await f.book({ name: 'S470-READ-GROUPS', audience: { groups: [f.groups.VIP, f.groups.Gold] }, activate: false });
    ownBooks.push(id);
    const res = await api.get<PriceBookHistoryChangesResponse>(`${B}/${id}/price-history`, rep.cookies);
    expect(res.status, res.raw).toBe(200);
    const create = res.body.data.find((c) => c.action === 'price_list.create')!;
    expect(create.headerAfter!.audience).toEqual({
      kind: 'customer_groups',
      memberIds: [f.groups.VIP, f.groups.Gold].sort(),
      withheldMemberCount: 0,
    });
  });

  it('pages changes across ties on `at` by id, each exactly once', async () => {
    const book = await orgBook('S470-READ-TIES', [f.orgs.Acme.id]);
    const tied = '2002-02-02T02:02:02.002Z';
    const seeded = await Promise.all(Array.from({ length: 5 }, () => seedChange({ bookId: book.id, at: tied, headerAfter: { name: 'x' } })));
    await seedChange({ bookId: book.id, at: '2001-01-01T00:00:00.000Z', headerAfter: { name: 'oldest' } });

    const { items, pages } = await walk<PriceBookHistoryChange>(`${B}/${book.id}/price-history?limit=2`);
    expect(pages).toBe(4);
    expect(items).toHaveLength(7);
    expect(items[0]!.action).toBe('price_list.create');
    expect(items.slice(1, 6).map((c) => c.id)).toEqual([...seeded].sort().reverse());
    expect(items.slice(1, 6).every((c) => c.at === tied)).toBe(true);
    expect(items[6]!.headerAfter).toEqual({ name: 'oldest' });
    expect(new Set(items.map((c) => c.id)).size).toBe(7);
  });

  it('pages one change’s lines by seq', async () => {
    const book = await orgBook('S470-READ-LINES', [f.orgs.Acme.id]);
    const change = await seedChange({
      bookId: book.id,
      at: '2003-03-03T03:03:03.003Z',
      lines: Array.from({ length: 7 }, (_, i) => ({ kind: 'added' as const, productId: f.products.P1.id, minQuantity: i + 1 })),
    });
    const { items, pages } = await walk<PriceBookHistoryLine>(`${B}/${book.id}/price-history/${change}/lines?limit=3`);
    expect(pages).toBe(3);
    expect(items.map((l) => l.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(items.map((l) => l.minQuantity)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('one product’s history: its own and its variants’ lines, newest first across tied changes; not category or other products’ lines', async () => {
    const book = await orgBook('S470-READ-PRODUCT', [f.orgs.Acme.id]);
    const P5 = f.products.P5.id;
    const tied = '2004-04-04T04:04:04.004Z';
    const lines = [
      { kind: 'changed' as const, productId: P5, before: '0.0125', after: '0.0130' },
      { kind: 'added' as const, productId: f.products.P1.id },
      { kind: 'removed' as const, productId: P5, variantId: f.variants.P5b, before: '3.0000' },
      { kind: 'added' as const, productId: null, categoryId: f.categories.screws },
      { kind: 'added' as const, productId: P5, minQuantity: 10 },
    ];
    const a = await seedChange({ bookId: book.id, at: tied, lines });
    const b = await seedChange({ bookId: book.id, at: tied, lines });
    const old = await seedChange({ bookId: book.id, at: '2001-01-01T00:00:00.000Z', lines: [{ kind: 'added', productId: P5 }] });

    const { items } = await walk<PriceBookHistoryProductLine>(`${B}/${book.id}/price-history/products/${P5}?limit=2`);
    const [hi, lo] = [a, b].sort().reverse();
    expect(items.map((l) => [l.changeId, l.seq])).toEqual([
      [hi, 0],
      [hi, 2],
      [hi, 4],
      [lo, 0],
      [lo, 2],
      [lo, 4],
      [old, 0],
    ]);
    expect(items[1]).toMatchObject({
      kind: 'removed',
      selection: { productId: P5, variantId: f.variants.P5b },
      before: { type: 'fixed', amount: '3.0000' },
      after: null,
      at: tied,
      action: 'price_list.rows_replace',
      actor: { kind: 'system', id: null, name: null },
    });
    expect(items[0]).toMatchObject({ before: { type: 'fixed', amount: '0.0125' }, after: { type: 'fixed', amount: '0.0130' } });

    const none = await api.get<PriceBookHistoryProductLinesResponse>(`${B}/${book.id}/price-history/products/${f.products.P4.id}`);
    expect(none.status, none.raw).toBe(200);
    expect(none.body).toEqual({ data: [], pagination: { cursor: null, hasMore: false, limit: 50 } });
  });

  it('actors: an admin by name (else e-mail; a gone admin by id only), every other kind without id or name', async () => {
    const book = await orgBook('S470-READ-ACTORS', [f.orgs.Acme.id]);
    // The rep writes the book (it is theirs): an admin actor named "first last".
    const renamed = await api.patch(`${B}/${book.id}`, { name: 'S470-READ-ACTORS-2', expectedVersion: await version(book.id) }, rep.cookies);
    expect(renamed.status, renamed.raw).toBe(200);
    const em = h.em().fork();
    const unnamed = em.create(AdminUser, {
      email: `s470-unnamed-${randomUUID().slice(0, 8)}@audit.local`,
      passwordHash: 'x'.repeat(60),
      firstName: '',
      lastName: '',
    });
    await em.persist(unnamed).flush();
    ownAdmins.push(unnamed.id);
    const gone = randomUUID();
    await seedChange({ bookId: book.id, at: '2001-01-04T00:00:00.000Z', actorKind: 'admin', actorAdminUserId: unnamed.id, headerAfter: { name: 'a' } });
    await seedChange({ bookId: book.id, at: '2001-01-03T00:00:00.000Z', actorKind: 'admin', actorAdminUserId: gone, headerAfter: { name: 'b' } });
    // #1052's writer kept the admin id for any kind; the reader serves it only for an admin.
    await seedChange({ bookId: book.id, at: '2001-01-02T00:00:00.000Z', actorKind: 'api_key', actorAdminUserId: unnamed.id, headerAfter: { name: 'c' } });
    await seedChange({ bookId: book.id, at: '2001-01-01T00:00:00.000Z', actorKind: 'system', headerAfter: { name: 'd' } });

    const res = await api.get<PriceBookHistoryChangesResponse>(`${B}/${book.id}/price-history`);
    expect(res.status, res.raw).toBe(200);
    const [created] = await sql<{ actor_admin_user_id: string }>(
      `select "actor_admin_user_id" from "price_list_value_changes" where "price_list_id" = ? and "action" = 'price_list.create'`,
      [book.id],
    );
    const [creator] = await sql<{ first_name: string; last_name: string; email: string }>(
      `select "first_name", "last_name", "email" from "admin_users" where "id" = ?`,
      [created!.actor_admin_user_id],
    );
    expect(res.body.data.map((c) => c.actor)).toEqual([
      { kind: 'admin', id: rep.adminUserId, name: 'Price book rep' },
      {
        kind: 'admin',
        id: created!.actor_admin_user_id,
        name: creator ? `${creator.first_name} ${creator.last_name}`.trim() || creator.email : null,
      },
      { kind: 'admin', id: unnamed.id, name: unnamed.email },
      { kind: 'admin', id: gone, name: null },
      { kind: 'api_key', id: null, name: null },
      { kind: 'system', id: null, name: null },
    ]);
  });

  it('an empty history is an empty page', async () => {
    const book = await orgBook('S470-READ-EMPTY', [f.orgs.Acme.id]);
    await sql(`delete from "price_list_value_changes" where "price_list_id" = ?`, [book.id]);
    const res = await api.get<PriceBookHistoryChangesResponse>(`${B}/${book.id}/price-history`, rep.cookies);
    expect(res.status, res.raw).toBe(200);
    expect(res.body).toEqual({ data: [], pagination: { cursor: null, hasMore: false, limit: 50 } });
  });
});
