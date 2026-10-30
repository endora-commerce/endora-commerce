import { describe, expect, it, vi } from 'vitest';
import type { AdminUserRecord } from '@endora-commerce/contracts';
import { ReferenceService } from './reference-service.js';

/**
 * A person as the third thing a text refers to (User Story 18), against stub
 * ports: what is stored for a text, and what a reader is shown of it.
 */

const TOMASZ = '00000000-0000-4000-8000-0000000000a1';
const INACTIVE = '00000000-0000-4000-8000-0000000000a4';
const DELETED = '00000000-0000-4000-8000-0000000000a5';
const UNKNOWN = '00000000-0000-4000-8000-0000000000af';
const ORDER = '00000000-0000-4000-8000-0000000000c1';

function admin(id: string, overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id,
    email: 'tomasz@example.com',
    firstName: 'Tomasz',
    lastName: 'Nowak',
    adminRoleId: 'role',
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

const PEOPLE = [admin(TOMASZ), admin(INACTIVE, { status: 'inactive' }), admin(DELETED, { deletedAt: new Date(1) })];

function build(mayReadOrders = false) {
  const findAdmins = vi.fn(async (ids: readonly string[]) => PEOPLE.filter((person) => ids.includes(person.id)));
  const findOrders = vi.fn(async (ids: readonly string[]) =>
    ids.map((id) => ({
      id,
      businessId: 'ORD-1',
      status: 'processing',
      total: '1234.50',
      currency: 'PLN',
      placedAt: new Date('2026-10-01T09:30:00.000Z'),
      billingAddress: { recipientName: 'Jan Kowalski', companyName: 'Acme sp. z o.o.' as string | null },
      deliveryAddress: { recipientName: 'Magazyn' },
    })),
  );
  const service = new ReferenceService({
    products: { findByIds: vi.fn(async () => []) } as never,
    orders: { findByIds: findOrders } as never,
    adminUsers: { findByIds: findAdmins, findById: vi.fn(async () => null) } as never,
    quoteRequests: { isPresent: () => false, findRecord: vi.fn(async () => null) },
    tasks: { isPresent: () => false, findByIds: vi.fn(async () => []) },
    opportunities: { findByIds: vi.fn(async () => []) },
    projects: { isPresent: () => false, findByIds: vi.fn(async () => []) },
    mayRead: {
      orders: async () => mayReadOrders,
      products: async () => false,
      quoteRequests: async () => false,
      tasks: async () => false,
      projects: async () => false,
    },
  });
  return { service, findAdmins, findOrders };
}

describe('ReferenceService — a mentioned person', () => {
  it('stores a row per person mentioned, beside the other kinds', () => {
    const rows = build().service.rowsFor(
      { opportunityId: 'opportunity-1', kind: 'comment', sourceId: 'comment-1' },
      `[[admin_user:${TOMASZ}]] about [[order:${ORDER}]], again [[admin_user:${TOMASZ}]]`,
    );
    expect(rows.map((row) => `${row.sourceKind}:${row.sourceId}:${row.targetType}:${row.targetId}`)).toEqual([
      `comment:comment-1:admin_user:${TOMASZ}`,
      `comment:comment-1:order:${ORDER}`,
    ]);
  });

  it('names an active person, with no link — to a reader who may read neither Orders nor Products', async () => {
    const { service, findOrders } = build(false);
    expect(await service.resolve(`[[admin_user:${TOMASZ}]] about [[order:${ORDER}]]`)).toEqual([
      { type: 'admin_user', id: TOMASZ, available: true, label: 'Tomasz Nowak', url: null },
      { type: 'order', id: ORDER, available: false, label: null, url: null },
    ]);
    expect(findOrders).not.toHaveBeenCalled();
  });

  it('shows a deactivated, a deleted and an unknown person as unavailable, with no name', async () => {
    const { service } = build();
    const text = [INACTIVE, DELETED, UNKNOWN].map((id) => `[[admin_user:${id}]]`).join(' ');
    expect(await service.resolve(text)).toEqual(
      [INACTIVE, DELETED, UNKNOWN].map((id) => ({ type: 'admin_user', id, available: false, label: null, url: null })),
    );
  });

  it('asks for the people of a whole page once, and not at all for texts that mention nobody', async () => {
    const { service, findAdmins } = build(true);
    const resolved = await service.resolveMany([`[[admin_user:${TOMASZ}]]`, null, `again [[admin_user:${TOMASZ}]]`]);
    expect(resolved.map((list) => list.length)).toEqual([1, 0, 1]);
    expect(findAdmins).toHaveBeenCalledTimes(1);

    const other = build(true);
    await other.service.resolveMany([`[[order:${ORDER}]]`, 'plain']);
    expect(other.findAdmins).not.toHaveBeenCalled();
  });
});

describe('ReferenceService — a mentioned Order', () => {
  it('says more than the number: status, total, when it was placed and for whom', async () => {
    const { service } = build(true);
    expect(await service.resolve(`[[order:${ORDER}]]`)).toEqual([
      {
        type: 'order',
        id: ORDER,
        available: true,
        label: 'ORD-1',
        url: `/orders/${ORDER}`,
        order: {
          status: 'processing',
          total: '1234.50',
          currency: 'PLN',
          placedAt: '2026-10-01T09:30:00.000Z',
          customerName: 'Acme sp. z o.o.',
        },
      },
    ]);
  });

  it('names the recipient when the billing address carries no company', async () => {
    const { service, findOrders } = build(true);
    findOrders.mockImplementationOnce(async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        businessId: 'ORD-2',
        status: 'new',
        total: '10.00',
        currency: 'EUR',
        placedAt: new Date('2026-10-02T00:00:00.000Z'),
        billingAddress: { recipientName: 'Jan Kowalski', companyName: null },
        deliveryAddress: { recipientName: 'Magazyn' },
      })),
    );
    const [reference] = await service.resolve(`[[order:${ORDER}]]`);
    expect(reference?.order?.customerName).toBe('Jan Kowalski');
  });
});

