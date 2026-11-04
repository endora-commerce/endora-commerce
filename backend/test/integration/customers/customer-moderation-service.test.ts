import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '@endora-commerce/mod-auth/backend';
import { createAuthSessionPort } from '@endora-commerce/mod-auth/backend';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { CustomerAuthService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-auth-service.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import {
  CustomerAuthorityService,
  type SalesRepVisibility,
} from '../../../../packages/modules/customers/src/backend/services/customer-authority-service.js';
import { CustomerModerationService } from '../../../../packages/modules/customers/src/backend/services/customer-moderation-service.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
// `dist`, not `src` (feature 146): see `test/helpers/customer-account-ports.ts` —
// a source-evaluated `CustomerAccount` makes `QuoteRequestAccountPolicy`'s
// transitive parent ambiguous and the ORM refuses to initialise.
import { CustomerAccountReadService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import { twoFactorEnrolmentsFor } from '../../helpers/two-factor-enrolments.js';
import { customerAccountLifecycleWriteFor } from '../../helpers/customer-account-ports.js';
import { OrganizationDepletionGuard } from '../../../../packages/modules/customers/src/backend/services/organization-depletion-guard.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Feature 040, US3 — block/unblock: authority, session revocation, login gate,
 * audit, idempotency, and the org-owner depletion guard.
 *
 * `specs/170-organization-roles/` WP-03 (T058): the guard counts the holders
 * of the Organization's *Administrator* role (`countAdministrators`), judges
 * the target by the role it holds rather than the legacy column, and applies to
 * company Organizations only (T120, owner ruling PR-3).
 */
describe('CustomerModerationService', () => {
  let db: TestDb;
  let em: EntityManager;
  let redis: Redis;
  let sessions: SessionService;
  let audit: AuditLogService;

  const platformAdmin = {
    adminUserId: '00000000-0000-4000-8000-00000000a001',
    isPlatformAdmin: true,
  };

  async function makeOrg(isPersonal = false): Promise<string> {
    const org = em.create(Organization, {
      isPersonal,
      name: 'Mod Org',
      taxId: `PL${String(Math.floor(performance.now() * 1000)).slice(-10).padStart(10, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    });
    await em.persistAndFlush(org);
    return org.id;
  }

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  beforeEach(async () => {
    em = await db.beginTx();
    sessions = new SessionService(() => em, redis);
    audit = new AuditLogService(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await redis.quit();
    await db.close();
  });

  function makeService(canSee: boolean): CustomerModerationService {
    const visibility: SalesRepVisibility = { canSeeOrganization: async () => canSee };
    const organizationRoles = { predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') => predefinedRoleIdOf(em, organizationId, kind) };
    const accounts = new CustomerAccountReadService(() => em, twoFactorEnrolmentsFor(() => em, 'customer'), organizationRoles);
    return new CustomerModerationService(
      accounts,
      customerAccountLifecycleWriteFor(() => em, audit),
      new CustomerAuthorityService(visibility),
      sessions,
      new OrganizationDepletionGuard({
        accounts,
        organizations: {
          findById: async (id) => {
            const org = await em.findOne(Organization, { id });
            return org ? ({ id: org.id, isPersonal: org.isPersonal } as never) : null;
          },
        },
        organizationRoles,
      }),
    );
  }

  async function makeCustomer(
    over: Partial<CustomerAccount> = {},
  ): Promise<CustomerAccount> {
    const c = em.create(CustomerAccount, {
      // D-178 — `organization_id` is NOT NULL, so the default is an
      // organisation of this fixture's own rather than none.
      organizationId: over.organizationId ?? (await makeOrg()),
      email: `mod-${Date.now()}-${Math.floor(performance.now())}@example.test`,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Mod',
      lastName: 'Target',
      ...over,
    });
    await em.persistAndFlush(c);
    return c;
  }

  it('blocks a customer: sets state, revokes sessions, audits, denies login', async () => {
    const svc = makeService(true);
    const customer = await makeCustomer();
    const session = await sessions.createSession({ kind: 'customer', customerAccountId: customer.id });
    expect(await sessions.loadSession(session.cookieValue)).not.toBeNull();

    await svc.block({ targetCustomerAccountId: customer.id, actor: platformAdmin, reason: 'abuse' });

    const reloaded = await em.findOne(CustomerAccount, { id: customer.id });
    expect(reloaded!.blockedAt).not.toBeNull();
    expect(reloaded!.blockSource).toBe('staff');
    expect(reloaded!.blockReason).toBe('abuse');
    // Session revoked.
    expect(await sessions.loadSession(session.cookieValue)).toBeNull();
    // Audit recorded.
    const entries = await em.find(AuditLogEntry, {
      action: 'customer_account.blocked',
      objectId: customer.id,
    });
    expect(entries).toHaveLength(1);
    // Login denied with ACCOUNT_BLOCKED.
    const auth = new CustomerAuthService(() => em, createAuthSessionPort(sessions));
    await expect(
      auth.login({ email: customer.email, password: 'a-very-strong-pass' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
  });

  it('unblock restores login and audits', async () => {
    const svc = makeService(true);
    const customer = await makeCustomer();
    await svc.block({ targetCustomerAccountId: customer.id, actor: platformAdmin });
    await svc.unblock({ targetCustomerAccountId: customer.id, actor: platformAdmin });

    const reloaded = await em.findOne(CustomerAccount, { id: customer.id });
    expect(reloaded!.blockedAt).toBeNull();
    const auth = new CustomerAuthService(() => em, createAuthSessionPort(sessions));
    const res = await auth.login({ email: customer.email, password: 'a-very-strong-pass' });
    // Feature 042 — login returns a discriminated outcome; no MFA port here.
    if (res.status !== 'authenticated') throw new Error('expected authenticated login');
    expect(res.customerAccount.id).toBe(customer.id);
    const entries = await em.find(AuditLogEntry, {
      action: 'customer_account.unblocked',
      objectId: customer.id,
    });
    expect(entries).toHaveLength(1);
  });

  it('refuses a salesperson not assigned to the org-bound customer (403)', async () => {
    const svc = makeService(false); // not assigned
    const orgId = await makeOrg();
    const customer = await makeCustomer({ organizationId: orgId });
    await expect(
      svc.block({
        targetCustomerAccountId: customer.id,
        actor: { adminUserId: '00000000-0000-4000-8000-00000000a002', isPlatformAdmin: false },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // D-178 — there is no org-less customer any more. The rule this case exists
  // for survives through a different mechanism: a **personal** organisation can
  // never carry a sales-rep assignment, so `canSeeOrganization`'s
  // unassigned-org fallback answers `true` for every salesperson. The fixture
  // therefore stands the customer in an organisation with no assigned rep,
  // which is what a personal one always is.
  it('any salesperson may block a customer in an organisation with no assigned rep', async () => {
    // `canSeeOrganization` is the stub, and it is what carries the
    // unassigned-org fallback in production: `SalesRepAssignmentService` answers
    // `true` for an organisation with no assigned rep, which a personal one
    // always is because it refuses assignments outright.
    const svc = makeService(true);
    const customer = await makeCustomer();
    const blocked = await svc.block({
      targetCustomerAccountId: customer.id,
      actor: { adminUserId: '00000000-0000-4000-8000-00000000a003', isPlatformAdmin: false },
    });
    expect(blocked.blockedAt).not.toBeNull();
  });

  it('block is idempotent', async () => {
    const svc = makeService(true);
    const customer = await makeCustomer();
    await svc.block({ targetCustomerAccountId: customer.id, actor: platformAdmin });
    await svc.block({ targetCustomerAccountId: customer.id, actor: platformAdmin });
    const entries = await em.find(AuditLogEntry, {
      action: 'customer_account.blocked',
      objectId: customer.id,
    });
    expect(entries).toHaveLength(1); // second call is a no-op
  });

  it('refuses to block the last organization admin (depletion guard, 409)', async () => {
    const svc = makeService(true);
    const orgId = await makeOrg();
    const onlyAdmin = await makeCustomer({
      organizationId: orgId,
      organizationRoleId: await predefinedRoleIdOf(em, orgId, 'administrator'),
    });
    await expect(
      svc.block({ targetCustomerAccountId: onlyAdmin.id, actor: platformAdmin }),
    ).rejects.toMatchObject({ code: 'ORG_OWNER_DEPLETION' });
  });

  it('blocks an administrator when another unblocked one remains', async () => {
    const svc = makeService(true);
    const orgId = await makeOrg();
    const administratorRoleId = await predefinedRoleIdOf(em, orgId, 'administrator');
    const first = await makeCustomer({ organizationId: orgId, organizationRoleId: administratorRoleId });
    await makeCustomer({ organizationId: orgId, organizationRoleId: administratorRoleId });
    const blocked = await svc.block({ targetCustomerAccountId: first.id, actor: platformAdmin });
    expect(blocked.blockedAt).not.toBeNull();
  });

  it('blocks a personal Organization’s administrator — its only member (PR-3, T120)', async () => {
    const svc = makeService(true);
    const orgId = await makeOrg(true);
    const individual = await makeCustomer({
      organizationId: orgId,
      organizationRoleId: await predefinedRoleIdOf(em, orgId, 'administrator'),
    });
    const blocked = await svc.block({ targetCustomerAccountId: individual.id, actor: platformAdmin });
    expect(blocked.blockedAt).not.toBeNull();
  });
});
