import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  customerNotificationListResponseSchema,
  customerNotificationUnreadCountResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_CUSTOMER_RFQ_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The centre's storefront API
 * (`specs/179-rfq-and-customer-notifications/contracts/customer-notifications-storefront-api.md`,
 * FR-042 – FR-045, T061) against a database.
 *
 * Every visibility predicate is held in the query, so each is shown by an entry
 * it must hide sitting beside the entries it must show: another account's entry
 * of the same Organization, an entry of another sales channel, and an entry
 * whose producing module is not present.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const COLLEAGUE = { b2b_session: 'stub-customer-session-rfq' };
const DEFAULT = { 'x-sales-channel': 'default' };
const RETAIL = { 'x-sales-channel': 'pl_retail' };
const SOURCE = `cn-contract-${randomUUID().slice(0, 8)}`;

interface Seed {
  account?: string;
  channel?: string | null;
  sourceModule?: string;
  title?: string;
  titleMessage?: { scope: string; key: string; params: Record<string, string | number> };
  body?: string | null;
  linkPath?: string | null;
  createdAt: Date;
  readAt?: Date | null;
}

describe('customer_notifications storefront API', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let retailChannelId: string;

  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);

  async function seed(entry: Seed): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "customer_notifications"
         ("id", "organization_id", "customer_account_id", "sales_channel_id", "source_module", "source_key",
          "kind", "subject_type", "subject_id", "title", "title_message", "body", "body_message", "link_path",
          "created_at", "read_at")
       values (?, ?, ?, ?, ?, ?, 'test.kind', 'quote_request', ?, ?, ?::jsonb, ?, null, ?, ?, ?)`,
      [
        id,
        TEST_ORGANIZATION_ID,
        entry.account ?? TEST_CUSTOMER_ID,
        entry.channel === undefined ? defaultChannelId : entry.channel,
        entry.sourceModule ?? 'customer_notifications',
        `${SOURCE}:${id}`,
        id,
        entry.title ?? `Entry ${id}`,
        JSON.stringify(entry.titleMessage ?? { scope: 'customer_notifications', key: 'test.missing.key', params: {} }),
        entry.body ?? null,
        entry.linkPath === undefined ? `/quote-requests/${id}` : entry.linkPath,
        entry.createdAt,
        entry.readAt ?? null,
      ],
    );
    return id;
  }

  const clear = () =>
    sql(`delete from "customer_notifications" where "source_key" like ?`, [`${SOURCE}:%`]);

  const get = (url: string, cookies: Record<string, string> | null = BUYER, headers: Record<string, string> = DEFAULT) =>
    h.app.inject({ method: 'GET', url, ...(cookies ? { cookies } : {}), headers });

  const post = (url: string, cookies: Record<string, string> | null = BUYER, headers: Record<string, string> = DEFAULT) =>
    h.app.inject({ method: 'POST', url, ...(cookies ? { cookies } : {}), headers });

  const listIds = async (query = '', headers: Record<string, string> = DEFAULT) => {
    const res = await get(`/api/v1/storefront/notifications${query}`, BUYER, headers);
    expect(res.statusCode, res.body).toBe(200);
    return customerNotificationListResponseSchema.parse(res.json()).data;
  };

  const readAtOf = async (id: string): Promise<Date | null> => {
    const rows = (await sql(`select "read_at" from "customer_notifications" where "id" = ?`, [id])) as Array<{
      read_at: Date | null;
    }>;
    return rows[0]!.read_at;
  };

  const at = (minutesAgo: number) => new Date(Date.UTC(2026, 10, 13, 12, 0, 0, 0) - minutesAgo * 60_000);

  beforeAll(async () => {
    h = await setupBackendServer();
    const channels = (await sql(`select "id", "code" from "sales_channels" where "code" in ('default', 'pl_retail')`)) as Array<{
      id: string;
      code: string;
    }>;
    defaultChannelId = channels.find((c) => c.code === 'default')!.id;
    retailChannelId = channels.find((c) => c.code === 'pl_retail')!.id;
  });

  beforeEach(clear);

  afterAll(async () => {
    await clear();
    await teardownBackendServer(h);
  });

  it('refuses a caller who is not a signed-in customer with 401', async () => {
    for (const res of [
      await get('/api/v1/storefront/notifications', null),
      await get('/api/v1/storefront/notifications/unread-count', null),
      await post(`/api/v1/storefront/notifications/${randomUUID()}/read`, null),
      await post('/api/v1/storefront/notifications/read-all', null),
    ]) {
      expect(res.statusCode, res.body).toBe(401);
    }
  });

  it("lists the caller's own entries of this channel and of no channel, newest first, private and uncached", async () => {
    const own = await seed({ createdAt: at(1) });
    const everyChannel = await seed({ channel: null, createdAt: at(2) });
    const ownOlder = await seed({ createdAt: at(3), readAt: at(0) });
    await seed({ channel: retailChannelId, createdAt: at(0) }); // another channel
    await seed({ account: TEST_CUSTOMER_RFQ_ID, createdAt: at(0) }); // a colleague's
    await seed({ sourceModule: 'module_that_is_not_installed', createdAt: at(0) }); // producer absent

    const res = await get('/api/v1/storefront/notifications');

    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const data = customerNotificationListResponseSchema.parse(res.json()).data;
    expect(data.items.map((item) => item.id)).toEqual([own, everyChannel, ownOlder]);
    expect(data.unreadCount).toBe(2);
    expect(data.nextCursor).toBeNull();
    expect(data.items[2]!.readAt).toBe(at(0).toISOString());
    expect(data.items[0]).toMatchObject({ kind: 'test.kind', subject: { type: 'quote_request', id: own }, linkPath: `/quote-requests/${own}` });
  });

  it('shows the other channel its own entry and the every-channel one, and not this one', async () => {
    await seed({ createdAt: at(1) });
    const everyChannel = await seed({ channel: null, createdAt: at(2) });
    const retail = await seed({ channel: retailChannelId, createdAt: at(3) });

    const data = await listIds('', RETAIL);

    expect(data.items.map((item) => item.id)).toEqual([everyChannel, retail]);
  });

  it('pages by a stable keyset cursor, also across entries created in the same millisecond', async () => {
    const same = at(5);
    const ids = [
      await seed({ createdAt: at(1) }),
      await seed({ createdAt: same }),
      await seed({ createdAt: same }),
      await seed({ createdAt: same }),
      await seed({ createdAt: at(9) }),
    ];
    const tied = ids.slice(1, 4).sort().reverse();
    const expected = [ids[0]!, ...tied, ids[4]!];

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = await listIds(query);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      // An entry created between two pages, newer than every one read, must not shift the next page.
      if (pages === 1) await seed({ createdAt: at(0) });
    } while (cursor !== null && pages < 10);

    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
  });

  it('refuses a limit outside 1..50 and a malformed cursor with 400', async () => {
    for (const query of ['?limit=0', '?limit=51', '?limit=x', '?cursor=%%%']) {
      const res = await get(`/api/v1/storefront/notifications${query}`);
      expect(res.statusCode, `${query}: ${res.body}`).toBe(400);
    }
  });

  it('renders an entry in the request language, and the stored English sentence when the key does not resolve', async () => {
    const translated = await seed({
      title: 'Customer notifications',
      titleMessage: { scope: 'customer_notifications', key: 'settingGroups.customer_notifications.name', params: {} },
      createdAt: at(1),
    });
    const untranslated = await seed({ title: 'The stored English sentence', createdAt: at(2) });

    const data = await listIds('', { ...DEFAULT, 'accept-language': 'pl-PL' });

    expect(data.items.find((item) => item.id === translated)!.title).toBe('Powiadomienia klientów');
    expect(data.items.find((item) => item.id === untranslated)!.title).toBe('The stored English sentence');
  });

  it('counts the unread entries the list would show', async () => {
    await seed({ createdAt: at(1) });
    await seed({ channel: null, createdAt: at(2) });
    await seed({ createdAt: at(3), readAt: at(1) });
    await seed({ channel: retailChannelId, createdAt: at(4) });
    await seed({ account: TEST_CUSTOMER_RFQ_ID, createdAt: at(4) });

    const res = await get('/api/v1/storefront/notifications/unread-count');

    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(customerNotificationUnreadCountResponseSchema.parse(res.json())).toEqual({ data: { unreadCount: 2 } });
  });

  it("marks one of the caller's entries read, and answers 404 for anyone else's or an unknown id", async () => {
    const own = await seed({ createdAt: at(1) });
    const colleagues = await seed({ account: TEST_CUSTOMER_RFQ_ID, createdAt: at(1) });

    const mark = await post(`/api/v1/storefront/notifications/${own}/read`);
    expect(mark.statusCode, mark.body).toBe(204);
    expect(mark.headers['cache-control']).toBe('private, no-store');
    const firstReadAt = await readAtOf(own);
    expect(firstReadAt).not.toBeNull();

    // Marking it again changes nothing and still succeeds.
    expect((await post(`/api/v1/storefront/notifications/${own}/read`)).statusCode).toBe(204);
    expect(await readAtOf(own)).toEqual(firstReadAt);

    const foreign = await post(`/api/v1/storefront/notifications/${colleagues}/read`);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json().error.code).toBe('NOT_FOUND');
    expect(await readAtOf(colleagues)).toBeNull();

    expect((await post(`/api/v1/storefront/notifications/${randomUUID()}/read`)).statusCode).toBe(404);
    expect((await post('/api/v1/storefront/notifications/not-a-uuid/read')).statusCode).toBe(404);

    // The colleague reads their own.
    expect((await post(`/api/v1/storefront/notifications/${colleagues}/read`, COLLEAGUE)).statusCode).toBe(204);
  });

  it('marks exactly what the list shows read, leaving another channel and another account unread', async () => {
    const own = await seed({ createdAt: at(1) });
    const everyChannel = await seed({ channel: null, createdAt: at(2) });
    const retail = await seed({ channel: retailChannelId, createdAt: at(3) });
    const colleagues = await seed({ account: TEST_CUSTOMER_RFQ_ID, createdAt: at(3) });

    const res = await post('/api/v1/storefront/notifications/read-all');

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { updated: 2 } });
    expect(await readAtOf(own)).not.toBeNull();
    expect(await readAtOf(everyChannel)).not.toBeNull();
    expect(await readAtOf(retail)).toBeNull();
    expect(await readAtOf(colleagues)).toBeNull();
    expect(customerNotificationUnreadCountResponseSchema.parse(
      (await get('/api/v1/storefront/notifications/unread-count', BUYER, RETAIL)).json(),
    ).data.unreadCount).toBe(1);
  });

  it('under impersonation answers the reads and writes nothing', async () => {
    const own = await seed({ createdAt: at(1) });

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: 'platform-admin@example.com', password: 'stub-password-change-me-1234' },
    });
    expect(login.statusCode, login.body).toBe(200);
    const adminSession = cookieOf(login.headers['set-cookie'], 'b2b_admin_session');
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_ID },
      cookies: { b2b_admin_session: adminSession },
    });
    expect(start.statusCode, start.body).toBe(200);
    const impersonated = { b2b_session: cookieOf(start.headers['set-cookie'], 'b2b_session') };

    const list = await get('/api/v1/storefront/notifications', impersonated);
    expect(list.statusCode, list.body).toBe(200);
    expect(customerNotificationListResponseSchema.parse(list.json()).data.items.map((item) => item.id)).toEqual([own]);

    const mark = await post(`/api/v1/storefront/notifications/${own}/read`, impersonated);
    expect(mark.statusCode, mark.body).toBe(204);
    const all = await post('/api/v1/storefront/notifications/read-all', impersonated);
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json()).toEqual({ data: { updated: 0 } });

    expect(await readAtOf(own)).toBeNull();
  });
});

function cookieOf(setCookie: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  for (const header of headers) {
    const match = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(header);
    if (match?.[1]) return match[1];
  }
  throw new Error(`no ${name} cookie in the answer`);
}
