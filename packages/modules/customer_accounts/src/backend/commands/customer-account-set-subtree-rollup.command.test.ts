/**
 * `customer_account.set_subtree_rollup` (feature 056 T032, issue #1338).
 *
 * The operator's roll-up toggle runs on the **real** `CommandBus` against an
 * in-memory EntityManager with a recording audit port, so what is asserted is
 * the one entry the bus writes — in the write's transaction, which a hand
 * audit after the flush was not. The entry carries the flag only, never the
 * member's e-mail or names (`specs/conventions/audit-state.md`, D-288).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountMemberWriteService } from '../services/customer-account-ports.js';
import { makeSetCustomerAccountSubtreeRollupCommand } from './customer-account-set-subtree-rollup.command.js';

const ACTOR = '00000000-0000-4000-8000-000000133803';
const ORG = randomUUID();
const ROLE = randomUUID();
const EMAIL = 's1338@example.test';
const NAME = 'S1338-NAME';

type Row = Record<string, unknown>;

class FakeEm {
  readonly rows: CustomerAccount[] = [];
  flushes = 0;
  failFlush = false;

  async findOne(_entity: unknown, where: Row): Promise<CustomerAccount | null> {
    return (
      this.rows.find((row) =>
        Object.entries(where).every(([key, value]) => ((row as unknown as Row)[key] ?? null) === value),
      ) ?? null
    );
  }

  async flush(): Promise<void> {
    if (this.failFlush) throw new Error('flush failed');
    this.flushes += 1;
  }

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const handAudits: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async (input: RecordAuditInput) => {
      handAudits.push(structuredClone(input));
      return input as never;
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  const service = new CustomerAccountMemberWriteService(
    () => em as never,
    async () => new Set<string>(),
    audit as never,
    { commandBus },
  );
  return { em, entries, handAudits, commandBus, service };
}

function seed(em: FakeEm, subtreeRollupEnabled: boolean): CustomerAccount {
  const account = Object.assign(new CustomerAccount(), {
    id: randomUUID(),
    organizationId: ORG,
    organizationRoleId: ROLE,
    email: EMAIL,
    passwordHash: 'x',
    firstName: NAME,
    lastName: NAME,
    deletedAt: null,
    subtreeRollupEnabled,
  });
  em.rows.push(account);
  return account;
}

function acting<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ACTOR, 'customer_accounts subtree roll-up test', fn);
}

describe('customer_account.set_subtree_rollup (issue #1338)', () => {
  it('sets the flag and records exactly one entry, the flag on both sides', async () => {
    const h = harness();
    const account = seed(h.em, false);

    await acting(() =>
      h.commandBus.run(makeSetCustomerAccountSubtreeRollupCommand({ customerAccountId: account.id, enabled: true })),
    );

    expect(account.subtreeRollupEnabled).toBe(true);
    expect(h.em.flushes).toBe(1);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.set_subtree_rollup',
      objectType: 'customer_account',
      objectId: account.id,
      stateBefore: { subtreeRollupEnabled: false },
      stateAfter: { subtreeRollupEnabled: true },
    });
    expectNoAuditValues(h.entries, [EMAIL, NAME]);
  });

  it('the write port runs the Command: one entry on the bus, none by hand', async () => {
    const h = harness();
    const account = seed(h.em, true);

    const record = await acting(() => h.service.setSubtreeRollup(account.id, false));

    expect(record.subtreeRollupEnabled).toBe(false);
    expect(h.entries.map((entry) => entry.action)).toEqual(['customer_account.set_subtree_rollup']);
    expect(h.handAudits).toEqual([]);
  });

  it('answers 404 for an id no live account has, and records nothing', async () => {
    const h = harness();
    const removed = seed(h.em, false);
    removed.deletedAt = new Date();

    for (const id of [removed.id, 'not-a-uuid']) {
      await expect(acting(() => h.service.setSubtreeRollup(id, true))).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    expect(h.entries).toEqual([]);
  });

  it('records no entry when the write fails', async () => {
    const h = harness();
    const account = seed(h.em, false);
    h.em.failFlush = true;

    await expect(acting(() => h.service.setSubtreeRollup(account.id, true))).rejects.toThrow('flush failed');
    expect(h.entries).toEqual([]);
  });
});
