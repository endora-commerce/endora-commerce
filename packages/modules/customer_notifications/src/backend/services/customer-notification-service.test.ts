import { describe, expect, it, vi } from 'vitest';
import { customerNotificationListResponseSchema } from '@endora-commerce/contracts';
import { CustomerNotification } from '../entities/customer-notification.entity.js';
import {
  CustomerNotificationService,
  decodeCursor,
  encodeCursor,
  type CustomerNotificationStore,
  type NotificationReader,
  type NotificationVisibility,
} from './customer-notification-service.js';

/**
 * The storefront half of the centre (`contracts/customer-notifications-storefront-api.md`,
 * FR-042 – FR-045, T061), over a fake store.
 *
 * What is held here is the service's own logic: which visibility it hands the
 * store (the reader's account, the resolved channel, the producers that are
 * present), the keyset cursor, translation on read with the English fallback,
 * and the impersonation no-op. That the store's SQL honours the visibility it
 * is handed is the contract test's
 * (`backend/test/contract/customer_notifications/storefront-api.test.ts`).
 */

const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const ORG = '00000000-0000-4000-8000-0000000000aa';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';

function reader(overrides: Partial<NotificationReader> = {}): NotificationReader {
  return {
    customerAccountId: ACCOUNT,
    organizationId: ORG,
    salesChannelId: CHANNEL,
    language: 'pl',
    impersonating: false,
    ...overrides,
  };
}

function entry(n: number, overrides: Partial<CustomerNotification> = {}): CustomerNotification {
  const row = new CustomerNotification();
  Object.assign(row, {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    organizationId: ORG,
    customerAccountId: ACCOUNT,
    salesChannelId: CHANNEL,
    sourceModule: 'quote_requests',
    sourceKey: `key-${n}`,
    kind: 'quote_requests.approved',
    subjectType: 'quote_request',
    subjectId: '00000000-0000-4000-8000-0000000000d1',
    title: `Quote request QR-${n} was approved`,
    titleMessage: { scope: 'quote_requests', key: 'customerNotifications.approved.title', params: { number: `QR-${n}` } },
    body: null,
    bodyMessage: null,
    linkPath: '/quote-requests/00000000-0000-4000-8000-0000000000d1',
    createdAt: new Date(Date.UTC(2026, 10, 12, 10, 0, 0, 0) - n * 1000),
    readAt: null,
    ...overrides,
  });
  return row;
}

interface FakeStore extends CustomerNotificationStore {
  list: ReturnType<typeof vi.fn> & CustomerNotificationStore['list'];
  countUnread: ReturnType<typeof vi.fn> & CustomerNotificationStore['countUnread'];
  markRead: ReturnType<typeof vi.fn> & CustomerNotificationStore['markRead'];
  markAllRead: ReturnType<typeof vi.fn> & CustomerNotificationStore['markAllRead'];
}

function fakeStore(rows: CustomerNotification[] = [], unread = 0, owned = true, updated = 0): FakeStore {
  return {
    list: vi.fn(async () => rows),
    countUnread: vi.fn(async () => unread),
    markRead: vi.fn(async () => owned),
    markAllRead: vi.fn(async () => updated),
  } as unknown as FakeStore;
}

/** `_i18n`'s answer for a key it holds, and the `<scope>.<key>` placeholder for one it does not. */
function translator(known: Record<string, string>) {
  return vi.fn(async (scope: string, key: string, _language: string, params?: Record<string, string | number>) => {
    const template = known[`${scope}:${key}`];
    if (template === undefined) return `${scope}.${key}`;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? `{${name}}`));
  });
}

function service(store: CustomerNotificationStore, opts: { present?: string[]; known?: Record<string, string> } = {}) {
  const translate = translator(opts.known ?? {});
  const now = new Date('2026-11-13T12:00:00.000Z');
  return {
    translate,
    now,
    svc: new CustomerNotificationService({
      store,
      translate,
      presentModules: () => opts.present ?? ['quote_requests', 'customer_notifications'],
      now: () => now,
    }),
  };
}

