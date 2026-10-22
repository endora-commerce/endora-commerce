import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { BASE_BOOK_ID } from '../../helpers/price-book-sql.js';

/**
 * Feature 011 / US2 → feature 160 — a price book's status lifecycle (T034, on
 * price books).
 *
 * `status` is what the admin shows; whether a book applies is read from its
 * dates at resolution time (FR-047, `applicability-dates.test.ts`). Verifies:
 *   - activation lands on `scheduled` for a future start and on `active`
 *     otherwise (FR-009 rows 1–2);
 *   - the status worker promotes `scheduled → active` and expires
 *     `active → expired` once the instants pass (rows 3–4), and a sweep with
 *     nothing due changes nothing;
 *   - an end not after the start is refused (FR-010);
 *   - an expired book can be moved back to draft (row 5), a base book cannot.
 *
 * The CRUD, duplication and base-book protections of the old `PriceListService`
 * are the price-book API's now: `contract/price_lists/price-books-api.test.ts`
 * and `price-book-duplicate.test.ts`.
 */
describe('price books — status lifecycle (feature 160, T034)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const DAY = 86_400_000;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const statusOf = async (id: string) =>
    (await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [id]))[0]!.status;
  const versionOf = async (id: string) =>
    Number((await sql<{ version: number }>(`select "version" from "price_lists" where "id" = ?`, [id]))[0]!.version);
  const worker = () =>
    (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      handle: { statusWorker: { sweep(now: Date): Promise<{ scheduledToActive: number; activeToExpired: number }> } };
    }>('priceLists').handle.statusWorker;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  const rows = () => [{ product: f.products.P1, fixed: '10' }];

  it('FR-009 rows 1–2: activation is scheduled for a future start, active otherwise', async () => {
    const later = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
    expect(await statusOf(later.id)).toBe('scheduled');
    const now = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() - DAY) });
    expect(await statusOf(now.id)).toBe('active');
  });

  it('FR-009 rows 3–4: the worker promotes and expires once the instants pass; nothing due changes nothing', async () => {
    const scheduled = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
    const live = await f.book({
      audience: 'everyone',
      rows: rows(),
      startsAt: new Date(Date.now() - DAY),
      endsAt: new Date(Date.now() + DAY),
    });
    const idle = await worker().sweep(new Date());
    expect(idle).toEqual({ scheduledToActive: 0, activeToExpired: 0 });
    const result = await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(result.scheduledToActive).toBeGreaterThanOrEqual(1);
    expect(result.activeToExpired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(scheduled.id)).toBe('active');
    expect(await statusOf(live.id)).toBe('expired');
    const again = await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(again).toEqual({ scheduledToActive: 0, activeToExpired: 0 });
  });

  it('FR-010: an end not after the start is refused', async () => {
    const book = await f.book({ audience: 'everyone', rows: rows(), activate: false });
    const start = new Date(Date.now() + DAY).toISOString();
    const expectedVersion = await versionOf(book.id);
    await expect(
      f.system(() => f.books.patchBook(book.id, { startsAt: start, endsAt: start }, { expectedVersion })),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('FR-009 row 5: an expired book can be moved back to draft; a base book cannot', async () => {
    const book = await f.book({
      audience: 'everyone',
      rows: rows(),
      startsAt: new Date(Date.now() - 2 * DAY),
      endsAt: new Date(Date.now() + DAY),
    });
    await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(await statusOf(book.id)).toBe('expired');
    await f.system(() => f.books.draftify(book.id));
    expect(await statusOf(book.id)).toBe('draft');
    await expect(f.system(() => f.books.draftify(BASE_BOOK_ID))).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD,
    });
  });
});
