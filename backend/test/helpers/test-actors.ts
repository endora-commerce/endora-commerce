import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SessionService } from '@endora-commerce/mod-auth/backend';
import { CustomerAccount } from './package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PermissionService } from '../../../packages/modules/admin_roles/src/backend/services/permission-service.js';
import type { RequireAdminFactory } from '../../src/kernel/ports/require-admin.js';
import { createRequireAdmin } from '@endora-commerce/mod-auth/backend';

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
/** A second Organization, so a test can tell "not disclosed" from "disclosed to everyone". */
export const OTHER_TEST_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000ab';
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

/**
 * Feature 062 — mirrors the production ActorApiKey (auth/plugin.ts): resolved
 * from a real `Bearer sk_live_*` token via ApiKeyService.authenticate, incl.
 * the distributor binding for bound keys.
 */
export interface TestApiKeyActor {
  kind: 'api_key';
  apiKeyId: string;
  scopes: string[];
  organizationId?: string | null;
  salesChannelId?: string | null;
  customerAccountId?: string | null;
}

export type TestActor =
  | TestCustomerActor
  | TestAdminActor
  | TestApiKeyActor
  | { kind: 'anonymous' };

export const CUSTOMER_COOKIES: Record<string, { customerAccountId: string; organizationId: string }> = {
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
  // A buyer of a *different* Organization (issue #227). Every visibility
  // enforcement test needs one: "the restricted product is not disclosed" is
  // only a claim about enforcement when a signed-in buyer who is not on the
  // allow-list is refused, next to one who is on it and is served.
  'stub-customer-session-other-org': {
    customerAccountId: '00000000-0000-4000-8000-0000000000a7',
    organizationId: OTHER_TEST_ORGANIZATION_ID,
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

/**
 * Stub admin cookies. Exported so tests can register new sales-rep
 * scenarios at runtime (feature 026 US6).
 */
export const ADMIN_COOKIES: Record<string, { adminUserId: string }> = {
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
  // Feature 026 — scoped-role contract tests.
  'stub-settings-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d1',
  },
  'stub-channel-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d2',
  },
  'stub-content-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d3',
  },
  'stub-assets-reader-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d4',
  },
  // D-166 — the two halves of the sales-rep split, one code each. They exist to
  // prove the two gates are genuinely different codes: an admin holding only
  // `organizations:assign-sales-rep` opens the three assignment endpoints and is
  // refused the reverse listing, and an admin holding only `rfqs:handle` is
  // refused in the other direction. A single `*` role cannot tell those apart.
  // Both roles and both users are created by
  // `test/contract/organizations/sales-reps.test.ts` itself, the way the
  // scoped-role contract test creates its four.
  'stub-sales-rep-assigner-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d5',
  },
  'stub-rfq-handler-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d6',
  },
  // `payments` owns its codes — the three roles that prove it. A catalogue
  // editor must be refused every payments route, a payments viewer must read
  // the history and be refused the two writes, and the third carries the
  // seeded `sales_representative` permission list verbatim so the shipped
  // role's loss of payment access is asserted rather than assumed. All three
  // roles and users are created by
  // `test/contract/payments/permission-authority.test.ts`, the way the
  // scoped-role contract test creates its four.
  'stub-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d7',
  },
  'stub-payments-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d8',
  },
  'stub-seeded-sales-rep-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000d9',
  },
  // `payment_methods` owns its codes — the four roles that prove it. Its own
  // stub set rather than a reuse of the three above: those are created by the
  // `payments` file, and two files sharing an admin user id would make each
  // one's fixtures depend on whether the other had booted first.
  //
  // A catalogue editor must be refused the payment-method configuration it
  // could read and rewrite before; a viewer holding only `payment_methods:read`
  // must read it and be refused every write; an editor holding the pair must
  // complete the write, so the pair is shown to be *sufficient* and not merely
  // newly required; and the fourth carries the seeded `sales_representative`
  // permission list verbatim. All four roles and users are created by
  // `test/contract/payment_methods/permission-authority.test.ts`.
  'stub-pm-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000da',
  },
  'stub-payment-methods-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000db',
  },
  'stub-payment-methods-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000dc',
  },
  'stub-pm-seeded-sales-rep-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000dd',
  },
  // `delivery_methods` owns its codes — the four roles that prove it, on the
  // same terms as the `payment_methods` set above and with ids of its own for
  // the same reason: two files sharing an admin user id would make each one's
  // fixtures depend on whether the other had booted first.
  //
  // A catalogue editor must be refused the delivery-method configuration it
  // could read, rewrite and delete before; a viewer holding only
  // `delivery_methods:read` must read it and be refused every write; an editor
  // holding the pair must complete the write, so the pair is shown to be
  // *sufficient* and not merely newly required; and the fourth carries the
  // seeded `sales_representative` permission list verbatim. All four roles and
  // users are created by
  // `test/contract/delivery_methods/permission-authority.test.ts`.
  'stub-dm-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000de',
  },
  'stub-delivery-methods-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000df',
  },
  'stub-delivery-methods-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e0',
  },
  'stub-dm-seeded-sales-rep-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e1',
  },
  // The delivery-method read code is the second member of the shared
  // `GET /admin/order-statuses` gate, which `payment_methods` registers, so the
  // `payment_methods` authority file needs a role holding it. Its own id, for
  // the reason every other role in both files has one.
  'stub-pm-delivery-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e2',
  },
  // `taxes` owns its codes — the four roles that prove it, on the same terms as
  // the two method sets above and with ids of its own for the same reason: two
  // files sharing an admin user id would make each one's fixtures depend on
  // whether the other had booted first.
  //
  // The catalogue editor holds the code all four tax routes used to enforce —
  // `catalog:write`, the reads included — and must now be refused the whole
  // surface; a viewer holding only `taxes:read` must read the table and the
  // preview and be refused every write, which is a capability that did not
  // exist before this change; an editor holding the pair must complete the
  // write, so the pair is shown to be *sufficient* and not merely newly
  // required; and the fourth carries the seeded `sales_representative`
  // permission list verbatim. All four roles and users are created by
  // `test/contract/taxes/permission-authority.test.ts`.
  'stub-tax-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e3',
  },
  'stub-taxes-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e4',
  },
  'stub-taxes-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e5',
  },
  'stub-tax-seeded-sales-rep-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e6',
  },
  // `currencies` and `inventory` own their codes (2026-08-29) — the roles that
  // prove it, on the same terms as the sets above and with ids of their own for
  // the same reason: two files sharing an admin user id would make each one's
  // fixtures depend on whether the other had booted first.
  //
  // For `currencies` the negative is the catalogue **editor**: all four
  // currency routes enforced `catalog:write`, the list read included, so
  // `catalog:read` never opened them. For `inventory` there are two negatives,
  // because it borrowed two codes on two halves of one surface — an orders
  // reader, who could enumerate every warehouse and its address, and a
  // catalogue editor, who could delete one. The viewer and editor roles then
  // show the new pair is *sufficient* and not merely newly required, and the
  // read half is a capability that did not exist: seeing a currency, a stock
  // level or a warehouse required nobody's read code before.
  //
  // All roles and users are created by
  // `test/contract/currencies/permission-authority.test.ts` and
  // `test/contract/inventory/permission-authority.test.ts`.
  'stub-currencies-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e7',
  },
  'stub-currencies-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e8',
  },
  'stub-currencies-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000e9',
  },
  'stub-inventory-orders-reader-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000ea',
  },
  'stub-inventory-catalog-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000eb',
  },
  'stub-inventory-viewer-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000ec',
  },
  'stub-inventory-editor-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000ed',
  },
  'stub-inventory-seeded-sales-rep-session': {
    adminUserId: '00000000-0000-4000-8000-0000000000ee',
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
  /**
   * Feature 062 — mirrors the production auth plugin's `apiKeyResolver`
   * (composition.ts): resolves `Bearer sk_live_*` tokens into an api_key
   * actor so the tenant-context hook and the sales-channel resolver see the
   * binding. Only `sk_live_*` bearers are intercepted — other Authorization
   * headers keep their pre-062 harness behavior.
   */
  apiKeyResolver?: (token: string) => Promise<Omit<TestApiKeyActor, 'kind'> | null>;
}

