import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  CustomerAccountAnonymizedEventV1Schema,
  type CustomerAccountAnonymizedEventV1,
} from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountCommandService } from '../services/customer-account-command-port.js';

/**
 * `customer_account.anonymized` as a Command (`specs/186-aggregate-ports/` T047, T050, issue
 * #1822), run by `customerAccountCommandPort.anonymize` on the **real** `CommandBus` over an
 * in-memory EntityManager — until 0.113.0 it was the lifecycle port's hand-audited transaction,
 * and these cases were that service's.
 *
 * `customer_account.anonymized.v1` (`specs/170-forms-module/` contracts/events-and-webhook.md §3,
 * research R-17): the port announces the irreversible step once, after the Command has committed,
 * so a module holding data attributed to the account can erase it in the same sweep step. An
 * account that was already anonymised announces nothing.
 *
 * Issue #802: the write and its audit row commit in one transaction, and the announcement follows
 * the commit, so a failed commit leaves the account unscrubbed, still due and unannounced. Under
 * the sweep's system scope the entry has no actor.
 */

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000c0a01';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c0a02';

function harness(options: { failCommit?: boolean } = {}) {
  const steps: string[] = [];
  const emitted: CustomerAccountAnonymizedEventV1[] = [];
  const audited: Array<{ action: string; actorAdminUserId: string | null; stateBefore: unknown; stateAfter: unknown }> = [];
  const account = Object.assign(Object.create(CustomerAccount.prototype) as CustomerAccount, {
    id: ACCOUNT_ID,
    organizationId: ORGANIZATION_ID,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'admin',
    passwordHash: 'hash',
    anonymizedAt: null,
    deletedAt: new Date('2026-01-01T00:00:00Z'),
    customFieldValues: { birthday: '1990-01-01', nickname: 'Ada' },
  });
  const em: EntityManager = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) throw new Error('unexpected entity');
      return where['id'] === ACCOUNT_ID ? account : null;
    },
    flush: async () => {
      steps.push('flush');
    },
    fork: () => em,
    transactional: async <T>(work: (tem: EntityManager) => Promise<T>): Promise<T> => {
      steps.push('begin');
      const result = await work(em);
      if (options.failCommit) {
        steps.push('rollback');
        throw new Error('commit failed');
      }
      steps.push('commit');
      return result;
    },
  } as unknown as EntityManager;
  const audit = {
    record: async (entry: { action: string }) => {
      steps.push(`audit-outside-transaction:${entry.action}`);
    },
    recordWithin: (
      tem: EntityManager,
      entry: { action: string; actorAdminUserId: string | null; stateBefore: unknown; stateAfter: unknown },
    ) => {
      steps.push(`audit:${entry.action}${tem === em ? '' : ':foreign-em'}`);
      audited.push(entry);
    },
  } as unknown as AuditPort;
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: () => undefined };
  const commandBus = new CommandBus({ em } as never, audit, events as never);
  const unwired = (): never => {
    throw new Error('not used by anonymize');
  };
  const port = new CustomerAccountCommandService({
    commandBus,
    emFactory: () => em,
    twoFactorEnrolments: async () => new Set<string>(),
    roles: { findRole: unwired, predefinedRoleId: unwired },
    isPersonal: unwired,
    personalOrganizations: { provisionFor: unwired },
    sessions: { destroyAllForCustomer: unwired },
    afterCommit: unwired,
    announceAnonymized: async (payload: CustomerAccountAnonymizedEventV1) => {
      steps.push('emit');
      emitted.push(payload);
    },
  });
  // The retention sweep runs in a system scope.
  const service = {
    anonymize: (id: string) => withSystemScope('customer_accounts anonymize test', () => port.anonymize(id)),
  };
  return { service, steps, emitted, account, audited };
}

describe('customer_account.anonymized — the anonymisation event', () => {
  it('names the event as the contract does', () => {
    expect(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT).toBe('customer_account.anonymized.v1');
  });

  it('emits once on the transition, after the scrub and its audit row commit, with the account and its organisation', async () => {
    const { service, steps, emitted, audited } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(steps).toEqual(['begin', 'flush', 'audit:customer_account.anonymized', 'commit', 'emit']);
    // The sweep's system scope: the entry names no administrator.
    expect(audited[0]!.actorAdminUserId).toBeNull();
    expect(emitted).toHaveLength(1);
    const event = CustomerAccountAnonymizedEventV1Schema.parse(emitted[0]);
    expect(event).toMatchObject({ customerAccountId: ACCOUNT_ID, organizationId: ORGANIZATION_ID });
    expect(event.eventId).not.toBe('');
  });

  it('emits nothing for an account that is already anonymised', async () => {
    const { service, emitted } = harness();

    await service.anonymize(ACCOUNT_ID);
    await service.anonymize(ACCOUNT_ID);

    expect(emitted).toHaveLength(1);
  });

  it('carries no e-mail, name or other personal data in the payload', async () => {
    const { service, emitted } = harness();
    await service.anonymize(ACCOUNT_ID);
    expect(Object.keys(emitted[0]!).sort()).toEqual(['customerAccountId', 'eventId', 'occurredAt', 'organizationId']);
  });

  it('announces nothing when the transaction does not commit (#802)', async () => {
    const { service, steps, emitted } = harness({ failCommit: true });

    await expect(service.anonymize(ACCOUNT_ID)).rejects.toThrow('commit failed');

    expect(emitted).toEqual([]);
    expect(steps).not.toContain('emit');
  });
});

