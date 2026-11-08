import { describe, expect, it } from 'vitest';
import type {
  AddressServicePort,
  CustomerAccountLifecycleWritePort,
  CartAnonymizationPort,
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
 * last write: organisation, then its addresses, then the account's carts (issue
 * #920), then the account. A step that throws leaves the account on the work
 * list for the next tick, and a module that is off aborts the tick rather than
 * being counted as one account's failure. The behaviour over the real owners is
 * `backend/test/integration/customers/customer-deletion-service.test.ts`.
 */

type Step = 'org' | 'addresses' | 'retiredBook' | 'carts' | 'account';

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
  // Issue #927 — this module's own retired personal book, every row of the account.
  const retiredBook = {
    anonymizeForAccount: async (customerAccountId: string) => {
      calls.push(['retiredBook', customerAccountId]);
      fail('retiredBook');
      return 1;
    },
  };
  // Issue #920 — `carts`' step: the reasons written about the account's carts.
  const carts: CartAnonymizationPort = {
    anonymizeForCustomerAccount: async (customerAccountId: string) => {
      calls.push(['carts', customerAccountId]);
      fail('carts');
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
    carts,
  );
  return { service, calls, probed };
}

describe('CustomerDeletionService.sweep (issue #800)', () => {
  it('U-1 — runs organisation, then addresses, then the retired book, then carts, then the account, per account', async () => {
    const { service, calls } = harness();
    expect(await service.sweep(0, new Date())).toBe(2);
    expect(calls).toEqual([
      ['org', 'acc-1'],
      ['addresses', 'org-acc-1'],
      ['retiredBook', 'acc-1'],
      ['carts', 'acc-1'],
      ['account', 'acc-1'],
      ['org', 'acc-2'],
      ['addresses', 'org-acc-2'],
      ['retiredBook', 'acc-2'],
      ['carts', 'acc-2'],
      ['account', 'acc-2'],
    ]);
  });

  it.each<Step>(['org', 'addresses', 'retiredBook', 'carts'])(
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
      // Issue #927 — the retired personal book; these harnesses seed no row of it.
      { anonymizeForAccount: async () => 0 },
      // Issue #920 — `carts`' step; these harnesses seed no cart.
      { anonymizeForCustomerAccount: async () => 0 },
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

describe('CustomerDeletionService.hasDue (issue #857)', () => {
  it('U-4 — asks the owner of the table about the same cutoff the sweep lists by', async () => {
    const { service, calls, probed } = harness();
    const now = new Date('2026-11-07T12:00:00.000Z');
    expect(await service.hasDue(30, now)).toBe(true);
    expect(probed).toEqual([retentionCutoff(30, now)]);
    // A question, not a pass.
    expect(calls).toEqual([]);
  });

  /**
   * Issue #923 — the sweep's work list also holds the members of personal
   * organisations an earlier rule left incompletely scrubbed, so the question
   * asks `organizations` too: an account-side "no" must not skip a tick that
   * has organisation-side residue to finish. A question that cannot be
   * answered counts as yes; a module that is off is re-thrown, as the sweep
   * itself would.
   */
  function probeHarness(options: { accountsDue: boolean; orgs: boolean | Error }) {
    const asked: string[] = [];
    const accountWrites = {
      hasDueForAnonymization: async () => {
        asked.push('accounts');
        return options.accountsDue;
      },
    } as unknown as CustomerAccountLifecycleWritePort;
    const personalOrganizations = {
      hasIncompletelyScrubbed: async () => {
        asked.push('organizations');
        if (options.orgs instanceof Error) throw options.orgs;
        return options.orgs;
      },
    } as unknown as PersonalOrganizationPort;
    const service = new CustomerDeletionService(
      {} as CustomerAccountReadPort,
      accountWrites,
      personalOrganizations,
      {} as CustomerAuthorityService,
      { destroyAllForCustomer: async () => undefined },
      {} as OrganizationDepletionGuard,
      { anonymizeForOrganization: async () => 0 },
      async () => 365,
      // Issue #927 — the retired personal book; these harnesses seed no row of it.
      { anonymizeForAccount: async () => 0 },
      // Issue #920 — `carts`' step; these harnesses seed no cart.
      { anonymizeForCustomerAccount: async () => 0 },
    );
    return { service, asked };
  }

  it('#923 U-5 — answers yes when no account is due but an organisation is incompletely scrubbed', async () => {
    const { service, asked } = probeHarness({ accountsDue: false, orgs: true });
    expect(await service.hasDue(30, new Date())).toBe(true);
    expect(asked).toEqual(['accounts', 'organizations']);
  });

  it('#923 U-6 — answers no only when both sides have nothing', async () => {
    const { service } = probeHarness({ accountsDue: false, orgs: false });
    expect(await service.hasDue(30, new Date())).toBe(false);
  });

  it('#923 U-7 — an account due is enough; organisations are not asked', async () => {
    const { service, asked } = probeHarness({ accountsDue: true, orgs: false });
    expect(await service.hasDue(30, new Date())).toBe(true);
    expect(asked).toEqual(['accounts']);
  });

  it('#923 U-8 — an organisation-side question that fails counts as yes (fails open)', async () => {
    const { service } = probeHarness({ accountsDue: false, orgs: new Error('connection reset') });
    expect(await service.hasDue(30, new Date())).toBe(true);
  });

  it('#923 U-9 — organizations switched off is re-thrown, not taken for an answer', async () => {
    const disabled = new ModuleDisabledError('organizations');
    const { service } = probeHarness({ accountsDue: false, orgs: disabled });
    await expect(service.hasDue(30, new Date())).rejects.toBe(disabled);
  });
});
