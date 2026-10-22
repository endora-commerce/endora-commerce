import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-003, FR-011; Principle XII) — a price book applies on a
 * channel of its set while that channel offers the book's currency
 * (`specs/pricing/worked-examples.md` §10.12). The set is the registered
 * `sales_channel_price_lists` bridge, written through the membership accessor.
 */
describe('price books — channel sets and currency (K1–K3, Principle XII)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const setCurrencies = (channelId: string, currencies: string[]) =>
    sql(`update "sales_channels" set "currencies" = ?::jsonb, "default_currency" = ? where "id" = ?`, [
      JSON.stringify(currencies),
      currencies[0],
      channelId,
    ]);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
    await setCurrencies(f.channels.CH2.id, ['PLN', 'EUR']);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** L11: regular, PLN, everyone, channels {CH1, CH2}: P2 fixed 48. */
  const l11 = () =>
    f.book({
      name: 'L11',
      audience: 'everyone',
      channels: [f.channels.CH1, f.channels.CH2],
      rows: [{ product: f.products.P2, fixed: '48' }],
    });

  it('K1.1, K1.2 — the book applies on every channel of its set', async () => {
    await l11();
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH1 })).toBe('48.0000');
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2 })).toBe('48.0000');
  });

  it('K1.3 — another currency on the same channel: no EUR price anywhere', async () => {
    await l11();
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2, currency: 'EUR' })).toBeNull();
  });

  it('K2 — a channel set with a channel not offering the currency is refused, naming it', async () => {
    const attempt = f.system(() =>
      f.books.createBook({
        name: 'K2',
        type: 'regular',
        currencyCode: 'PLN',
        channelIds: [f.channels.CH1.id, f.channels.CH3.id],
        audience: { kind: 'everyone', memberIds: [] },
        priority: 0,
      }),
    );
    await expect(attempt).rejects.toMatchObject({ statusCode: 400, code: 'PRICE_BOOK_CHANNEL_CURRENCY' });
    await expect(attempt).rejects.toThrow(f.channels.CH3.code);
  });

  it('K3.1–K3.3 — a channel that stops offering the currency stops using the book, and resumes', async () => {
    const book = await l11();
    await setCurrencies(f.channels.CH2.id, ['EUR']);
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH1 })).toBe('48.0000');
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2, currency: 'PLN' })).toBeNull();
    const set = await f.books.channelSet(book.id);
    expect(set.channels).toEqual(
      expect.arrayContaining([
        { channelId: f.channels.CH1.id, dormant: false },
        { channelId: f.channels.CH2.id, dormant: true },
      ]),
    );
    await setCurrencies(f.channels.CH2.id, ['PLN', 'EUR']);
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2 })).toBe('48.0000');
  });

  it('a book bound to another channel never applies', async () => {
    await f.book({ audience: 'everyone', channels: [f.channels.CH1], rows: [{ product: f.products.P2, fixed: '48' }] });
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2 })).toBe('50.0000');
  });

  it('an unknown channel prices nothing (fails closed)', async () => {
    await l11();
    const line = await f.pricing.resolveLinePrices({
      lines: [{ key: 'k', product: f.products.P2, quantity: 1 }],
      context: { salesChannel: { id: '00000000-0000-4000-8000-0000000000ff', defaultCurrency: 'PLN' } },
    });
    expect(line.get('k')).toBeNull();
  });

  it('a currency the channel does not offer prices nothing', async () => {
    await l11();
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH1, currency: 'EUR' })).toBeNull();
  });

  it('the channel set is written through the membership accessor and read back from the bridge', async () => {
    const book = await l11();
    const membership = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      listChannelsForEntity(type: string, id: string): Promise<Array<{ id: string }>>;
    }>('salesChannelMembershipPort');
    const bound = (await membership.listChannelsForEntity('price-list', book.id)).map((c) => c.id).sort();
    expect(bound).toEqual([f.channels.CH1.id, f.channels.CH2.id].sort());
    await f.system(() => f.books.replaceChannels(book.id, [f.channels.CH1.id]));
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2 })).toBe('50.0000');
    await expect(f.system(() => f.books.replaceChannels(book.id, [f.channels.CH3.id]))).rejects.toMatchObject({
      statusCode: 400,
      code: 'PRICE_BOOK_CHANNEL_CURRENCY',
    });
  });

  it('a book whose every binding is dormant cannot be activated', async () => {
    const draft = await f.book({ audience: 'everyone', channels: [f.channels.CH2], activate: false, rows: [{ product: f.products.P2, fixed: '48' }] });
    await setCurrencies(f.channels.CH2.id, ['EUR']);
    await expect(f.system(() => f.books.activate(draft.id))).rejects.toMatchObject({ statusCode: 409, code: 'PRICE_BOOK_NOT_APPLICABLE' });
  });
});
