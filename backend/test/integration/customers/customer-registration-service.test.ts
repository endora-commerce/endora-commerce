import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '../../../src/modules/auth/services/session-service.js';
import { createAuthSessionPort } from '../../../src/modules/auth/services/session-port.js';
import { CustomerRegistrationService } from '../../../../packages/modules/customers/src/backend/services/customer-registration-service.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import {
  customerAccountLifecycleWriteFor,
  personalOrganizationProvisionFor,
} from '../../helpers/customer-account-ports.js';
import type { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Integration test for standalone registration (feature 040, US1 /
 * FR-002/FR-004): gated by the setting, and refusing duplicates.
 *
 * "Standalone" means *outside a company organisation*, not *without one*: since
 * D-178 the account and its single-member personal organisation are one
 * transaction, and the atomicity is asserted below rather than assumed.
 */
describe('CustomerRegistrationService.registerStandalone', () => {
  let db: TestDb;
  let em: EntityManager;
  let redis: Redis;
  let sessions: SessionService;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  beforeEach(async () => {
    em = await db.beginTx();
    sessions = new SessionService(() => em, redis);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await redis.quit();
    await db.close();
  });

  const makeService = (allow: boolean): CustomerRegistrationService => {
    const audit = new AuditLogService(() => em);
    return new CustomerRegistrationService({
      // Feature 075, Phase C — the account row and its audit entry are
      // `customer_accounts`', so this service creates nothing itself. D-178 put
      // the personal organisation inside that same write, in one transaction,
      // so this service no longer holds `personalOrganizationPort` at all.
      accounts: customerAccountLifecycleWriteFor(() => em, audit),
      // D-98.2 — the service takes `auth`'s published `AuthSessionPort` now,
      // not the `SessionService` class. The adapter is what the container
      // hands out under `authSessionPort`, and it is what makes the session
      // cross as a record rather than as the `Session` entity.
      sessionService: createAuthSessionPort(sessions),
      resolveAllowRegistrationWithoutOrganization: async () => allow,
    });
  };

  it('provisions a personal organization + an auto-login session when allowed (feature 051)', async () => {
    const svc = makeService(true);
    const email = `standalone-${Date.now()}@example.test`;

    const result = await svc.registerStandalone({
      email,
      password: 'super-secret-pass',
      firstName: 'Stand',
      lastName: 'Alone',
    });

    // Feature 051 — the account is backed by a single-member personal org, not org-less.
    expect(result.customerAccount.organizationId).toBeTruthy();
    const org = await em.findOne(Organization, { id: result.customerAccount.organizationId });
    expect(org?.isPersonal).toBe(true);
    expect(org?.status).toBe('active');
    expect(result.sessionCookieValue).toContain('.');

    const stored = await em.findOne(CustomerAccount, { email });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe('super-secret-pass'); // hashed

    // The session resolves to this customer.
    const resolved = await sessions.loadSession(result.sessionCookieValue);
    expect(resolved?.session.customerAccountId).toBe(result.customerAccount.id);
  });

  it('refuses registration with REGISTRATION_REQUIRES_ORGANIZATION when the setting is off — and provisions nothing', async () => {
    const svc = makeService(false);
    const email = `blocked-${Date.now()}@example.test`;
    await expect(
      svc.registerStandalone({
        email,
        password: 'super-secret-pass',
        firstName: 'No',
        lastName: 'Go',
      }),
    ).rejects.toMatchObject({ code: 'REGISTRATION_REQUIRES_ORGANIZATION' } satisfies Partial<HttpError>);
    // Feature 051 US5 — a B2B-only channel provisions no account and no personal org.
    const account = await em.findOne(CustomerAccount, { email });
    expect(account).toBeNull();
  });

  it('refuses a duplicate email with EMAIL_ALREADY_REGISTERED', async () => {
    const svc = makeService(true);
    const email = `dupe-${Date.now()}@example.test`;
    await svc.registerStandalone({
      email,
      password: 'super-secret-pass',
      firstName: 'First',
      lastName: 'One',
    });
    await expect(
      svc.registerStandalone({
        email,
        password: 'another-secret-pass',
        firstName: 'Second',
        lastName: 'Two',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  /**
   * D-178 W1 — the two-flush window, closed.
   *
   * The account and its personal organisation were two committed units of work:
   * `createStandalone` flushed `organizationId: null` and this service then
   * called `personalOrganizationPort.ensureForCustomerAccount`. A failure
   * between them left a durable account with no tenant, no session for the
   * visitor to retry from, and nothing anywhere that re-ran the provisioning.
   *
   * The proof makes the provisioning throw where that second unit of work used
   * to run — inside the write, on the caller's transaction — and asserts that
   * **no account row survives**. Before the repair the equivalent failure left
   * one; a caller-side stub could not have shown that, because the throw has to
   * land between the two writes and both are now inside one transaction.
   */
  it('leaves no account behind when the personal-organization provisioning fails (D-178 W1)', async () => {
    const email = `atomic-${Date.now()}@example.test`;
    const audit = new AuditLogService(() => em);
    const svc = new CustomerRegistrationService({
      accounts: customerAccountLifecycleWriteFor(() => em, audit, undefined, {
        provisionFor: async () => {
          throw new Error('provisioning blew up');
        },
      }),
      sessionService: createAuthSessionPort(sessions),
      resolveAllowRegistrationWithoutOrganization: async () => true,
    });

    await expect(
      svc.registerStandalone({
        email,
        password: 'super-secret-pass',
        firstName: 'Half',
        lastName: 'Written',
      }),
    ).rejects.toThrow(/provisioning blew up/);

    expect(await em.findOne(CustomerAccount, { email })).toBeNull();
  });

  /**
   * The other half of the same guarantee, measured from the organisation's side:
   * a registration that fails **after** the organisation row is written rolls
   * that row back too, because it is written on the caller's `EntityManager`
   * inside the caller's transaction.
   */
  it('rolls the personal organization back when the account write fails (D-178 W1)', async () => {
    const email = `rollback-${Date.now()}@example.test`;
    const audit = new AuditLogService(() => em);
    const before = await em.count(Organization, { isPersonal: true });

    const svc = new CustomerRegistrationService({
      accounts: customerAccountLifecycleWriteFor(() => em, audit, undefined, {
        provisionFor: async (tem, input) => {
          const real = await personalOrganizationProvisionFor(() => em).provisionFor(tem, input);
          throw Object.assign(new Error('account write blew up'), { provisioned: real.id });
        },
      }),
      sessionService: createAuthSessionPort(sessions),
      resolveAllowRegistrationWithoutOrganization: async () => true,
    });

    await expect(
      svc.registerStandalone({
        email,
        password: 'super-secret-pass',
        firstName: 'Rolled',
        lastName: 'Back',
      }),
    ).rejects.toThrow(/account write blew up/);

    em.clear();
    expect(await em.count(Organization, { isPersonal: true })).toBe(before);
  });
});
