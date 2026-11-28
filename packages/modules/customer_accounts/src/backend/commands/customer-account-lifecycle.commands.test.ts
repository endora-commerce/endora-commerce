/**
 * The CustomerAccount lifecycle as Commands (`specs/186-aggregate-ports/` T047,
 * T050, issue #1822): block, unblock, soft delete, restore, customer group,
 * standalone registration, profile update and e-mail verification, run by
 * `customerAccountCommandPort` on the **real** `CommandBus` over an in-memory
 * EntityManager with a recording audit port.
 *
 * Until 0.113.0 the first five recorded their entry after the flush, on the
 * audit port's own connection, and the session revocation and the depletion
 * guard of a block lived in `customers`. What is held here is that each is one
 * entry inside the write's transaction, nothing when the write fails, the
 * actor the bus resolved, the sessions ended only after the commit, the
 * depletion guard inside the Command, and the caller's `source` recorded — or
 * refused before anything is read.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountCommandService } from '../services/customer-account-command-port.js';

const ADMIN = '00000000-0000-4000-8000-000000182201';
const ORG = randomUUID();
const ADMINISTRATOR = randomUUID();
const MEMBER = randomUUID();

type Row = Record<string, unknown>;

class FakeEm {
  readonly accounts: CustomerAccount[] = [];
  flushes = 0;
  failCommit = false;
  committed = 0;
  lockedHolders = 0;

  async findOne(_entity: unknown, where: Row): Promise<CustomerAccount | null> {
    return (
      this.accounts.find((row) =>
        Object.entries(where).every(([key, value]) => ((row as unknown as Row)[key] ?? null) === value),
      ) ?? null
    );
  }

  /** The holders' lock of `entityManagerAccountRoleStore`: live, unblocked holders of the role. */
  async execute(_sql: string, [organizationId, roleId]: [string, string]): Promise<Array<{ id: string }>> {
    this.lockedHolders += 1;
    return this.accounts
      .filter((a) => a.organizationId === organizationId && a.organizationRoleId === roleId)
      .filter((a) => a.deletedAt == null && a.blockedAt == null)
      .map((a) => ({ id: a.id }));
  }

  create<T extends object>(_entity: new () => T, data: Partial<T>): T {
    return Object.assign(new CustomerAccount(), data) as unknown as T;
  }

  persist(row: CustomerAccount): this {
    if (!this.accounts.includes(row)) this.accounts.push(row);
    return this;
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    const result = await fn(this);
    if (this.failCommit) throw new Error('commit failed');
    this.committed += 1;
    return result;
  }

  fork(): this {
    return this;
  }
}

function harness(options: { personal?: boolean; buyerSelfServiceActions?: readonly string[] } = {}) {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const handAudits: RecordAuditInput[] = [];
  const ended: string[] = [];
  const steps: string[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      steps.push(`audit:${input.action}`);
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async (input: RecordAuditInput) => {
      handAudits.push(structuredClone(input));
      return input as never;
    },
  };
  // The bus's scope: work deferred through `afterScope` runs once the
  // transaction has resolved, and is dropped when it throws.
  let deferred: Array<() => Promise<void>> = [];
  const events = {
    run: async <T>(fn: () => Promise<T>) => {
      deferred = [];
      const result = await fn();
      for (const work of deferred) await work();
      return result;
    },
    emit: () => undefined,
  };
  // `specs/193-admin-form-extensions/` D-300.10 — the bus admits `buyerSelfService`
  // only on an action a manifest lists; the module's own list by default.
  const hooks = sealedCommandHookRegistry({
    hookableActions: [],
    moduleDependencies: {},
    hooks: [],
    buyerSelfServiceActions: (options.buyerSelfServiceActions ?? manifest.buyerSelfServiceActions ?? []).map((action) => ({ moduleId: 'customer_accounts', action })),
  });
  const commandBus = new CommandBus({ em } as never, audit as never, events as never, { hooks });
  const provisioned: Array<{ em: unknown; customerAccountId: string; ran: boolean }> = [];
  const port = new CustomerAccountCommandService({
    commandBus,
    emFactory: () => em as never,
    twoFactorEnrolments: async () => new Set<string>(),
    roles: {
      findRole: async () => null,
      predefinedRoleId: async (_org, kind) => (kind === 'administrator' ? ADMINISTRATOR : MEMBER),
    },
    isPersonal: async () => options.personal === true,
    personalOrganizations: {
      // D-300.31 — the provisioning runs as the caller's child Command, through its `run`.
      provisionFor: async ({ em: tem, run }, input) => {
        const ran = await run({
          action: 'organization.personal.provision',
          objectType: 'organization',
          objectId: input.customerAccountId,
          run: async () => ({ result: true, skipAudit: true }),
        });
        provisioned.push({ em: tem, customerAccountId: input.customerAccountId, ran });
        return { id: ORG, administratorRoleId: ADMINISTRATOR };
      },
    },
    sessions: {
      destroyAllForCustomer: async (id) => {
        steps.push('sessions-ended');
        ended.push(id);
      },
    },
    afterCommit: async (fn) => {
      deferred.push(fn);
    },
    hash: async (password) => `hashed:${password}`,
  });
  return { em, entries, handAudits, ended, steps, port, provisioned };
}

