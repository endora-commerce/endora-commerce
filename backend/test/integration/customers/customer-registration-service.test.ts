import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '../../../src/modules/auth/services/session-service.js';
import { createAuthSessionPort } from '../../../src/modules/auth/services/session-port.js';
import { CustomerRegistrationService } from '../../../src/modules/customers/services/customer-registration-service.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { PersonalOrganizationService } from '../../../src/modules/organizations/services/personal-organization-service.js';
import type { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Integration test for standalone (org-less) registration (feature 040, US1 /
 * FR-002/FR-004): gated by the setting, creates an org-less account, and
 * refuses duplicates.
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

  const makeService = (allow: boolean): CustomerRegistrationService =>
    new CustomerRegistrationService({
      emFactory: () => em,
      // D-98.2 — the service takes `auth`'s published `AuthSessionPort` now,
      // not the `SessionService` class. The adapter is what the container
      // hands out under `authSessionPort`, and it is what makes the session
      // cross as a record rather than as the `Session` entity.
      sessionService: createAuthSessionPort(sessions),
      resolveAllowRegistrationWithoutOrganization: async () => allow,
      personalOrganizationService: new PersonalOrganizationService(() => em),
    });

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
    const org = await em.findOne(Organization, { id: result.customerAccount.organizationId! });
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
});
