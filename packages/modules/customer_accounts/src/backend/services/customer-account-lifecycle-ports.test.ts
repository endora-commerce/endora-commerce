import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  CustomerAccountAnonymizedEventV1Schema,
  type CustomerAccountAnonymizedEventV1,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { CustomerAccountLifecycleWriteService } from './customer-account-lifecycle-ports.js';

/**
 * `customer_account.anonymized.v1` (`specs/170-forms-module/` contracts/events-and-webhook.md §3,
 * research R-17): `anonymize` announces the irreversible step once, after its write and its audit
 * row, so a module holding data attributed to the account can erase it in the same sweep step. An
 * account that was already anonymised announces nothing.
 *
 * Issue #802: the write and its audit row commit in one transaction, and the announcement follows
 * the commit, so a failed audit write leaves the account unscrubbed, still due and unannounced.
 */

const ACCOUNT_ID = '00000000-0000-4000-8000-0000000c0a01';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c0a02';

function harness(options: { failCommit?: boolean } = {}) {
  const steps: string[] = [];
  const emitted: CustomerAccountAnonymizedEventV1[] = [];
  const audited: Array<{ action: string; stateBefore: unknown; stateAfter: unknown }> = [];
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
    recordWithin: (tem: EntityManager, entry: { action: string; stateBefore: unknown; stateAfter: unknown }) => {
      steps.push(`audit:${entry.action}${tem === em ? '' : ':foreign-em'}`);
      audited.push(entry);
    },
  } as unknown as AuditPort;
  const service = new CustomerAccountLifecycleWriteService(
    () => em,
    audit,
    async () => new Set<string>(),
    {} as PersonalOrganizationProvisionApi,
    undefined,
    async (payload) => {
      steps.push('emit');
      emitted.push(payload);
    },
  );
  return { service, steps, emitted, account, audited };
}

describe('CustomerAccountLifecycleWriteService.anonymize — the anonymisation event', () => {
  it('names the event as the contract does', () => {
    expect(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT).toBe('customer_account.anonymized.v1');
  });

  it('emits once on the transition, after the scrub and its audit row commit, with the account and its organisation', async () => {
    const { service, steps, emitted } = harness();

    await service.anonymize(ACCOUNT_ID);

    expect(steps).toEqual(['begin', 'audit:customer_account.anonymized', 'flush', 'commit', 'emit']);
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

describe('CustomerAccountLifecycleWriteService.anonymize — the scrub (#802)', () => {
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

describe('CustomerAccountLifecycleWriteService.anonymize — the block reason (#843)', () => {
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
