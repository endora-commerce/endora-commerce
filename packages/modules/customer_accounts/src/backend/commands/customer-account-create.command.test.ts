/**
 * `customer_account.create` (`specs/176-command-hooks-outbox/` T002; FR-002,
 * FR-004, FR-005; `contracts/registration-command.md`).
 *
 * The account creation is one Command with one implementation: it runs
 * top-level, through the member write port, and as the child of a registration
 * through `ctx.run`, on the parent's transactional `em`. The password is hashed
 * when the creation is prepared, never inside the Command's run. The Command
 * refuses an e-mail already registered with `409 EMAIL_ALREADY_REGISTERED`,
 * from its pre-check and from the unique index, and its audit state names the
 * fields it wrote — never the e-mail, the names, a custom-field value or the
 * Organization (`specs/conventions/audit-state.md`, D-288).
 */
import { AssertionError } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CustomerAccountCreateCommand,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CUSTOMER_ACCOUNT_AUDIT_KEYS } from '../services/customer-account-audit-state.js';
import { createCustomerAccountMemberCommandPort, toCustomerAccountRecord } from '../services/customer-account-ports.js';
import { prepareCustomerAccountCreate } from './customer-account-create.command.js';

// The platform's Command and the contract's structural twin are assignable both
// ways, so a caller in another module hands the port's Command to the bus
// unchanged (`tsc` holds these two lines; there is nothing to run).
const toContract = (command: Command<CustomerAccountRecord>): CustomerAccountCreateCommand => command;
const toPlatform = (command: CustomerAccountCreateCommand): Command<CustomerAccountRecord> => command;
void toContract;
void toPlatform;

const ORG = randomUUID();
const ROLE = randomUUID();
const S = {
  email: 's176@example.test',
  firstName: 'S176-FIRST',
  lastName: 'S176-LAST',
  customField: 'S176-CF',
} as const;
const SENTINELS = [...Object.values(S), ORG];

type Row = Record<string, unknown>;

/** Enough of MikroORM's EntityManager for this write. */
class FakeEm {
  readonly rows: Row[] = [];
  failNextFlushWith: Error | null = null;
  transactions = 0;

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    return Object.assign(new entity(), data);
  }

  async findOne(_entity: unknown, where: Row): Promise<Row | null> {
    return this.rows.find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async persistAndFlush(row: Row): Promise<void> {
    if (this.failNextFlushWith) {
      const err = this.failNextFlushWith;
      this.failNextFlushWith = null;
      throw err;
    }
    this.rows.push(row);
  }

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  return { em, entries, commandBus };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('customer_accounts unit test: customer_account.create', fn);

/** A brand-new account holds no second factor. */
const DEPS = { toRecord: (account: CustomerAccount) => toCustomerAccountRecord(account, false) };

const INPUT = {
  email: S.email,
  password: 'correct horse battery staple',
  firstName: S.firstName,
  lastName: S.lastName,
  customFieldValues: { phone: S.customField },
};

function expectNoValues(entries: readonly RecordAuditInput[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const text = JSON.stringify(entries.map((entry) => [entry.stateBefore, entry.stateAfter])).toLowerCase();
  for (const sentinel of SENTINELS) expect(text, String(sentinel)).not.toContain(String(sentinel).toLowerCase());
}

describe('customer_account.create — one Command (176 T002)', () => {
  it('runs top-level: one entry naming the fields, against the account it created', async () => {
    const h = harness();
    const prepared = await prepareCustomerAccountCreate(INPUT, DEPS);

    const record = await asSystem(() =>
      h.commandBus.run(prepared.command({ organizationId: ORG, organizationRoleId: ROLE })),
    );

    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.create',
      objectType: 'customer_account',
      objectId: record.id,
      stateBefore: null,
      stateAfter: {
        changedFields: ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId'],
        organizationRoleId: ROLE,
        emailVerified: false,
      },
    });
    expect(record).toMatchObject({ email: S.email, organizationId: ORG, customFieldValues: { phone: S.customField } });
    expectNoValues(h.entries);
    for (const key of Object.keys(h.entries[0]!.stateAfter ?? {})) {
      expect(CUSTOMER_ACCOUNT_AUDIT_KEYS.has(key), key).toBe(true);
    }
  });

  it('hashes when prepared, never inside the run', async () => {
    const h = harness();
    const steps: string[] = [];
    const hash = vi.fn(async (password: string) => {
      steps.push('hash');
      return `hashed:${password}`;
    });
    const prepared = await prepareCustomerAccountCreate(INPUT, { ...DEPS, hash });
    steps.push('prepared');
    const command = prepared.command({ organizationId: ORG, organizationRoleId: ROLE });
    await asSystem(() => h.commandBus.run(command));

    expect(steps).toEqual(['hash', 'prepared']);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(h.em.rows[0]!['passwordHash']).toBe(`hashed:${INPUT.password}`);
  });

  it('refuses a registered e-mail from its pre-check: 409, no row, no entry', async () => {
    const h = harness();
    h.em.rows.push({ id: randomUUID(), email: S.email });
    const prepared = await prepareCustomerAccountCreate({ ...INPUT, email: S.email.toUpperCase() }, DEPS);

    await expect(
      asSystem(() => h.commandBus.run(prepared.command({ organizationId: ORG, organizationRoleId: ROLE }))),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.EMAIL_ALREADY_REGISTERED });
    expect(h.em.rows).toHaveLength(1);
    expect(h.entries).toEqual([]);
  });

  it('refuses a racing e-mail from the unique index: 409, no entry', async () => {
    const h = harness();
    h.em.failNextFlushWith = new UniqueConstraintViolationException(new Error('duplicate key value'));
    const prepared = await prepareCustomerAccountCreate(INPUT, DEPS);

    await expect(
      asSystem(() => h.commandBus.run(prepared.command({ organizationId: ORG, organizationRoleId: ROLE }))),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.EMAIL_ALREADY_REGISTERED });
    expect(h.entries).toEqual([]);
  });

  it('runs as a child through ctx.run, on the parent transaction and its em', async () => {
    const h = harness();
    const prepared = await prepareCustomerAccountCreate(INPUT, DEPS);
    let parentEm: unknown;
    const parent: Command<CustomerAccountRecord> = {
      action: 'test.parent',
      objectType: 'organization',
      objectId: ORG,
      run: async (ctx) => {
        parentEm = ctx.em;
        const account = await ctx.run!(prepared.command({ organizationId: ORG, organizationRoleId: ROLE }));
        return { result: account, after: { changedFields: [] } };
      },
    };

    const record = await asSystem(() => h.commandBus.run(parent));

    expect(parentEm).toBe(h.em);
    expect(h.em.transactions).toBe(1);
    expect(h.em.rows.map((row) => row['id'])).toEqual([record.id]);
    expect(h.entries.map((entry) => entry.action)).toEqual(['customer_account.create', 'test.parent']);
  });

  it('is what the published port prepares', async () => {
    const h = harness();
    const port = createCustomerAccountMemberCommandPort();
    const prepared = await port.prepareCreate(INPUT);

    const record = await asSystem(() =>
      h.commandBus.run(prepared.command({ organizationId: ORG, organizationRoleId: ROLE })),
    );

    expect(record.organizationId).toBe(ORG);
    expect(h.entries.map((entry) => entry.action)).toEqual(['customer_account.create']);
    expect(h.em.rows[0]).toBeInstanceOf(CustomerAccount);
  });
});