function seed(em: FakeEm, overrides: Partial<CustomerAccount> = {}): CustomerAccount {
  const account = Object.assign(new CustomerAccount(), {
    id: randomUUID(),
    organizationId: ORG,
    organizationRoleId: MEMBER,
    email: `${randomUUID()}@example.test`,
    passwordHash: 'x',
    firstName: 'Ada',
    lastName: 'Lovelace',
    deletedAt: null,
    blockedAt: null,
    blockReason: null,
    anonymizedAt: null,
    emailVerifiedAt: null,
    customerGroupId: null,
    customFieldValues: {},
    ...overrides,
  });
  em.accounts.push(account);
  return account;
}

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN, 'customer_accounts lifecycle command test', fn);
const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('customer_accounts lifecycle command test', fn);

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
  }
  throw new Error('expected a refusal');
}

describe('customer_account.blocked / .unblocked', () => {
  it('records one entry in the transaction, stamps the acting administrator, then ends the sessions', async () => {
    const h = harness();
    const account = seed(h.em);

    const record = await asAdmin(() => h.port.block(account.id, { reason: 'Chargebacks' }));

    expect(record.blockedAt).not.toBeNull();
    expect(account).toMatchObject({ blockSource: 'staff', blockedByAdminUserId: ADMIN, blockReason: 'Chargebacks' });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.blocked',
      objectType: 'customer_account',
      objectId: account.id,
      actorAdminUserId: ADMIN,
      stateBefore: { blockedAt: null, blockSource: null, hasBlockReason: false },
      stateAfter: { blockSource: 'staff', hasBlockReason: true },
    });
    expect(h.handAudits).toEqual([]);
    expect(h.steps).toEqual(['audit:customer_account.blocked', 'sessions-ended']);
    expect(h.ended).toEqual([account.id]);
  });

  it('under a worker’s system scope stamps no administrator and records the caller’s source', async () => {
    const h = harness();
    const account = seed(h.em);

    await asWorker(() => h.port.block(account.id, {}, { source: 'erp.credit-hold' }));

    expect(account.blockedByAdminUserId).toBeNull();
    expect(h.entries[0]).toMatchObject({ actorAdminUserId: null, stateAfter: { source: 'erp.credit-hold' } });
    expect(h.ended).toEqual([account.id]);
  });

  it('is idempotent: an account already blocked records nothing and ends no session', async () => {
    const h = harness();
    const account = seed(h.em, { blockedAt: new Date(), blockSource: 'staff' });

    await asAdmin(() => h.port.block(account.id, { reason: null }));

    expect(h.entries).toEqual([]);
    expect(h.ended).toEqual([]);
  });

  it('refuses the last administrator of a company Organization, under the holders’ lock', async () => {
    const h = harness();
    const account = seed(h.em, { organizationRoleId: ADMINISTRATOR });

    expect(await refusal(asAdmin(() => h.port.block(account.id, {})))).toEqual({
      statusCode: 409,
      code: 'ORG_OWNER_DEPLETION',
    });
    expect(h.em.lockedHolders).toBe(1);
    expect(account.blockedAt).toBeNull();
    expect(h.entries).toEqual([]);
    expect(h.ended).toEqual([]);
  });

  it('blocks an administrator another active administrator stands beside, and a personal Organization’s sole one', async () => {
    const company = harness();
    const first = seed(company.em, { organizationRoleId: ADMINISTRATOR });
    seed(company.em, { organizationRoleId: ADMINISTRATOR });
    await asAdmin(() => company.port.block(first.id, {}));
    expect(first.blockedAt).not.toBeNull();

    const personal = harness({ personal: true });
    const sole = seed(personal.em, { organizationRoleId: ADMINISTRATOR });
    await asAdmin(() => personal.port.block(sole.id, {}));
    expect(sole.blockedAt).not.toBeNull();
    expect(personal.em.lockedHolders).toBe(0);
  });

  it('ends no session and records nothing when the transaction does not commit', async () => {
    const h = harness();
    const account = seed(h.em);
    h.em.failCommit = true;

    await expect(asAdmin(() => h.port.block(account.id, {}))).rejects.toThrow('commit failed');
    expect(h.ended).toEqual([]);
  });

  it('refuses a reason over the admin body’s limit, and a malformed source, before anything is read', async () => {
    const h = harness();
    const account = seed(h.em);

    expect(await refusal(asAdmin(() => h.port.block(account.id, { reason: 'x'.repeat(1001) })))).toEqual({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
    expect(await refusal(asAdmin(() => h.port.block(account.id, {}, { source: 'ERP Sync!' })))).toEqual({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
    expect(account.blockedAt).toBeNull();
    expect(h.em.flushes).toBe(0);
  });

  it('answers 404 CUSTOMER_NOT_FOUND for a removed, unknown or malformed id', async () => {
    const h = harness();
    const removed = seed(h.em, { deletedAt: new Date() });
    for (const id of [removed.id, randomUUID(), 'not-a-uuid']) {
      expect(await refusal(asAdmin(() => h.port.block(id, {})))).toEqual({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' });
    }
  });

  it('unblocks, clearing the block, and records nothing for an account not blocked', async () => {
    const h = harness();
    const account = seed(h.em, { blockedAt: new Date(), blockSource: 'staff', blockReason: 'x', blockedByAdminUserId: ADMIN });

    await asAdmin(() => h.port.unblock(account.id));
    await asAdmin(() => h.port.unblock(account.id));

    expect(account).toMatchObject({ blockedAt: null, blockSource: null, blockReason: null, blockedByAdminUserId: null });
    expect(h.entries.map((e) => e.action)).toEqual(['customer_account.unblocked']);
    expect(h.entries[0]?.stateAfter).toEqual({ blockedAt: null, blockSource: null, hasBlockReason: false });
  });
});

describe('customer_account.deleted / .restored', () => {
  it('soft-deletes, names the requesting administrator, then ends the sessions', async () => {
    const h = harness();
    const account = seed(h.em);

    await asAdmin(() => h.port.softDelete(account.id));

    expect(account.deletedAt).not.toBeNull();
    expect(account.deletionRequestedByAdminUserId).toBe(ADMIN);
    expect(h.entries[0]).toMatchObject({ action: 'customer_account.deleted', stateBefore: { deletedAt: null } });
    expect(h.steps).toEqual(['audit:customer_account.deleted', 'sessions-ended']);
  });

  it('refuses a second deletion and the last company administrator, writing nothing', async () => {
    const h = harness();
    const deleted = seed(h.em, { deletedAt: new Date() });
    const admin = seed(h.em, { organizationRoleId: ADMINISTRATOR });

    expect(await refusal(asAdmin(() => h.port.softDelete(deleted.id)))).toEqual({
      statusCode: 409,
      code: 'CUSTOMER_ALREADY_DELETED',
    });
    expect(await refusal(asAdmin(() => h.port.softDelete(admin.id)))).toEqual({
      statusCode: 409,
      code: 'ORG_OWNER_DEPLETION',
    });
    expect(admin.deletedAt).toBeNull();
    expect(h.entries).toEqual([]);
    expect(h.ended).toEqual([]);
  });

  it('restores a deleted account; refuses one not deleted and one already anonymised', async () => {
    const h = harness();
    const deleted = seed(h.em, { deletedAt: new Date(), deletionRequestedByAdminUserId: ADMIN });
    const live = seed(h.em);
    const anonymized = seed(h.em, { deletedAt: new Date(), anonymizedAt: new Date() });

    await asAdmin(() => h.port.restore(deleted.id));
    expect(deleted).toMatchObject({ deletedAt: null, deletionRequestedByAdminUserId: null });
    expect(await refusal(asAdmin(() => h.port.restore(live.id)))).toEqual({ statusCode: 409, code: 'CUSTOMER_NOT_DELETED' });
    expect(await refusal(asAdmin(() => h.port.restore(anonymized.id)))).toEqual({
      statusCode: 409,
      code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED',
    });
    expect(h.entries.map((e) => [e.action, e.stateBefore, e.stateAfter])).toEqual([
      ['customer_account.restored', { deletedAt: 'set' }, { deletedAt: null }],
    ]);
  });
});

describe('customer_account.group_assigned', () => {
  it('sets and clears the direct group, the ids on both sides', async () => {
    const h = harness();
    const account = seed(h.em);
    const group = randomUUID();

    await asAdmin(() => h.port.setCustomerGroup(account.id, { customerGroupId: group }));
    await asAdmin(() => h.port.setCustomerGroup(account.id, { customerGroupId: null }));

    expect(account.customerGroupId).toBeNull();
    expect(h.entries.map((e) => [e.stateBefore, e.stateAfter])).toEqual([
      [{ customerGroupId: null }, { customerGroupId: group }],
      [{ customerGroupId: group }, { customerGroupId: null }],
    ]);
    expect(await refusal(asAdmin(() => h.port.setCustomerGroup(account.id, { customerGroupId: 'nope' })))).toEqual({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('customer_account.register_standalone', () => {
  it('provisions the personal Organization on the Command’s transaction and records the creation by name', async () => {
    const h = harness();

    const record = await asWorker(() =>
      h.port.createStandalone({ email: 'Ada@Example.TEST', password: 'pw', firstName: 'Ada', lastName: 'L', preferredLanguage: 'pl-PL' }),
    );

    expect(h.provisioned).toEqual([{ em: h.em, customerAccountId: record.id, ran: true }]);
    expect(record).toMatchObject({ email: 'ada@example.test', organizationId: ORG, organizationRoleId: ADMINISTRATOR });
    expect(h.em.accounts[0]).toMatchObject({ passwordHash: 'hashed:pw', preferredLanguage: 'pl-PL' });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.register_standalone',
      objectId: record.id,
      actorAdminUserId: null,
      stateBefore: null,
      stateAfter: { organizationRoleId: ADMINISTRATOR, emailVerified: false },
    });
    expect(JSON.stringify(h.entries)).not.toContain('ada@example.test');
  });

  it('puts a caller’s buyerSelfService on the Command, which the manifest lists (D-300.10 as amended)', async () => {
    expect(manifest.buyerSelfServiceActions).toContain('customer_account.register_standalone');
    const h = harness();
    const record = await asWorker(() =>
      h.port.createStandalone({ email: 'buyer@example.test', password: 'pw', firstName: 'B', lastName: 'Y' }, { buyerSelfService: true }),
    );
    expect(record.organizationId).toBe(ORG);
    // Refused outright where no manifest lists the action: the flag did reach the Command.
    const undeclared = harness({ buyerSelfServiceActions: [] });
    await expect(
      asWorker(() => undeclared.port.createStandalone({ email: 'buyer2@example.test', password: 'pw', firstName: 'B', lastName: 'Y' }, { buyerSelfService: true })),
    ).rejects.toMatchObject({ name: 'UndeclaredBuyerSelfServiceActionError' });
    // Without the option the Command carries no flag, so a system caller is bound.
    const bare = harness({ buyerSelfServiceActions: [] });
    await asWorker(() => bare.port.createStandalone({ email: 'system@example.test', password: 'pw', firstName: 'S', lastName: 'Y' }));
    expect(bare.provisioned).toHaveLength(1);
  });

  it('refuses an address already registered, provisioning nothing', async () => {
    const h = harness();
    seed(h.em, { email: 'taken@example.test' });

    expect(
      await refusal(asWorker(() => h.port.createStandalone({ email: 'TAKEN@example.test', password: 'pw', firstName: 'A', lastName: 'B' }))),
    ).toEqual({ statusCode: 409, code: 'EMAIL_ALREADY_REGISTERED' });
    expect(h.provisioned).toEqual([]);
    expect(h.entries).toEqual([]);
  });
});

describe('customer_account.update_profile / .email_verified', () => {
  it('names the changed fields; a new address clears the confirmation', async () => {
    const h = harness();
    const account = seed(h.em, { emailVerifiedAt: new Date() });

    await asAdmin(() => h.port.updateProfile(account.id, { email: 'New@Example.test', firstName: 'Grace' }));

    expect(account).toMatchObject({ email: 'new@example.test', firstName: 'Grace', emailVerifiedAt: null });
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.update_profile',
      stateBefore: null,
      stateAfter: { changedFields: ['email', 'emailVerifiedAt', 'firstName'] },
    });
    expect(h.handAudits).toEqual([]);
  });

  it('refuses an address another live account holds', async () => {
    const h = harness();
    seed(h.em, { email: 'held@example.test' });
    const account = seed(h.em);

    expect(await refusal(asAdmin(() => h.port.updateProfile(account.id, { email: 'held@example.test' })))).toEqual({
      statusCode: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    expect(h.entries).toEqual([]);
  });

  it('stamps the confirmation once and records only the first', async () => {
    const h = harness();
    const account = seed(h.em);
    const first = new Date('2026-11-01T10:00:00Z');

    await asWorker(() => h.port.markEmailVerified(account.id, { verifiedAt: first }));
    await asWorker(() => h.port.markEmailVerified(account.id, { verifiedAt: new Date() }));

    expect(account.emailVerifiedAt).toBe(first);
    expect(h.entries.map((e) => [e.action, e.stateBefore, e.stateAfter])).toEqual([
      ['customer_account.email_verified', { emailVerifiedAt: null }, { emailVerifiedAt: first.toISOString() }],
    ]);
    expect(await refusal(asWorker(() => h.port.markEmailVerified(randomUUID(), { verifiedAt: first })))).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});
