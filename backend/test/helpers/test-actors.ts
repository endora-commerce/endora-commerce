import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../src/http/error-envelope.js';
import type { RequireAdminFactory } from '../../src/modules/catalog/routes.admin.js';
import type { SessionService } from '../../src/modules/auth/services/session-service.js';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PermissionService } from '../../src/modules/admin_roles/services/permission-service.js';

/**
 * Test-only auth wiring. The US1 contract and integration tests identify the
 * calling actor either via:
 *   - a stable stub cookie value like `stub-customer-session` — resolved
 *     through an in-memory map below, for tests that were written before
 *     the real customer_accounts module existed; or
 *   - a real session cookie (`<sessionId>.<rawToken>` minted by the customer
 *     login route) — resolved through SessionService and the customer_accounts
 *     table.
 *
 * The resolver tries real sessions first; if the cookie doesn't parse as a
 * real session, it falls back to the stub map.
 */

export const TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000aa';
export const TEST_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a1';
export const TEST_CUSTOMER_RFQ_ID = '00000000-0000-4000-8000-0000000000a2';
export const TEST_CUSTOMER_EMPTY_ID = '00000000-0000-4000-8000-0000000000a3';
export const TEST_ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';

export interface TestCustomerActor {
  kind: 'customer';
  customerAccountId: string;
  /** Null for no-org Customer accounts (feature 026 US2). */
  organizationId: string | null;
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
  // Suspended-org customer (T099 place-suspended fixture).
  'stub-customer-session-suspended': {
    customerAccountId: '00000000-0000-4000-8000-0000000000a4',
    organizationId: '00000000-0000-4000-8000-0000000000ab',
  },
  // Regular user inside TEST_ORGANIZATION (T169 role-scoping fixture).
  'stub-regular-user-session': {
    customerAccountId: '00000000-0000-4000-8000-000000000a31',
    organizationId: TEST_ORGANIZATION_ID,
  },
  // Credit-limit race customers (T207 fixture).
  'stub-customer-session-cl-a': {
    customerAccountId: '00000000-0000-4000-8000-0000000000a5',
    organizationId: TEST_ORGANIZATION_ID,
  },
  'stub-customer-session-cl-b': {
    customerAccountId: '00000000-0000-4000-8000-0000000000a6',
    organizationId: TEST_ORGANIZATION_ID,
  },
  // Stock-race customers (T100 fixture).
  'stub-customer-session-race-a': {
    customerAccountId: '00000000-0000-4000-8000-000000000aa1',
    organizationId: TEST_ORGANIZATION_ID,
  },
  'stub-customer-session-race-b': {
    customerAccountId: '00000000-0000-4000-8000-000000000aa2',
    organizationId: TEST_ORGANIZATION_ID,
  },
};

const ADMIN_COOKIES: Record<string, { adminUserId: string }> = {
  'stub-admin-session': { adminUserId: TEST_ADMIN_ID },
  // Restricted admin (T181 permissions test) — only `orders:read` permission.
  'stub-restricted-admin-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000b2',
  },
  // Feature 016 — Blog Manager (blog.read + blog.write only).
  'stub-blog-manager-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000b3',
  },
  // Feature 016 — Content Manager (blog + cms permissions).
  'stub-content-manager-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000b4',
  },
};

declare module 'fastify' {
  interface FastifyRequest {
    testActor?: TestActor;
  }
}

export interface TestAuthDeps {
  sessionService: SessionService;
  emFactory: () => EntityManager;
}

/**
 * Register the cookie → actor resolver. Must be added BEFORE any module plugin
 * so route-level guards see a resolved actor.
 */
export function registerTestAuth(app: FastifyInstance, deps: TestAuthDeps): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.['b2b_session'];
    if (!raw) {
      request.testActor = { kind: 'anonymous' };
      return;
    }

    // Try the real session flow first — this is what login flow produces.
    if (raw.includes('.')) {
      const resolved = await deps.sessionService.loadSession(raw);
      if (resolved) {
        if (
          (resolved.kind === 'customer' || resolved.kind === 'impersonation') &&
          resolved.session.customerAccountId
        ) {
          const em = deps.emFactory();
          const customer = await em.findOne(CustomerAccount, {
            id: resolved.session.customerAccountId,
          });
          if (customer) {
            request.testActor = {
              kind: 'customer',
              customerAccountId: customer.id,
              organizationId: customer.organizationId ?? null,
              impersonatorAdminUserId: resolved.session.impersonatorAdminUserId ?? null,
            };
            return;
          }
        }
        if (resolved.kind === 'admin' && resolved.session.adminUserId) {
          request.testActor = {
            kind: 'admin',
            adminUserId: resolved.session.adminUserId,
          };
          return;
        }
      }
    }

    // Fall back to the stub cookie map.
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

export function requireTestAdmin(permissionService?: PermissionService): RequireAdminFactory {
  return (permission?: string) => async (request) => {
    if (request.testActor?.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    if (permission && permissionService) {
      const ok = await permissionService.hasPermission(
        request.testActor.adminUserId,
        permission,
      );
      if (!ok) {
        throw new HttpError(
          403,
          ERROR_CODES.FORBIDDEN,
          `Missing permission: ${permission}.`,
        );
      }
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
