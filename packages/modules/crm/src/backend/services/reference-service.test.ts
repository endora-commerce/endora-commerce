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
  const findOrders = vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, businessId: 'ORD-1' })));
  const service = new ReferenceService({
    products: { findByIds: vi.fn(async () => []) } as never,
    orders: { findByIds: findOrders } as never,
    adminUsers: { findByIds: findAdmins, findById: vi.fn(async () => null) } as never,
    mayRead: { orders: async () => mayReadOrders, products: async () => false },
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
