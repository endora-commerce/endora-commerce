import { describe, expect, it } from 'vitest';
import {
  ADDRESS_AUDIT_KEEP_KEYS,
  CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS,
  CUSTOMER_ADDRESS_AUDIT_KEEP_KEYS,
  ORGANIZATION_AUDIT_KEEP_KEYS,
  type AddressServicePort,
  type CartAnonymizationPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type EmailDeliveryAnonymizationPort,
  type OrganizationRecord,
  type PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError, type AuditRedactionInput } from '@endora-commerce/platform/kernel';
import {
  CustomerDeletionService,
  retentionCutoff,
  type AnonymizedHistoryDeps,
} from './customer-deletion-service.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type { OrganizationDepletionGuard } from './organization-depletion-guard.js';

/**
 * Issue #800 — the order of the anonymisation sweep, without a database.
 *
 * The account's `anonymizedAt` is the cascade's commit marker, so it is the
 * last write: organisation, then its addresses, then the account's carts (issue
 * #920), then the delivery records of the e-mails sent to it (issue #928), then
 * the account. A step that throws leaves the account on the work
 * list for the next tick, and a module that is off aborts the tick rather than
 * being counted as one account's failure. The behaviour over the real owners is
 * `backend/test/integration/customers/customer-deletion-service.test.ts`.
 */

type Step = 'org' | 'addresses' | 'retiredBook' | 'carts' | 'emailDeliveries' | 'account';

/** Step 3 (issue #844) with no history to name: the cases below are about the other steps. */
const NO_HISTORY: AnonymizedHistoryDeps = {
  redaction: { redact: async () => ({ rowsInScope: 0, rowsChanged: 0, markerWritten: true }) },
  addressReads: { listIdsForOrganization: async () => [] },
  retiredAddressBook: { listIdsForAccount: async () => [] },
};

