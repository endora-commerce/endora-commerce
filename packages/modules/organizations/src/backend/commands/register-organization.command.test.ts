/**
 * `organization.register` (`specs/176-command-hooks-outbox/` T004; FR-001,
 * FR-002, FR-005, FR-006; `contracts/registration-command.md`).
 *
 * A registration is **one** Command on **one** transaction: the Organization,
 * its sales-channel binding, the first account — the child
 * `customer_account.create`, run through `ctx.run` — the registry-lookup row and
 * the verification token. The password is hashed before the transaction opens.
 * `organization.registered.v1` and `customer_account.created.v1` are dispatched
 * once each, after the commit, and never when the Command throws.
 *
 * The bus is the real `CommandBus` over an in-memory EntityManager; the account
 * port is a stand-in whose Command writes nothing but records that it ran.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountCreatePreparation,
  type CustomerAccountMemberCommandPort,
  type CustomerAccountRecord,
  type RegisterOrganizationRequest,
} from '@endora-commerce/contracts';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { RegistrationService, type OrganizationEventBus } from '../services/registration-service.js';

const ROLE_ID = '00000000-0000-4000-8000-000000176a01';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000176a02';

function request(): RegisterOrganizationRequest {
  return {
    organization: {
      name: 'Acme',
      taxId: 'PL1234567890',
      registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    },
    firstUser: {
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    acceptedTermsVersion: '1',
  } as RegisterOrganizationRequest;
}

interface Harness {
  service: RegistrationService;
  steps: string[];
  audits: Array<{ action: string }>;
  dispatched: Array<{ name: string; payload: Record<string, unknown> }>;
  childEm: { value: unknown };
  txEm: EntityManager;
}

function harness(options: { failAccount?: Error; failToken?: Error } = {}): Harness {
  const steps: string[] = [];
  const audits: Array<{ action: string }> = [];
  const childEm: { value: unknown } = { value: undefined };
  const em: Record<string, unknown> = {
    findOne: async (entity: unknown) => (entity === OrganizationRole ? { id: ROLE_ID } : null),
    execute: async () => [],
    create: (entity: unknown, data: Record<string, unknown>) => {
      steps.push(`create:${entity === Organization ? 'organization' : entity === EmailVerificationToken ? 'token' : 'other'}`);
      return { ...data };
    },
    persistAndFlush: async (entity: Record<string, unknown>) => {
      if (options.failToken && 'tokenHash' in entity) throw options.failToken;
      steps.push('flush');
    },
    flush: async () => {
      steps.push('flush');
    },
  };
  // Entries recorded inside the transaction are kept only when it commits, as
  // the real `recordWithin` rows are.
  let pending: Array<{ action: string }> = [];
  let transactions = 0;
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => {
    transactions += 1;
    if (transactions > 1) throw new Error('a second transaction was opened');
    steps.push('transactional');
    pending = [];
    const result = await fn(em as unknown as EntityManager);
    audits.push(...pending);
    steps.push('commit');
    return result;
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: { action: string }) => {
      pending.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const events = new EventBus<Record<string, EventBase>>();
  const dispatched: Harness['dispatched'] = [];
  for (const name of ['organization.registered.v1', 'customer_account.created.v1']) {
    events.on(name, (payload) => {
      dispatched.push({ name, payload: payload as unknown as Record<string, unknown> });
    });
  }
  const commandBus = new CommandBus(orm, audit, events);
  const accounts: CustomerAccountMemberCommandPort = {
    prepareCreate: async (input: CustomerAccountCreatePreparation) => {
      steps.push('hash');
      return {
        command: ({ organizationId, organizationRoleId }) => {
          const command: Command<CustomerAccountRecord> = {
            action: 'customer_account.create',
            objectType: 'customer_account',
            objectId: ACCOUNT_ID,
            run: async (ctx) => {
              childEm.value = ctx.em;
              steps.push(`account:${organizationRoleId}`);
              if (options.failAccount) throw options.failAccount;
              return {
                result: { id: ACCOUNT_ID, organizationId, email: input.email } as CustomerAccountRecord,
                after: { changedFields: ['email'] },
              };
            },
          };
          return command;
        },
      };
    },
  };
  const service = new RegistrationService({
    emFactory: () => em as unknown as EntityManager,
    commandBus,
    events: events as unknown as OrganizationEventBus,
    accounts: { read: { findByEmail: async () => null } as never, commands: accounts },
  });
  return { service, steps, audits, dispatched, childEm, txEm: em as unknown as EntityManager };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('organizations unit test: organization.register', fn);

describe('organization.register — one Command, one transaction (176 T004)', () => {
  it('hashes first, then writes everything inside one transaction, the account as a child on its em', async () => {
    const h = harness();

    const result = await asSystem(() => h.service.registerOrganization(request()));

    expect(h.steps).toEqual([
      'hash',
      'transactional',
      'create:organization',
      'flush',
      `account:${ROLE_ID}`,
      'create:token',
      'flush',
      'commit',
    ]);
    expect(h.childEm.value).toBe(h.txEm);
    expect(h.audits.map((entry) => entry.action)).toEqual(['customer_account.create', 'organization.register']);
    expect(result.customerAccount.id).toBe(ACCOUNT_ID);
    expect(result.verificationToken).toEqual(expect.any(String));
  });

  it('dispatches organization.registered.v1 and customer_account.created.v1 once each, after the commit', async () => {
    const h = harness();

    const result = await asSystem(() => h.service.registerOrganization(request()));

    const organizationId = result.organization.id;
    expect(h.dispatched).toEqual([
      { name: 'customer_account.created.v1', payload: expect.objectContaining({ customerAccountId: ACCOUNT_ID, organizationId }) },
      { name: 'organization.registered.v1', payload: expect.objectContaining({ organizationId }) },
    ]);
  });

  it('a child that throws rolls the registration back: no event, no entry', async () => {
    const h = harness({
      failAccount: new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists.'),
    });

    await expect(asSystem(() => h.service.registerOrganization(request()))).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
    });
    expect(h.steps).not.toContain('commit');
    expect(h.dispatched).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('a failing token insert rolls the registration back: no event, no entry', async () => {
    const h = harness({ failToken: new Error('token insert failed') });

    await expect(asSystem(() => h.service.registerOrganization(request()))).rejects.toThrow('token insert failed');
    expect(h.steps).not.toContain('commit');
    expect(h.dispatched).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('refuses a tax ID held inside the transaction with 409 ORGANIZATION_TAX_ID_EXISTS, before any write', async () => {
    const h = harness();
    // The in-transaction lookup sees a live organization holding the tax ID.
    let calls = 0;
    (h.txEm as unknown as Record<string, unknown>)['execute'] = async () => {
      calls += 1;
      // The service's fast pre-check (call 1) sees nothing; the Command's sees the racing row.
      return calls === 1 ? [] : [{ id: 'other', root_id: 'other', deleted: false, created_at: new Date() }];
    };
    (h.txEm as unknown as Record<string, unknown>)['find'] = async () => [{ id: 'other' }];

    await expect(asSystem(() => h.service.registerOrganization(request()))).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
    });
    expect(h.steps).not.toContain('create:organization');
    expect(h.audits).toEqual([]);
  });
});
