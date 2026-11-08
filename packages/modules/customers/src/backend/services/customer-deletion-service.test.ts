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
import { CustomerDeletionService, retentionCutoff } from './customer-deletion-service.js';
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

type Step = 'org' | 'addresses' | 'retiredBook' | 'account';

function harness(failAt: { step: Step; error: Error } | null = null) {
  const calls: Array<[Step, string]> = [];
  const due = ['acc-1', 'acc-2'].map(
    (id) => ({ id, organizationId: `org-${id}` }) as unknown as CustomerAccountRecord,
  );
  const fail = (step: Step) => {
    if (failAt?.step === step) throw failAt.error;
  };
  const probed: Date[] = [];
  const accountWrites = {
    hasDueForAnonymization: async (cutoff: Date) => {
      probed.push(cutoff);
      return true;
    },
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
  } as unknown as PersonalOrganizationPort;
  const addresses: Pick<AddressServicePort, 'anonymizeForOrganization'> = {
    anonymizeForOrganization: async (organizationId: string) => {
      calls.push(['addresses', organizationId]);
      fail('addresses');
      return 1;
    },
  };
  // Issue #927 — this module's own retired personal book, every row of the account.
  const retiredBook = {
    anonymizeForAccount: async (customerAccountId: string) => {
      calls.push(['retiredBook', customerAccountId]);
      fail('retiredBook');
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
    retiredBook,
  );
  return { service, calls, probed };
}

describe('CustomerDeletionService.sweep (issue #800)', () => {
  it('U-1 — runs organisation, then addresses, then the retired book, then the account, per account', async () => {
    const { service, calls } = harness();
    expect(await service.sweep(0, new Date())).toBe(2);
    expect(calls).toEqual([
      ['org', 'acc-1'],
      ['addresses', 'org-acc-1'],
      ['retiredBook', 'acc-1'],
      ['account', 'acc-1'],
      ['org', 'acc-2'],
      ['addresses', 'org-acc-2'],
      ['retiredBook', 'acc-2'],
      ['account', 'acc-2'],
    ]);
  });

  it.each<Step>(['org', 'addresses', 'retiredBook'])(
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

describe('CustomerDeletionService.hasDue (issue #857)', () => {
  it('U-4 — asks the owner of the table about the same cutoff the sweep lists by', async () => {
    const { service, calls, probed } = harness();
    const now = new Date('2026-11-07T12:00:00.000Z');
    expect(await service.hasDue(30, now)).toBe(true);
    expect(probed).toEqual([retentionCutoff(30, now)]);
    // A question, not a pass.
    expect(calls).toEqual([]);
  });
});
