import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AuthSessionPort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { describe, expect, it, vi } from 'vitest';
import { ImpersonationService } from './impersonation-service.js';

/**
 * Issue #814 — a target the operator cannot impersonate answers the customer
 * record's own codes, not the generic `NOT_FOUND`, and impersonation is still
 * refused: nothing is audited and no session is minted.
 *
 *  - absent, or outside the organization the route names → `404 CUSTOMER_NOT_FOUND`;
 *  - soft-deleted → `409 CUSTOMER_ALREADY_DELETED`, but only once the account is
 *    known to be in scope, so a deleted account elsewhere still reads as absent.
 */

const ADMIN_ID = '00000000-0000-4000-8000-0000000814a1';
const ORG_ID = '00000000-0000-4000-8000-0000000814b1';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000814b2';
const ACTIVE_ID = '00000000-0000-4000-8000-0000000814c1';
const DELETED_ID = '00000000-0000-4000-8000-0000000814c2';
const FOREIGN_DELETED_ID = '00000000-0000-4000-8000-0000000814c3';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000814cf';

const account = (id: string, organizationId: string, deletedAt: Date | null): CustomerAccountRecord =>
  ({ id, organizationId, organizationRoleId: 'role', email: `${id}@example.test`, deletedAt }) as
    unknown as CustomerAccountRecord;

const ACCOUNTS = [
  account(ACTIVE_ID, ORG_ID, null),
  account(DELETED_ID, ORG_ID, new Date('2026-11-01T00:00:00.000Z')),
  account(FOREIGN_DELETED_ID, OTHER_ORG_ID, new Date('2026-11-01T00:00:00.000Z')),
];

function build() {
  const visible = (id: string, activeOnly: boolean | undefined) =>
    ACCOUNTS.find((a) => a.id === id && (!activeOnly || a.deletedAt === null)) ?? null;
  const customerAccounts = {
    findById: async (id: string, options?: { activeOnly?: boolean }) => visible(id, options?.activeOnly),
    findInOrganization: async (id: string, organizationId: string, options?: { activeOnly?: boolean }) => {
      const found = visible(id, options?.activeOnly);
      return found && found.organizationId === organizationId ? found : null;
    },
  } as unknown as CustomerAccountReadPort;
  const createSession = vi.fn(async () => ({
    session: { id: 'imp-1' },
    cookieValue: 'imp-1.raw',
    expiresAt: new Date('2026-11-06T12:00:00.000Z'),
  }));
  const record = vi.fn(async () => {});
  const em = { findOne: async () => ({ id: ADMIN_ID }) } as unknown as EntityManager;
  const service = new ImpersonationService(
    () => em,
    { createSession } as unknown as AuthSessionPort,
    customerAccounts,
    { record } as unknown as AuditPort,
  );
  const start = (customerAccountId: string, organizationId: string | null) =>
    service.start({
      adminUserId: ADMIN_ID,
      adminSessionCookieValue: 'admin.raw',
      customerAccountId,
      organizationId,
    });
  return { start, createSession, record };
}

describe('ImpersonationService.start — refusals answer the customer codes (issue #814)', () => {
  it.each([
    ['an unknown customer, organization route', UNKNOWN_ID, ORG_ID],
    ['an unknown customer, customer route', UNKNOWN_ID, null],
    ['an active customer of another organization', ACTIVE_ID, OTHER_ORG_ID],
    ['a soft-deleted customer of another organization', FOREIGN_DELETED_ID, ORG_ID],
  ])('refuses %s with 404 CUSTOMER_NOT_FOUND', async (_label, id, organizationId) => {
    const { start, createSession, record } = build();
    await expect(start(id, organizationId)).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.CUSTOMER_NOT_FOUND,
    });
    expect(record).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['organization route', ORG_ID],
    ['customer route', null],
  ])('refuses a soft-deleted customer with 409 CUSTOMER_ALREADY_DELETED (%s)', async (_label, organizationId) => {
    const { start, createSession, record } = build();
    await expect(start(DELETED_ID, organizationId)).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.CUSTOMER_ALREADY_DELETED,
    });
    expect(record).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('still impersonates an active customer in scope', async () => {
    const { start, createSession, record } = build();
    const result = await start(ACTIVE_ID, ORG_ID);
    expect(result.impersonatedCustomerAccount.id).toBe(ACTIVE_ID);
    expect(record).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