const visibility = (overrides: Partial<NotificationVisibility> = {}): NotificationVisibility => ({
  customerAccountId: ACCOUNT,
  salesChannelId: CHANNEL,
  sourceModules: ['quote_requests', 'customer_notifications'],
  ...overrides,
});

describe('CustomerNotificationService.list', () => {
  it("asks the store for the reader's own entries on the resolved channel, from present producers only", async () => {
    const store = fakeStore([], 0);
    const { svc } = service(store, { present: ['quote_requests', 'orders'] });

    await svc.list(reader(), { limit: 20, cursor: null });

    expect(store.list).toHaveBeenCalledWith(
      visibility({ sourceModules: ['quote_requests', 'orders'] }),
      { limit: 21, after: null },
    );
    expect(store.countUnread).toHaveBeenCalledWith(visibility({ sourceModules: ['quote_requests', 'orders'] }));
  });

  it('answers the contract shape, translated in the request language', async () => {
    const store = fakeStore([entry(1)], 3);
    const { svc } = service(store, {
      known: { 'quote_requests:customerNotifications.approved.title': 'Zapytanie {number} zostało zatwierdzone' },
    });

    const answer = await svc.list(reader(), { limit: 20, cursor: null });

    expect(customerNotificationListResponseSchema.parse({ data: answer })).toEqual({ data: answer });
    expect(answer).toEqual({
      items: [
        {
          id: entry(1).id,
          kind: 'quote_requests.approved',
          title: 'Zapytanie QR-1 zostało zatwierdzone',
          body: null,
          subject: { type: 'quote_request', id: '00000000-0000-4000-8000-0000000000d1' },
          linkPath: '/quote-requests/00000000-0000-4000-8000-0000000000d1',
          createdAt: entry(1).createdAt.toISOString(),
          readAt: null,
        },
      ],
      nextCursor: null,
      unreadCount: 3,
    });
  });

  it('passes the request language to the translator', async () => {
    const store = fakeStore([entry(1)]);
    const { svc, translate } = service(store);

    await svc.list(reader({ language: 'en' }), { limit: 20, cursor: null });

    expect(translate).toHaveBeenCalledWith('quote_requests', 'customerNotifications.approved.title', 'en', {
      number: 'QR-1',
    });
  });

  it('falls back to the stored English sentence when the key does not resolve', async () => {
    const store = fakeStore([
      entry(1, {
        body: 'The offer is valid until 1 December.',
        bodyMessage: { scope: 'quote_requests', key: 'missing.body', params: {} },
      }),
    ]);
    const { svc } = service(store, { known: {} });

    const answer = await svc.list(reader(), { limit: 20, cursor: null });

    expect(answer.items[0]).toMatchObject({
      title: 'Quote request QR-1 was approved',
      body: 'The offer is valid until 1 December.',
    });
  });

  it('answers the stored body when there is no body message, and no subject without both halves', async () => {
    const store = fakeStore([entry(1, { body: 'Plain body', subjectType: null, subjectId: null, linkPath: null })]);
    const { svc } = service(store);

    const [item] = (await svc.list(reader(), { limit: 20, cursor: null })).items;

    expect(item).toMatchObject({ body: 'Plain body', subject: null, linkPath: null });
  });

  it('answers a read entry with its read time', async () => {
    const readAt = new Date('2026-11-12T11:00:00.000Z');
    const store = fakeStore([entry(1, { readAt })]);
    const { svc } = service(store);

    const [item] = (await svc.list(reader(), { limit: 20, cursor: null })).items;

    expect(item!.readAt).toBe(readAt.toISOString());
  });

  it('answers a next cursor when the store had one more row than the page, and drops that row', async () => {
    const rows = [entry(1), entry(2), entry(3)];
    const store = fakeStore(rows);
    const { svc } = service(store);

    const answer = await svc.list(reader(), { limit: 2, cursor: null });

    expect(store.list).toHaveBeenCalledWith(visibility(), { limit: 3, after: null });
    expect(answer.items.map((item) => item.id)).toEqual([rows[0]!.id, rows[1]!.id]);
    expect(answer.nextCursor).not.toBeNull();
    expect(decodeCursor(answer.nextCursor!)).toEqual({ createdAt: rows[1]!.createdAt, id: rows[1]!.id });
  });

  it('hands a cursor back to the store as the position after which to read', async () => {
    const store = fakeStore([]);
    const { svc } = service(store);
    const after = { createdAt: new Date('2026-11-01T08:00:00.123Z'), id: entry(9).id };

    await svc.list(reader(), { limit: 20, cursor: encodeCursor(after) });

    expect(store.list).toHaveBeenCalledWith(visibility(), { limit: 21, after });
  });

  it.each([['not base64 json', '%%%'], ['json of the wrong shape', Buffer.from('{"x":1}').toString('base64url')]])(
    'refuses a cursor that is %s with 400',
    async (_label, cursor) => {
      const { svc } = service(fakeStore());
      await expect(svc.list(reader(), { limit: 20, cursor })).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
      });
    },
  );

  it('reads nothing for a reader whose producers are all absent', async () => {
    const store = fakeStore([entry(1)], 1);
    const { svc } = service(store, { present: [] });

    const answer = await svc.list(reader(), { limit: 20, cursor: null });

    expect(answer).toEqual({ items: [], nextCursor: null, unreadCount: 0 });
    expect(store.list).not.toHaveBeenCalled();
  });

  it('answers reads normally under impersonation', async () => {
    const store = fakeStore([entry(1)], 1);
    const { svc } = service(store);

    const answer = await svc.list(reader({ impersonating: true }), { limit: 20, cursor: null });

    expect(answer.items).toHaveLength(1);
    expect(answer.unreadCount).toBe(1);
  });
});

