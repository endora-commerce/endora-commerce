import { describe, expect, it } from 'vitest';
import type {
  AddressServicePort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationRecord,
  PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { CustomerDeletionService } from './customer-deletion-service.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type { OrganizationDepletionGuard } from './organization-depletion-guard.js';

/**
 * Issue #800 — the order of the anonymisation sweep, without a database.
 *
 * The account's `anonymizedAt` is the cascade's commit marker, so it is the
 * last write: organisation, then its addresses, then the account. A step that
 * throws leaves the account on the work list for the next tick, and a module
 * that is off aborts the tick rather than being counted as one account's
 * failure. The behaviour over the real owners is
 * `backend/test/integration/customers/customer-deletion-service.test.ts`.
 */

type Step = 'org' | 'addresses' | 'account';

function harness(failAt: { step: Step; error: Error } | null = null) {
  const calls: Array<[Step, string]> = [];
  const due = ['acc-1', 'acc-2'].map(
    (id) => ({ id, organizationId: `org-${id}` }) as unknown as CustomerAccountRecord,
  );
  const fail = (step: Step) => {
    if (failAt?.step === step) throw failAt.error;
  };
  const accountWrites = {
    listDueForAnonymization: async () => due,
    anonymize: async (id: string) => {
      calls.push(['account', id]);
      fail('account');
      return due.find((d) => d.id === id)!;
    },
  } as unknown as CustomerAccountLifecycleWritePort;
  const personalOrganizations = {
    anonymizeIfOrphaned: async (id: string) => {
      calls.push(['org', id]);
      fail('org');
      return { id: `org-${id}` } as OrganizationRecord;
    },
    // Issue #923 — nothing left half-scrubbed by an earlier rule.
    listIncompletelyScrubbed: async () => [],
  } as unknown as PersonalOrganizationPort;
  const addresses: Pick<AddressServicePort, 'anonymizeForOrganization'> = {
    anonymizeForOrganization: async (organizationId: string) => {
      calls.push(['addresses', organizationId]);
      fail('addresses');
      return 1;
    },
  };
  const service = new CustomerDeletionService(
    {} as CustomerAccountReadPort,
    accountWrites,
    personalOrganizations,
    {} as CustomerAuthorityService,
    { destroyAllForCustomer: async () => undefined },
    {} as OrganizationDepletionGuard,
    addresses,
    async () => 365,
  );
  return { service, calls };
}

describe('CustomerDeletionService.sweep (issue #800)', () => {
  it('U-1 — runs organisation, then addresses, then the account, per account', async () => {
    const { service, calls } = harness();
    expect(await service.sweep(0, new Date())).toBe(2);
    expect(calls).toEqual([
      ['org', 'acc-1'],
      ['addresses', 'org-acc-1'],
      ['account', 'acc-1'],
      ['org', 'acc-2'],
      ['addresses', 'org-acc-2'],
      ['account', 'acc-2'],
    ]);
  });

  it.each<Step>(['org', 'addresses'])(
    'U-2 — a failure at the %s step leaves the account un-anonymised and the sweep goes on',
    async (step) => {
      const { service, calls } = harness({ step, error: new Error('boom') });
      await expect(service.sweep(0, new Date())).rejects.toThrow(/acc-1.*acc-2|acc-2.*acc-1/);
      expect(calls.filter(([s]) => s === 'account')).toEqual([]);
      // Both accounts were attempted: the first failure did not end the tick.
      expect(calls.filter(([s]) => s === 'org').map(([, id]) => id)).toEqual(['acc-1', 'acc-2']);
    },
  );

  it('U-3 — a disabled module aborts the tick instead of being collected', async () => {
    const disabled = new ModuleDisabledError('addresses');
    const { service, calls } = harness({ step: 'addresses', error: disabled });
    await expect(service.sweep(0, new Date())).rejects.toBe(disabled);
    expect(calls).toEqual([
      ['org', 'acc-1'],
      ['addresses', 'org-acc-1'],
    ]);
  });
});

/**
 * Issue #923 — the work list is every subject not fully scrubbed under the
 * current rule, not only the accounts never scrubbed: the due accounts, then
 * the anonymised members of each personal organisation `organizations` reports
 * as incompletely scrubbed, each once. Every subject goes through the same
 * cascade, so the finish is the convergent re-run #800 already made safe.
 */
describe('CustomerDeletionService.sweep — subjects an earlier rule left unfinished (issue #923)', () => {
  type Member = { id: string; anonymized: boolean };

  function residualHarness(options: {
    due: string[];
    incomplete: string[];
    members: Record<string, Member[]>;
    failOrgFor?: string;
    disabledAt?: 'listIncompletelyScrubbed' | 'listByOrganization';
  }) {
    const processed: string[] = [];
    const disabled = new ModuleDisabledError('organizations');
    const record = (id: string, organizationId: string, anonymizedAt: Date | null) =>
      ({ id, organizationId, anonymizedAt }) as unknown as CustomerAccountRecord;
    const accountWrites = {
      listDueForAnonymization: async () => options.due.map((id) => record(id, `org-${id}`, null)),
      anonymize: async (id: string) => record(id, `org-${id}`, new Date()),
    } as unknown as CustomerAccountLifecycleWritePort;
    const accounts = {
      listByOrganization: async (organizationId: string) => {
        if (options.disabledAt === 'listByOrganization') throw disabled;
        return (options.members[organizationId] ?? []).map((m) =>
          record(m.id, organizationId, m.anonymized ? new Date('2026-04-05T06:07:08.000Z') : null),
        );
      },
    } as unknown as CustomerAccountReadPort;
    const personalOrganizations = {
      anonymizeIfOrphaned: async (id: string) => {
        processed.push(id);
        if (options.failOrgFor === id) throw new Error('boom');
        return { id: `org-${id}` } as OrganizationRecord;
      },
      listIncompletelyScrubbed: async () => {
        if (options.disabledAt === 'listIncompletelyScrubbed') throw disabled;
        return options.incomplete;
      },
    } as unknown as PersonalOrganizationPort;
    const service = new CustomerDeletionService(
      accounts,
      accountWrites,
      personalOrganizations,
      {} as CustomerAuthorityService,
      { destroyAllForCustomer: async () => undefined },
      {} as OrganizationDepletionGuard,
      { anonymizeForOrganization: async () => 0 },
      async () => 365,
    );
    return { service, processed, disabled };
  }

  it('#923 U-1 — runs the due accounts, then the anonymised members of incompletely scrubbed organisations, each once', async () => {
    const { service, processed } = residualHarness({
      due: ['acc-1', 'acc-2'],
      incomplete: ['org-x', 'org-y'],
      members: {
        // acc-2 is both due (an interrupted cascade) and a member of a listed organisation.
        'org-x': [
          { id: 'acc-2', anonymized: true },
          { id: 'acc-3', anonymized: true },
        ],
        'org-y': [{ id: 'acc-4', anonymized: true }],
      },
    });
    expect(await service.sweep(0, new Date())).toBe(4);
    expect(processed).toEqual(['acc-1', 'acc-2', 'acc-3', 'acc-4']);
  });

  it('#923 U-2 — a member not yet anonymised is not added, and an organisation with no member is skipped', async () => {
    const { service, processed } = residualHarness({
      due: ['acc-1'],
      incomplete: ['org-live', 'org-empty'],
      members: { 'org-live': [{ id: 'acc-live', anonymized: false }] },
    });
    expect(await service.sweep(0, new Date())).toBe(1);
    expect(processed).toEqual(['acc-1']);
  });

  it('#923 U-3 — a residual subject that fails is named in the error and does not stop the others', async () => {
    const { service, processed } = residualHarness({
      due: ['acc-1'],
      incomplete: ['org-x'],
      members: {
        'org-x': [
          { id: 'acc-3', anonymized: true },
          { id: 'acc-4', anonymized: true },
        ],
      },
      failOrgFor: 'acc-3',
    });
    const error = await service.sweep(0, new Date()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toContain('acc-3');
    expect((error as AggregateError).message).not.toContain('acc-4');
    expect(processed).toEqual(['acc-1', 'acc-3', 'acc-4']);
  });

  it.each(['listIncompletelyScrubbed', 'listByOrganization'] as const)(
    '#923 U-4 — a disabled module answering %s fails the tick closed, before any subject is processed',
    async (disabledAt) => {
      const { service, processed, disabled } = residualHarness({
        due: ['acc-1'],
        incomplete: ['org-x'],
        members: { 'org-x': [{ id: 'acc-3', anonymized: true }] },
        disabledAt,
      });
      await expect(service.sweep(0, new Date())).rejects.toBe(disabled);
      expect(processed).toEqual([]);
    },
  );
});