/**
 * Register the cookie → actor resolver. Must be added BEFORE any module plugin
 * so route-level guards see a resolved actor.
 */
export function registerTestAuth(app: FastifyInstance, deps: TestAuthDeps): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Mirror the resolved actor onto BOTH `request.testActor` (the harness's
    // own decoration, read by modules that take an injected actor resolver)
    // AND `request.actor` (the production decoration the auth plugin sets).
    // Some storefront routes — notably `comparisons` — read `request.actor`
    // directly instead of through an injected resolver, so without this they
    // would see `undefined` and 500 under the test harness.
    const setActor = (actor: TestActor): void => {
      request.testActor = actor;
      (request as unknown as { actor: TestActor }).actor = actor;
    };

    // Feature 062 — API key (Bearer) beats cookie, matching the production
    // auth plugin. A failed sk_live resolution leaves the actor anonymous
    // (route-level gates reject), same as production.
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer sk_live_') && deps.apiKeyResolver) {
      const token = authHeader.slice('Bearer '.length).trim();
      const resolved = await deps.apiKeyResolver(token);
      setActor(resolved ? { kind: 'api_key', ...resolved } : { kind: 'anonymous' });
      return;
    }

    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;

    // Admin sessions live in a dedicated cookie so they can coexist with a
    // customer session. Resolve it as a fallback candidate; the customer
    // cookie (below) takes ambient precedence, matching the production plugin.
    const adminRaw = cookies?.['b2b_admin_session'];
    let adminCandidate: TestActor | null = null;
    if (adminRaw) {
      if (adminRaw.includes('.')) {
        const resolvedAdmin = await deps.sessionService.loadSession(adminRaw);
        if (resolvedAdmin?.kind === 'admin' && resolvedAdmin.session.adminUserId) {
          adminCandidate = { kind: 'admin', adminUserId: resolvedAdmin.session.adminUserId };
        }
      }
      if (!adminCandidate && ADMIN_COOKIES[adminRaw]) {
        adminCandidate = { kind: 'admin', adminUserId: ADMIN_COOKIES[adminRaw]!.adminUserId };
      }
    }

    const raw = cookies?.['b2b_session'];
    if (!raw) {
      setActor(adminCandidate ?? { kind: 'anonymous' });
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
            setActor({
              kind: 'customer',
              customerAccountId: customer.id,
              organizationId: customer.organizationId ?? null,
              impersonatorAdminUserId: resolved.session.impersonatorAdminUserId ?? null,
            });
            return;
          }
        }
        if (resolved.kind === 'admin' && resolved.session.adminUserId) {
          setActor({
            kind: 'admin',
            adminUserId: resolved.session.adminUserId,
          });
          return;
        }
      }
    }

    // Fall back to the stub cookie map.
    const customer = CUSTOMER_COOKIES[raw];
    if (customer) {
      setActor({
        kind: 'customer',
        customerAccountId: customer.customerAccountId,
        organizationId: customer.organizationId,
        impersonatorAdminUserId: null,
      });
      return;
    }
    const admin = ADMIN_COOKIES[raw];
    if (admin) {
      setActor({ kind: 'admin', adminUserId: admin.adminUserId });
      return;
    }
    setActor(adminCandidate ?? { kind: 'anonymous' });
  });
}

