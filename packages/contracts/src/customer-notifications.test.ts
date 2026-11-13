import { describe, expect, it } from 'vitest';
import {
  customerNotificationListResponseSchema,
  customerNotificationResponseSchema,
  customerNotificationSchema,
  customerNotificationUnreadCountResponseSchema,
  type CustomerNotificationRecord,
  type CustomerNotificationRecordPort,
  type RecordCustomerNotificationInput,
} from './customer-notifications.js';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-01 (T001) — the storefront
 * notification-centre shapes (`contracts/customer-notifications-storefront-api.md`
 * §2) and the producers' port types (`contracts/delivery-and-ports.md` §1).
 */

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-11-12T10:15:30.000Z';

const ENTRY = {
  id: ID(1),
  kind: 'quote_requests.approved',
  title: 'Quote request RFQ-0042 was approved',
  body: null,
  subject: { type: 'quote_request', id: ID(2) },
  linkPath: '/quote-requests/00000000-0000-4000-8000-000000000002',
  createdAt: AT,
  readAt: null,
};

describe('customerNotificationSchema', () => {
  it('parses an unread entry with a subject and a link', () => {
    expect(customerNotificationSchema.parse(ENTRY)).toEqual(ENTRY);
  });

  it('parses a read entry with no subject, no link and a body', () => {
    const read = { ...ENTRY, subject: null, linkPath: null, body: 'Details', readAt: AT };
    expect(customerNotificationSchema.parse(read)).toEqual(read);
  });

  it('is strict: an unknown key is refused rather than stripped', () => {
    expect(customerNotificationSchema.safeParse({ ...ENTRY, sourceModule: 'quote_requests' }).success).toBe(false);
    expect(customerNotificationSchema.safeParse({ ...ENTRY, titleMessage: { scope: 'x', key: 'y' } }).success).toBe(
      false,
    );
  });

  it('requires every field, with null rather than absence for the nullable ones', () => {
    for (const key of Object.keys(ENTRY)) {
      const copy: Record<string, unknown> = { ...ENTRY };
      delete copy[key];
      expect(customerNotificationSchema.safeParse(copy).success, key).toBe(false);
    }
  });

  it('refuses a non-uuid id or subject id and a non-ISO date', () => {
    expect(customerNotificationSchema.safeParse({ ...ENTRY, id: 'n-1' }).success).toBe(false);
    expect(customerNotificationSchema.safeParse({ ...ENTRY, subject: { type: 'quote_request', id: 'x' } }).success).toBe(
      false,
    );
    expect(customerNotificationSchema.safeParse({ ...ENTRY, createdAt: '12.11.2026' }).success).toBe(false);
    expect(customerNotificationSchema.safeParse({ ...ENTRY, readAt: 'yesterday' }).success).toBe(false);
  });
});

describe('customerNotificationListResponseSchema', () => {
  it('parses a page with a cursor and an unread count', () => {
    const page = { data: { items: [ENTRY], nextCursor: 'eyJjIjoiMjAyNiJ9', unreadCount: 3 } };
    expect(customerNotificationListResponseSchema.parse(page)).toEqual(page);
  });

  it('parses the last page (nextCursor null) and an empty list', () => {
    const page = { data: { items: [], nextCursor: null, unreadCount: 0 } };
    expect(customerNotificationListResponseSchema.parse(page)).toEqual(page);
  });

  it('refuses a negative or fractional unread count and a missing cursor', () => {
    expect(
      customerNotificationListResponseSchema.safeParse({ data: { items: [], nextCursor: null, unreadCount: -1 } })
        .success,
    ).toBe(false);
    expect(
      customerNotificationListResponseSchema.safeParse({ data: { items: [], nextCursor: null, unreadCount: 1.5 } })
        .success,
    ).toBe(false);
    expect(customerNotificationListResponseSchema.safeParse({ data: { items: [], unreadCount: 0 } }).success).toBe(
      false,
    );
  });

  it('refuses an item that is not a valid entry', () => {
    expect(
      customerNotificationListResponseSchema.safeParse({
        data: { items: [{ ...ENTRY, extra: true }], nextCursor: null, unreadCount: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('customerNotificationResponseSchema', () => {
  it('parses { data: <one entry> }', () => {
    expect(customerNotificationResponseSchema.parse({ data: ENTRY })).toEqual({ data: ENTRY });
  });

  it('refuses an entry that is not a valid one, and a bare entry without the envelope', () => {
    expect(customerNotificationResponseSchema.safeParse({ data: { ...ENTRY, extra: true } }).success).toBe(false);
    expect(customerNotificationResponseSchema.safeParse(ENTRY).success).toBe(false);
  });
});

describe('customerNotificationUnreadCountResponseSchema', () => {
  it('parses { data: { unreadCount } }', () => {
    expect(customerNotificationUnreadCountResponseSchema.parse({ data: { unreadCount: 12 } })).toEqual({
      data: { unreadCount: 12 },
    });
    expect(customerNotificationUnreadCountResponseSchema.parse({ data: { unreadCount: 0 } }).data.unreadCount).toBe(0);
  });

  it('refuses a negative, fractional or string count', () => {
    for (const unreadCount of [-1, 0.5, '2']) {
      expect(customerNotificationUnreadCountResponseSchema.safeParse({ data: { unreadCount } }).success).toBe(false);
    }
  });
});

describe('CustomerNotificationRecordPort (type surface)', () => {
  it('is implementable with the two write paths of contracts/delivery-and-ports.md §1', async () => {
    const input: RecordCustomerNotificationInput = {
      organizationId: ID(10),
      customerAccountId: ID(11),
      salesChannelId: null,
      sourceModule: 'quote_requests',
      sourceKey: ID(12),
      kind: 'quote_requests.approved',
      subjectType: 'quote_request',
      subjectId: ID(13),
      title: 'Quote request RFQ-0042 was approved',
      titleMessage: { scope: 'quote_requests', key: 'customerNotifications.approved.title', params: { number: 42 } },
      linkPath: '/quote-requests/x',
    };
    const port: CustomerNotificationRecordPort<{ persist(v: unknown): void }> = {
      record: (i) => Promise.resolve({ id: i.sourceKey, createdAt: new Date(AT) }),
      recordWithin: (em, i) => {
        em.persist(i);
        const r: CustomerNotificationRecord = { id: i.sourceKey, createdAt: new Date(AT) };
        return r;
      },
    };
    const persisted: unknown[] = [];
    expect(port.recordWithin({ persist: (v) => persisted.push(v) }, input).id).toBe(ID(12));
    expect(persisted).toEqual([input]);
    expect((await port.record(input)).createdAt.toISOString()).toBe(AT);
  });
});