describe('ReferenceService — a Quote Request and a Task (specs/163-projects-and-tasks/ FR-044)', () => {
  const QUOTE = '00000000-0000-4000-8000-0000000000d1';
  const TASK = '00000000-0000-4000-8000-0000000000e1';
  const text = `[[quote_request:${QUOTE}]] and [[task:${TASK}]]`;

  function withDocuments(options: { present: boolean; mayRead: boolean }) {
    const find = vi.fn(async (id: string) => ({ id, businessId: 'RFQ-7' }) as never);
    const findTasks = vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, number: 'TSK-3' }) as never));
    const mayReadQuoteRequests = vi.fn(async () => options.mayRead);
    const mayReadTasks = vi.fn(async () => options.mayRead);
    const service = new ReferenceService({
      products: { findByIds: vi.fn(async () => []) } as never,
      orders: { findByIds: vi.fn(async () => []) } as never,
      adminUsers: { findByIds: vi.fn(async () => []), findById: vi.fn(async () => null) } as never,
      quoteRequests: { isPresent: () => options.present, findRecord: find },
      tasks: { isPresent: () => options.present, findByIds: findTasks },
      opportunities: { findByIds: vi.fn(async () => []) },
      projects: { isPresent: () => false, findByIds: vi.fn(async () => []) },
      mayRead: {
        orders: async () => false,
        products: async () => false,
        quoteRequests: mayReadQuoteRequests,
        tasks: mayReadTasks,
        projects: async () => false,
      },
    });
    return { service, find, findTasks, mayReadQuoteRequests, mayReadTasks };
  }

  it('stores a row for each', () => {
    const rows = withDocuments({ present: true, mayRead: true }).service.rowsFor(
      { opportunityId: 'opportunity-1', kind: 'description', sourceId: null },
      text,
    );
    expect(rows.map((row) => `${row.targetType}:${row.targetId}`)).toEqual([`quote_request:${QUOTE}`, `task:${TASK}`]);
  });

  it('names each by its number, with a link to its screen', async () => {
    expect(await withDocuments({ present: true, mayRead: true }).service.resolve(text)).toEqual([
      { type: 'quote_request', id: QUOTE, available: true, label: 'RFQ-7', url: `/quote-requests/${QUOTE}` },
      { type: 'task', id: TASK, available: true, label: 'TSK-3', url: `/tasks/${TASK}` },
    ]);
  });

  it('asks neither owner — nor whether the reader may read them — while both are off', async () => {
    const off = withDocuments({ present: false, mayRead: true });
    expect((await off.service.resolve(text)).map((reference) => reference.available)).toEqual([false, false]);
    expect(off.find).not.toHaveBeenCalled();
    expect(off.findTasks).not.toHaveBeenCalled();
    expect(off.mayReadQuoteRequests).not.toHaveBeenCalled();
    expect(off.mayReadTasks).not.toHaveBeenCalled();
  });

  it('asks neither port for a reader who may read neither', async () => {
    const denied = withDocuments({ present: true, mayRead: false });
    expect((await denied.service.resolve(text)).map((reference) => reference.label)).toEqual([null, null]);
    expect(denied.find).not.toHaveBeenCalled();
    expect(denied.findTasks).not.toHaveBeenCalled();
  });
});