/**
 * Feature 072, T011 — the harness and production now run the SAME admin guard.
 *
 * They used to run two. Production read `request.actor`, called
 * `promoteAdminActor` and checked `permissionService.hasPermission`; this file
 * read `request.testActor` and took `permissionService` as **optional**, so
 * omitting it silently disabled every permission check across 205 call sites in
 * 60 modules. All 28 wiring sites in `test-server.ts` happened to pass one, so
 * the checks did run — but nothing made them, and the two guards still differed
 * in what they read and in whether an admin session riding alongside a customer
 * session was promoted.
 *
 * These wrappers stay so `test-server.ts` reads as before; `permissionService`
 * is now **required**. The actor lookup works because `registerTestAuth` mirrors
 * every resolved actor onto `request.actor` as well as `request.testActor`.
 *
 * `requireTestAdminAny` used to sit beside this one and is gone (feature 072,
 * T138): it was a second implementation of a guard `auth` already provides as a
 * port, kept alive by exactly one caller — the `organizationsModule` options in
 * `test-server.ts`. With that module composed through the container, the
 * harness resolves `auth`'s `requireAdminAny` like production does, which is
 * the divergence T011/T012 closed for `requireAdmin` and left open for this
 * twin.
 */
export function requireTestAdmin(permissionService: PermissionService): RequireAdminFactory {
  return createRequireAdmin({ permissionService });
}

/*
 * `requireTestCustomer` used to sit here and is gone (issue #43) — the third
 * and last guard this file implemented for itself. It read `request.testActor`
 * where `composition.ts`'s inline copy read `request.actor`, so the two
 * disagreed on every request shape that exists: a request carrying only the
 * production actor was admitted by one and refused by the other, and a request
 * carrying neither crashed the root's copy with a `TypeError` while this one
 * answered 401. `auth` provides `requireCustomer` as a port now, both roots
 * resolve it, and the surviving implementation makes the production read with
 * this file's tolerance for an unresolved actor.
 */
