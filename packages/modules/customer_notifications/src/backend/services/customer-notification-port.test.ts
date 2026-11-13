import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RecordCustomerNotificationInput } from '@endora-commerce/contracts';
import { CustomerNotification } from '../entities/customer-notification.entity.js';
import { createCustomerNotificationRecordPort } from './customer-notification-port.js';

/**
 * `customerNotificationRecordPort` (`specs/179-rfq-and-customer-notifications/`
 * `contracts/delivery-and-ports.md` §1, T060).
 *
 * The EntityManager is a fake that records what the port asked of it: the
 * co-transactional half must persist on the caller's unit of work and never
 * flush it, and both halves must refuse invalid input before anything is
 * created. The database half — a real commit and a real rollback — is
 * `backend/test/integration/customer_notifications/record-port.test.ts`.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';
const SUBJECT = '00000000-0000-4000-8000-0000000000d1';

function input(overrides: Partial<RecordCustomerNotificationInput> = {}): RecordCustomerNotificationInput {
  return {
    organizationId: ORG,
    customerAccountId: ACCOUNT,
    salesChannelId: CHANNEL,
    sourceModule: 'quote_requests',
    sourceKey: 'record-1',
    kind: 'quote_requests.approved',
    subjectType: 'quote_request',
    subjectId: SUBJECT,
    title: 'Quote request QR-000153 was approved',
    titleMessage: {
      scope: 'quote_requests',
      key: 'customerNotifications.approved.title',
      params: { number: 'QR-000153' },
    },
    linkPath: `/quote-requests/${SUBJECT}`,
    ...overrides,
  };
}

interface FakeEm {
  em: EntityManager;
  create: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  persistAndFlush: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
}

function fakeEm(existing: CustomerNotification | null = null): FakeEm {
  const create = vi.fn((_entity: unknown, data: Record<string, unknown>) => {
    const row = new CustomerNotification();
    Object.assign(row, data);
    return row;
  });
  const persist = vi.fn();
  const flush = vi.fn(async () => undefined);
  const persistAndFlush = vi.fn(async () => undefined);
  const findOne = vi.fn(async () => existing);
  const em = { create, persist, flush, persistAndFlush, findOne } as unknown as EntityManager;
  (em as unknown as { fork: () => EntityManager }).fork = () => em;
  return { em, create, persist, flush, persistAndFlush, findOne };
}

describe('customerNotificationRecordPort.recordWithin', () => {
  it("persists the entry on the caller's EntityManager and does not flush it", () => {
    const caller = fakeEm();
    const own = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => own.em });

    const record = port.recordWithin(caller.em, input());

    expect(caller.persist).toHaveBeenCalledTimes(1);
    const persisted = caller.persist.mock.calls[0]![0] as CustomerNotification;
    expect(persisted).toBeInstanceOf(CustomerNotification);
    expect(persisted).toMatchObject({
      organizationId: ORG,
      customerAccountId: ACCOUNT,
      salesChannelId: CHANNEL,
      sourceModule: 'quote_requests',
      sourceKey: 'record-1',
      kind: 'quote_requests.approved',
      subjectType: 'quote_request',
      subjectId: SUBJECT,
      title: 'Quote request QR-000153 was approved',
      titleMessage: {
        scope: 'quote_requests',
        key: 'customerNotifications.approved.title',
        params: { number: 'QR-000153' },
      },
      body: null,
      bodyMessage: null,
      linkPath: `/quote-requests/${SUBJECT}`,
    });
    expect(record).toEqual({ id: persisted.id, createdAt: persisted.createdAt });
    expect(caller.flush).not.toHaveBeenCalled();
    expect(caller.persistAndFlush).not.toHaveBeenCalled();
    // Nothing touches an EntityManager of the port's own.
    expect(own.persist).not.toHaveBeenCalled();
    expect(own.create).not.toHaveBeenCalled();
  });

  it('stores a message without params with empty params, and a null channel as every channel', () => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    port.recordWithin(
      caller.em,
      input({ salesChannelId: null, titleMessage: { scope: 'quote_requests', key: 'k' }, linkPath: null }),
    );

    expect(caller.persist.mock.calls[0]![0]).toMatchObject({
      salesChannelId: null,
      titleMessage: { scope: 'quote_requests', key: 'k', params: {} },
      linkPath: null,
    });
  });

  it.each([
    ['an absolute URL', 'https://evil.example/quote-requests/1'],
    ['a protocol-relative URL', '//evil.example/quote-requests/1'],
    ['a scheme without slashes', 'javascript:alert(1)'],
    ['a relative path without a leading slash', 'quote-requests/1'],
    ['a backslash after the leading slash', '/\\evil.example'],
    ['an empty string', ''],
  ])('refuses %s as the link before anything is created', (_label, linkPath) => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() => port.recordWithin(caller.em, input({ linkPath }))).toThrow(/linkPath/);
    expect(caller.create).not.toHaveBeenCalled();
    expect(caller.persist).not.toHaveBeenCalled();
  });

  it('refuses a bodyMessage without a body to fall back to', () => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() =>
      port.recordWithin(caller.em, input({ bodyMessage: { scope: 'quote_requests', key: 'b' } })),
    ).toThrow(/bodyMessage requires a body/);
    expect(caller.persist).not.toHaveBeenCalled();
  });

  it('accepts a body with its bodyMessage', () => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    port.recordWithin(
      caller.em,
      input({ body: 'The offer is valid until 1 December.', bodyMessage: { scope: 'quote_requests', key: 'b' } }),
    );

    expect(caller.persist.mock.calls[0]![0]).toMatchObject({
      body: 'The offer is valid until 1 December.',
      bodyMessage: { scope: 'quote_requests', key: 'b', params: {} },
    });
  });

  it.each([
    ['an object', { nested: { a: 1 } }],
    ['an array', { list: [1, 2] }],
    ['a boolean', { flag: true }],
    ['null', { empty: null }],
    ['a non-finite number', { n: Number.POSITIVE_INFINITY }],
  ])('refuses %s as a title param', (_label, params) => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() =>
      port.recordWithin(
        caller.em,
        input({
          titleMessage: {
            scope: 'quote_requests',
            key: 'k',
            params: params as unknown as Record<string, string | number>,
          },
        }),
      ),
    ).toThrow(/param/);
    expect(caller.persist).not.toHaveBeenCalled();
  });

  it('refuses a non-scalar body param too', () => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() =>
      port.recordWithin(
        caller.em,
        input({
          body: 'b',
          bodyMessage: {
            scope: 'quote_requests',
            key: 'b',
            params: { x: { y: 1 } } as unknown as Record<string, string | number>,
          },
        }),
      ),
    ).toThrow(/bodyMessage param "x"/);
  });

  it.each([
    ['organizationId', { organizationId: '' }],
    ['customerAccountId', { customerAccountId: '' }],
    ['sourceModule', { sourceModule: '' }],
    ['sourceKey', { sourceKey: '' }],
    ['kind', { kind: '' }],
    ['title', { title: '' }],
  ])('refuses an empty %s', (field, overrides) => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() => port.recordWithin(caller.em, input(overrides))).toThrow(new RegExp(field));
    expect(caller.persist).not.toHaveBeenCalled();
  });

  it('refuses a source key longer than its column', () => {
    const caller = fakeEm();
    const port = createCustomerNotificationRecordPort({ emFactory: () => caller.em });

    expect(() => port.recordWithin(caller.em, input({ sourceKey: 'k'.repeat(129) }))).toThrow(/sourceKey/);
  });
});

describe('customerNotificationRecordPort.record', () => {
  it('creates and flushes the entry on an EntityManager of its own', async () => {
    const own = fakeEm(null);
    const port = createCustomerNotificationRecordPort({ emFactory: () => own.em });

    const record = await port.record(input());

    expect(own.findOne).toHaveBeenCalledWith(CustomerNotification, {
      sourceModule: 'quote_requests',
      sourceKey: 'record-1',
    });
    expect(own.persistAndFlush).toHaveBeenCalledTimes(1);
    const persisted = own.persistAndFlush.mock.calls[0]![0] as CustomerNotification;
    expect(record).toEqual({ id: persisted.id, createdAt: persisted.createdAt });
  });

  it('answers the existing entry when (sourceModule, sourceKey) is already recorded, and writes nothing', async () => {
    const existing = new CustomerNotification();
    existing.id = '00000000-0000-4000-8000-0000000000e1';
    existing.createdAt = new Date('2026-11-01T10:00:00.000Z');
    const own = fakeEm(existing);
    const port = createCustomerNotificationRecordPort({ emFactory: () => own.em });

    const record = await port.record(input());

    expect(record).toEqual({ id: existing.id, createdAt: existing.createdAt });
    expect(own.create).not.toHaveBeenCalled();
    expect(own.persistAndFlush).not.toHaveBeenCalled();
  });

  it('refuses invalid input before it reads anything', async () => {
    const own = fakeEm(null);
    const port = createCustomerNotificationRecordPort({ emFactory: () => own.em });

    await expect(port.record(input({ linkPath: 'https://evil.example' }))).rejects.toThrow(/linkPath/);
    expect(own.findOne).not.toHaveBeenCalled();
  });
});