function harness(failAt: { step: Step; error: Error } | null = null) {
  const calls: Array<[Step, string]> = [];
  const due = ['acc-1', 'acc-2'].map(
    (id) => ({ id, organizationId: `org-${id}`, email: `${id}@example.test`, anonymizedAt: null }) as unknown as CustomerAccountRecord,
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
  // Issue #928 — `email`'s step: the delivery records of the e-mails sent to the account.
  const emailDeliveries: EmailDeliveryAnonymizationPort = {
    anonymizeForRecipient: async (recipient: string) => {
      calls.push(['emailDeliveries', recipient]);
      fail('emailDeliveries');
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
    emailDeliveries,
    NO_HISTORY,
  );
  return { service, calls, probed };
}

describe('CustomerDeletionService.sweep (issue #800)', () => {
  it('U-1 — runs organisation, then addresses, then the retired book, then carts, then e-mail deliveries, then the account, per account', async () => {
    const { service, calls } = harness();
    expect(await service.sweep(0, new Date())).toBe(2);
    expect(calls).toEqual([
      ['org', 'acc-1'],
      ['addresses', 'org-acc-1'],
      ['retiredBook', 'acc-1'],
      ['carts', 'acc-1'],
      ['emailDeliveries', 'acc-1@example.test'],
      ['account', 'acc-1'],
      ['org', 'acc-2'],
      ['addresses', 'org-acc-2'],
      ['retiredBook', 'acc-2'],
      ['carts', 'acc-2'],
      ['emailDeliveries', 'acc-2@example.test'],
      ['account', 'acc-2'],
    ]);
  });

  it.each<Step>(['org', 'addresses', 'retiredBook', 'carts', 'emailDeliveries'])(
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
    const emailed: string[] = [];
    const disabled = new ModuleDisabledError('organizations');
    // The account's own marker once anonymised, as `customer_accounts` writes it.
    const record = (id: string, organizationId: string, anonymizedAt: Date | null) =>
      ({
        id,
        organizationId,
        anonymizedAt,
        email: anonymizedAt ? `deleted+${id}@anonymized.invalid` : `${id}@example.test`,
      }) as unknown as CustomerAccountRecord;
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
      // Issue #928 — `email`'s step.
      {
        anonymizeForRecipient: async (recipient: string) => {
          emailed.push(recipient);
          return 0;
        },
      },
      NO_HISTORY,
    );
    return { service, processed, emailed, disabled };
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

  it('#928 U-1 — the e-mail step is handed the address of a subject not yet anonymised, and never the marker of one that is', async () => {
    const { service, emailed } = residualHarness({
      due: ['acc-1'],
      incomplete: ['org-x'],
      members: { 'org-x': [{ id: 'acc-3', anonymized: true }] },
    });
    expect(await service.sweep(0, new Date())).toBe(2);
    // acc-3's address is already `deleted+acc-3@anonymized.invalid`: no delivery
    // was ever sent there, and the one it had is gone with the account's scrub.
    expect(emailed).toEqual(['acc-1@example.test']);
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
      // Issue #928 — `email`'s step; a question runs no step.
      { anonymizeForRecipient: async () => 0 },
      NO_HISTORY,
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

/**
 * Issue #844 — step 3 of the cascade: the subject's audit history is erased
 * through the platform's `auditRedactionService`, after its organisation and
 * addresses are scrubbed and **before** the account step, so `anonymizedAt`
 * stays the one fact that says the subject is finished. A throw at step 3
 * leaves the account due, and the next tick finishes it.
 */
describe("CustomerDeletionService.sweep — the subject's audit history (issue #844)", () => {
  const ACCOUNT = '00000000-0000-4000-8000-000000844001';
  const PERSONAL_ORG = '00000000-0000-4000-8000-000000844002';
  const ADDRESS_LIVE = '00000000-0000-4000-8000-000000844003';
  const ADDRESS_DELETED = '00000000-0000-4000-8000-000000844004';
  const LEGACY_ADDRESS = '00000000-0000-4000-8000-000000844005';

  function historyHarness(options: {
    personal: boolean;
    addressIds?: string[];
    legacyIds?: string[];
    redactFails?: Error;
  }) {
    const calls: string[] = [];
    const redactions: AuditRedactionInput[] = [];
    const addressQueries: Array<[string, { includeDeleted?: boolean } | undefined]> = [];
    const record = {
      id: ACCOUNT,
      organizationId: PERSONAL_ORG,
      email: 'subject@example.test',
      anonymizedAt: null,
    } as unknown as CustomerAccountRecord;
    const accountWrites = {
      listDueForAnonymization: async () => [record],
      anonymize: async () => {
        calls.push('account');
        return record;
      },
    } as unknown as CustomerAccountLifecycleWritePort;
    const personalOrganizations = {
      anonymizeIfOrphaned: async () => {
        calls.push('org');
        return options.personal ? ({ id: PERSONAL_ORG } as OrganizationRecord) : null;
      },
      listIncompletelyScrubbed: async () => [],
    } as unknown as PersonalOrganizationPort;
    const history: AnonymizedHistoryDeps = {
      redaction: {
        redact: async (input) => {
          calls.push('redact');
          redactions.push(input);
          if (options.redactFails) throw options.redactFails;
          return { rowsInScope: 1, rowsChanged: 1, markerWritten: true };
        },
      },
      addressReads: {
        listIdsForOrganization: async (organizationId, query) => {
          addressQueries.push([organizationId, query]);
          return options.addressIds ?? [];
        },
      },
      retiredAddressBook: { listIdsForAccount: async () => options.legacyIds ?? [] },
    };
    const service = new CustomerDeletionService(
      {} as CustomerAccountReadPort,
      accountWrites,
      personalOrganizations,
      {} as CustomerAuthorityService,
      { destroyAllForCustomer: async () => undefined },
      {} as OrganizationDepletionGuard,
      {
        anonymizeForOrganization: async () => {
          calls.push('addresses');
          return 0;
        },
      },
      async () => 365,
      {
        anonymizeForAccount: async () => {
          calls.push('retiredBook');
          return 0;
        },
      },
      {
        anonymizeForCustomerAccount: async () => {
          calls.push('carts');
          return 0;
        },
      },
      {
        anonymizeForRecipient: async () => {
          calls.push('emailDeliveries');
          return 0;
        },
      },
      history,
    );
    return { service, calls, redactions, addressQueries };
  }

  it('U-844-1 — redacts after every other scrub, and before the account', async () => {
    const { service, calls } = historyHarness({ personal: true });
    expect(await service.sweep(0, new Date())).toBe(1);
    expect(calls).toEqual(['org', 'addresses', 'retiredBook', 'carts', 'emailDeliveries', 'redact', 'account']);
  });

  it('U-844-2 — a personal subject names its account, organisation, every address (deleted ones too) and its retired book', async () => {
    const { service, redactions, addressQueries } = historyHarness({
      personal: true,
      addressIds: [ADDRESS_LIVE, ADDRESS_DELETED],
      legacyIds: [LEGACY_ADDRESS],
    });
    await service.sweep(0, new Date());
    expect(addressQueries).toEqual([[PERSONAL_ORG, { includeDeleted: true }]]);
    expect(redactions).toEqual([
      {
        reason: 'anonymization',
        subject: { objectType: 'customer_account', objectId: ACCOUNT },
        // Owner ruling on #844: the IP and user agent of the rows it wrote itself.
        subjectActorAccountId: ACCOUNT,
        targets: [
          { objectType: 'customer_account', objectIds: [ACCOUNT], keepKeys: CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS },
          { objectType: 'organization', objectIds: [PERSONAL_ORG], keepKeys: ORGANIZATION_AUDIT_KEEP_KEYS },
          { objectType: 'address', objectIds: [ADDRESS_LIVE, ADDRESS_DELETED], keepKeys: ADDRESS_AUDIT_KEEP_KEYS },
          { objectType: 'customer_address', objectIds: [LEGACY_ADDRESS], keepKeys: CUSTOMER_ADDRESS_AUDIT_KEEP_KEYS },
        ],
      },
    ]);
  });

  it('U-844-2 — a company member names only its own account, and an empty target is left out', async () => {
    const { service, redactions, addressQueries } = historyHarness({ personal: false });
    await service.sweep(0, new Date());
    // The company organisation and its book are not the subject's: never asked for.
    expect(addressQueries).toEqual([]);
    expect(redactions.map((r) => r.targets)).toEqual([
      [{ objectType: 'customer_account', objectIds: [ACCOUNT], keepKeys: CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS }],
    ]);
  });

  it('U-844-3 — a failed redaction leaves the account un-anonymised, named in the error, for the next tick', async () => {
    const { service, calls } = historyHarness({ personal: true, redactFails: new Error('boom') });
    const error = await service.sweep(0, new Date()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toContain(ACCOUNT);
    expect(calls).toEqual(['org', 'addresses', 'retiredBook', 'carts', 'emailDeliveries', 'redact']);
  });
});
