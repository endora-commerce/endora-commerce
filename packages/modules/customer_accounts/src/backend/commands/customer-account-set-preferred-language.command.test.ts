/**
 * `customer_account.set_preferred_language` (issue #652, D-292).
 *
 * Run through the **real** `CommandBus` against an in-memory EntityManager
 * with a recording audit port, so what is asserted is the entry the bus
 * writes. The tag is personal data (`specs/conventions/audit-state.md`, list
 * 2): the entry names the field and where the write came from, never the
 * language — `expectNoAuditValues` holds every entry to that.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CUSTOMER_ACCOUNT_AUDIT_KEYS } from '../services/customer-account-audit-state.js';
import { CustomerAccountPreferenceService } from '../services/customer-account-preference-port.js';
import { makeSetCustomerAccountPreferredLanguageCommand } from './customer-account-set-preferred-language.command.js';

const ACTOR = '00000000-0000-4000-8000-0000000065a2';
const ORG = randomUUID();
const ROLE = randomUUID();

/** Tags a sentinel scan can find: none of them may reach an audit state. */
const STORED = 'x-s652a';
const CHOSEN = 'x-s652b';

type Row = Record<string, unknown>;

class FakeEm {
  readonly rows: CustomerAccount[] = [];
  flushes = 0;

  async findOne(_entity: unknown, where: Row): Promise<CustomerAccount | null> {
    return (
      this.rows.find((row) =>
        Object.entries(where).every(([key, value]) => ((row as unknown as Row)[key] ?? null) === value),
      ) ?? null
    );
  }

  async flush(): Promise<void> {
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
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async (input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  const service = new CustomerAccountPreferenceService(async () => new Set<string>(), commandBus);
  return { em, entries, commandBus, service };
}

function seed(em: FakeEm, preferredLanguage: string | null): CustomerAccount {
  const account = Object.assign(new CustomerAccount(), {
    id: randomUUID(),
    organizationId: ORG,
    organizationRoleId: ROLE,
    email: 's652@example.test',
    passwordHash: 'x',
    firstName: 'S652',
    lastName: 'S652',
    deletedAt: null,
    preferredLanguage,
  });
  em.rows.push(account);
  return account;
}

function acting<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ACTOR, 'customer_accounts preferred-language test', fn);
}

describe('customer_account.set_preferred_language — self_service (#652)', () => {
  it('overwrites a stored value and audits the field name and the source, never the tag', async () => {
    const h = harness();
    const account = seed(h.em, STORED);

    await acting(() =>
      h.commandBus.run(
        makeSetCustomerAccountPreferredLanguageCommand({
          customerAccountId: account.id,
          preferredLanguage: CHOSEN,
          source: 'self_service',
        }),
      ),
    );

    expect(account.preferredLanguage).toBe(CHOSEN);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: 'customer_account.set_preferred_language',
      objectType: 'customer_account',
      objectId: account.id,
      stateBefore: null,
      stateAfter: { changedFields: ['preferredLanguage'], source: 'self_service' },
    });
    expectNoAuditValues(h.entries, [STORED, CHOSEN]);
    const keys = Object.keys(h.entries[0]!.stateAfter ?? {});
    expect(keys.filter((key) => !CUSTOMER_ACCOUNT_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('records nothing when the account already holds that language', async () => {
    const h = harness();
    const account = seed(h.em, CHOSEN);

    await acting(() => h.service.setPreferredLanguage(account.id, CHOSEN));

    expect(h.entries).toEqual([]);
  });

  it('answers 404 for an id no live account has', async () => {
    const h = harness();
    const removed = seed(h.em, null);
    removed.deletedAt = new Date();

    await expect(acting(() => h.service.setPreferredLanguage(removed.id, CHOSEN))).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    await expect(acting(() => h.service.setPreferredLanguage(randomUUID(), CHOSEN))).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(h.entries).toEqual([]);
  });

  it('answers the record with the stored tag', async () => {
    const h = harness();
    const account = seed(h.em, null);

    const record = await acting(() => h.service.setPreferredLanguage(account.id, CHOSEN));

    expect(record.preferredLanguage).toBe(CHOSEN);
    expect(record.id).toBe(account.id);
  });
});

describe('customer_account.set_preferred_language — sign_in (#652)', () => {
  it('fills an unknown language and audits it with source sign_in', async () => {
    const h = harness();
    const account = seed(h.em, null);

    await h.service.captureIfUnset(account.id, CHOSEN);

    expect(account.preferredLanguage).toBe(CHOSEN);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]?.stateAfter).toEqual({ changedFields: ['preferredLanguage'], source: 'sign_in' });
    expectNoAuditValues(h.entries, [CHOSEN]);
  });

  it('is a no-op on an account that already has a language — no write, no audit entry', async () => {
    const h = harness();
    const account = seed(h.em, STORED);

    await h.service.captureIfUnset(account.id, CHOSEN);

    expect(account.preferredLanguage).toBe(STORED);
    expect(h.entries).toEqual([]);
    expect(h.em.flushes).toBe(0);
  });

  it('does nothing for an unknown account', async () => {
    const h = harness();

    await expect(h.service.captureIfUnset(randomUUID(), CHOSEN)).resolves.toBeUndefined();

    expect(h.entries).toEqual([]);
  });
});
