import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../src/http/error-envelope.js';
import type { RequireAdminFactory } from '../../src/modules/catalog/routes.admin.js';

/**
 * Test-only auth wiring. The US1 contract and integration tests identify the
 * calling actor via stable cookie values like `stub-customer-session` — the
 * real session plumbing is only built in US2+US4. This helper maps those
 * cookie values to synthetic actors with fixed UUIDs so route-level guards
 * (`requireCustomer`, `requireAdmin`) can enforce the right shape without
 * depending on unrelated modules.
 *
 * Cookie → actor mapping is stable across tests; if you add a new stub
 * identifier, add it here once.
 */

export const TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000aa';
export const TEST_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';
export const TEST_CUSTOMER_RFQ_ID = '00000000-0000-4000-8000-0000000000a2';
export const TEST_CUSTOMER_EMPTY_ID = '00000000-0000-4000-8000-0000000000a3';
export const TEST_ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';

export interface TestCustomerActor {
  kind: 'customer';
  customerAccountId: string;
  organizationId: string;
  impersonatorAdminUserId: string | null;
}

export interface TestAdminActor {
  kind: 'admin';
  adminUserId: string;
}

export type TestActor = TestCustomerActor | TestAdminActor | { kind: 'anonymous' };

const CUSTOMER_COOKIES: Record<string, { customerAccountId: string; organizationId: string }> = {
  'stub-customer-session': {
    customerAccountId: TEST_CUSTOMER_ID,
    organizationId: TEST_ORGANIZATION_ID,
  },
  'stub-customer-session-rfq': {
    customerAccountId: TEST_CUSTOMER_RFQ_ID,
    organizationId: TEST_ORGANIZATION_ID,
  },
  'stub-empty-draft-customer-session': {
    customerAccountId: TEST_CUSTOMER_EMPTY_ID,
    organizationId: TEST_ORGANIZATION_ID,
  },
};

const ADMIN_COOKIES: Record<string, { adminUserId: string }> = {
  'stub-admin-session': { adminUserId: TEST_ADMIN_ID },
};

declare module 'fastify' {
  interface FastifyRequest {
    testActor?: TestActor;
  }
}

/**
 * Register a lightweight onRequest hook that resolves `request.testActor` from
 * the `b2b_session` cookie. `requireTestCustomer` + `requireTestAdmin` below
 * consume it.
 */
export function registerTestAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.['b2b_session'];
    if (!raw) {
      request.testActor = { kind: 'anonymous' };
      return;
    }
    const customer = CUSTOMER_COOKIES[raw];
    if (customer) {
      request.testActor = {
        kind: 'customer',
        customerAccountId: customer.customerAccountId,
        organizationId: customer.organizationId,
        impersonatorAdminUserId: null,
      };
      return;
    }
    const admin = ADMIN_COOKIES[raw];
    if (admin) {
      request.testActor = { kind: 'admin', adminUserId: admin.adminUserId };
      return;
    }
    request.testActor = { kind: 'anonymous' };
  });
}

export function requireTestAdmin(): RequireAdminFactory {
  return () => async (request) => {
    if (request.testActor?.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
  };
}

export function requireTestCustomer() {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.testActor?.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
  };
}