describe('customer_account.anonymized — the scrub (#802)', () => {
  it('clears every custom field value (owner ruling Q1)', async () => {
    const { service, account } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(account.customFieldValues).toEqual({});
  });

  it('records no e-mail, name or custom field value in its audit row (owner ruling Q2)', async () => {
    const { service, audited } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(audited).toHaveLength(1);
    expect(audited[0]!.stateBefore).toEqual({
      anonymizedAt: null,
      customFieldKeys: ['birthday', 'nickname'],
      hadBlockReason: false,
    });
    const serialized = JSON.stringify([audited[0]!.stateBefore, audited[0]!.stateAfter]);
    for (const personal of ['ada@example.com', 'Ada', 'Lovelace', '1990-01-01']) {
      expect(serialized).not.toContain(personal);
    }
  });
});

describe('customer_account.anonymized — the block reason (#843)', () => {
  const REASON = 'Ada threatened the courier';

  it('erases the block reason and keeps the block, recording only that a reason existed', async () => {
    const { service, account, audited } = harness();
    const blockedAt = new Date('2026-03-04T05:06:07Z');
    Object.assign(account, { blockedAt, blockSource: 'staff', blockReason: REASON });

    await service.anonymize(ACCOUNT_ID);

    expect(account.blockReason).toBeNull();
    expect(account.blockedAt).toBe(blockedAt);
    expect(account.blockSource).toBe('staff');
    expect(audited).toHaveLength(1);
    expect(audited[0]!.stateBefore).toMatchObject({ hadBlockReason: true });
    expect(JSON.stringify([audited[0]!.stateBefore, audited[0]!.stateAfter])).not.toContain(REASON);
  });

  it('finishes an account anonymised before #843 once, without announcing it again', async () => {
    const { service, account, audited, emitted } = harness();
    const anonymizedAt = new Date('2026-04-05T06:07:08Z');
    Object.assign(account, { anonymizedAt, customFieldValues: {}, blockReason: REASON });

    await service.anonymize(ACCOUNT_ID);
    await service.anonymize(ACCOUNT_ID);

    expect(account.blockReason).toBeNull();
    expect(account.anonymizedAt).toBe(anonymizedAt);
    expect(audited).toHaveLength(1);
    expect(audited[0]!.stateBefore).toEqual({
      anonymizedAt: anonymizedAt.toISOString(),
      customFieldKeys: [],
      hadBlockReason: true,
    });
    expect(emitted).toEqual([]);
  });
});

describe('customer_account.anonymized — finishing an earlier scrub (#843, design #923 §2.3)', () => {
  it('U-5 — finishes an account anonymised before #802 that has custom field values and no block reason', async () => {
    const { service, account, audited, emitted, steps } = harness();
    const anonymizedAt = new Date('2026-01-02T03:04:05Z');
    Object.assign(account, { anonymizedAt, blockReason: null });

    await service.anonymize(ACCOUNT_ID);

    expect(account.customFieldValues).toEqual({});
    expect(account.anonymizedAt).toBe(anonymizedAt);
    expect(audited).toHaveLength(1);
    expect(audited[0]!.stateBefore).toEqual({
      anonymizedAt: anonymizedAt.toISOString(),
      customFieldKeys: ['birthday', 'nickname'],
      hadBlockReason: false,
    });
    expect(steps).toContain('flush');
    expect(emitted).toEqual([]);
  });

  it('U-6 — a fully scrubbed account gives no write, no row and no announcement', async () => {
    const { service, account, audited, emitted, steps } = harness();
    Object.assign(account, { anonymizedAt: new Date('2026-01-02T03:04:05Z'), customFieldValues: {}, blockReason: null });

    await service.anonymize(ACCOUNT_ID);

    expect(audited).toEqual([]);
    expect(emitted).toEqual([]);
    expect(steps).not.toContain('flush');
  });
});


describe('customer_account.anonymized — the preferred language (#652, D-292)', () => {
  it('erases the preferred language with the rest of the personal data, and records no tag', async () => {
    const { service, account, audited } = harness();
    Object.assign(account, { preferredLanguage: 'pl-PL' });

    await service.anonymize(ACCOUNT_ID);

    expect(account.preferredLanguage).toBeNull();
    expect(audited).toHaveLength(1);
    expect(JSON.stringify([audited[0]!.stateBefore, audited[0]!.stateAfter])).not.toContain('pl-PL');
  });

  it('finishes an account anonymised before #652 that still holds a language, once and unannounced', async () => {
    const { service, account, audited, emitted } = harness();
    const anonymizedAt = new Date('2026-05-06T07:08:09Z');
    Object.assign(account, { anonymizedAt, customFieldValues: {}, blockReason: null, preferredLanguage: 'en-US' });

    await service.anonymize(ACCOUNT_ID);
    await service.anonymize(ACCOUNT_ID);

    expect(account.preferredLanguage).toBeNull();
    expect(account.anonymizedAt).toBe(anonymizedAt);
    expect(audited).toHaveLength(1);
    expect(JSON.stringify([audited[0]!.stateBefore, audited[0]!.stateAfter])).not.toContain('en-US');
    expect(emitted).toEqual([]);
  });
});