describe('CustomerNotificationService.unreadCount', () => {
  it('counts with the same visibility the list uses', async () => {
    const store = fakeStore([], 4);
    const { svc } = service(store);

    expect(await svc.unreadCount(reader())).toBe(4);
    expect(store.countUnread).toHaveBeenCalledWith(visibility());
  });
});

describe('CustomerNotificationService.markRead', () => {
  it('marks a visible entry of the reader read at now', async () => {
    const store = fakeStore([], 0, true);
    const { svc, now } = service(store);

    await svc.markRead(reader(), entry(1).id);

    expect(store.markRead).toHaveBeenCalledWith(visibility(), entry(1).id, now);
  });

  it("answers 404 NOT_FOUND for an id that is not the reader's", async () => {
    const store = fakeStore([], 0, false);
    const { svc } = service(store);

    await expect(svc.markRead(reader(), entry(1).id)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('answers 404 for an id that is not a uuid without asking the store', async () => {
    const store = fakeStore();
    const { svc } = service(store);

    await expect(svc.markRead(reader(), 'not-a-uuid')).rejects.toMatchObject({ statusCode: 404 });
    expect(store.markRead).not.toHaveBeenCalled();
  });

  it('writes nothing under impersonation and answers as if it succeeded', async () => {
    const store = fakeStore([], 0, true);
    const { svc } = service(store);

    await expect(svc.markRead(reader({ impersonating: true }), entry(1).id)).resolves.toBeUndefined();
    expect(store.markRead).not.toHaveBeenCalled();
  });
});

describe('CustomerNotificationService.markAllRead', () => {
  it('marks exactly what the list would show and answers how many changed', async () => {
    const store = fakeStore([], 0, true, 5);
    const { svc, now } = service(store);

    expect(await svc.markAllRead(reader())).toEqual({ updated: 5 });
    expect(store.markAllRead).toHaveBeenCalledWith(visibility(), now);
  });

  it('writes nothing under impersonation and answers zero', async () => {
    const store = fakeStore([], 0, true, 5);
    const { svc } = service(store);

    expect(await svc.markAllRead(reader({ impersonating: true }))).toEqual({ updated: 0 });
    expect(store.markAllRead).not.toHaveBeenCalled();
  });
});

describe('the cursor', () => {
  it('round-trips a position at millisecond precision', () => {
    const position = { createdAt: new Date('2026-11-12T10:00:00.007Z'), id: entry(4).id };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('is base64url', () => {
    expect(encodeCursor({ createdAt: new Date(), id: entry(4).id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
