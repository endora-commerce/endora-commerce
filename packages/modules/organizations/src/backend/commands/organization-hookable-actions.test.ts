/**
 * `organizations`' six hookable actions (`specs/176-command-hooks-outbox/`
 * T028, FR-024, `contracts/organization-hookable-actions.md`; issue #1057 for
 * `organization.convert_to_company` and `organization.tax_id.change`).
 *
 * Each Command is held to its ref with `expectHookableCommand`, and each is run
 * on a real `CommandBus` with a sealed hook registry, so what is checked is what
 * a hook author's handler is handed: the owner's declared data on the
 * Command's own transaction, its module's extension slice, and a names-only
 * audit entry the noted changes merge into (`specs/conventions/audit-state.md`,
 * owner ruling O-2).
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  ORGANIZATION_HOOKABLE_ACTIONS as ORG,
  type CustomerAccountRecord,
  type OrganizationConvertToCompanyHookData,
  type OrganizationCreateHookData,
  type OrganizationTaxIdChangeHookData,
  type OrganizationUpdateHookData,
} from '@endora-commerce/contracts';
import { CommandBus, type Command, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { Organization as OrganizationEntity } from '../entities/organization.entity.js';
import type { Organization } from '../entities/organization.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { ORGANIZATION_AUDIT_KEYS } from '../services/organization-audit-state.js';
import { OrganizationCommandService } from '../services/organization-command-port.js';
import { OrganizationCustomFieldWriteService } from '../services/organization-custom-field-write-port.js';
import { makeAdminPatchOrganizationCommand } from './admin-patch-organization.command.js';
import { makeChangeTaxIdCommand } from './change-tax-id.command.js';
import { makeConvertToCompanyCommand } from './convert-to-company.command.js';
import { makeCreateOrganizationCommand } from './create-organization.command.js';
import { makeRegisterOrganizationCommand } from './register-organization.command.js';
import { makeSetCustomFieldValuesCommand } from './set-custom-field-values.command.js';

const ORG_ID = '00000000-0000-4000-8000-000000176b01';
const CHANNEL_A = '00000000-0000-4000-8000-000000176b02';
const CHANNEL_B = '00000000-0000-4000-8000-000000176b03';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000176b04';

function organization(): Organization {
  return {
    id: ORG_ID,
    name: 'S176-NAME',
    legalName: null,
    taxId: 'S176TAXID',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: 'S176-STREET', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    orderConfirmationEmails: [],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: null,
    path: `/${ORG_ID}/`,
    version: 1,
    customFieldValues: { tier: 'S176-CF' },
    createdAt: new Date('2026-11-12T00:00:00Z'),
    updatedAt: new Date('2026-11-12T00:00:00Z'),
    deletedAt: null,
  } as unknown as Organization;
}

/** A fake EM good enough for the four Commands: one stored Organization, creates kept in memory. */
function harness(hooks: ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }>) {
  const stored = organization();
  const audits: Array<Record<string, unknown>> = [];
  const em: Record<string, unknown> = {
    findOne: async (_entity: unknown, where: { id?: string }) => (where.id === ORG_ID ? stored : { id: 'role-1' }),
    execute: async () => [],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => fn(em as unknown as EntityManager);
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      audits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'organizations', ...declaration })),
    moduleDependencies: { acme_erp: ['organizations'] },
    hooks,
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  return { bus, audits, stored, em: em as unknown as EntityManager };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('organizations unit test: hookable actions', fn);

/** Every top-level key, and every key under `extensions.<module>`, is a name the module allows. */
function expectNamesOnly(entries: ReadonlyArray<Record<string, unknown>>): void {
  for (const entry of entries) {
    const after = (entry['stateAfter'] ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(after)) expect(ORGANIZATION_AUDIT_KEYS.has(key), key).toBe(true);
    for (const slice of Object.values((after['extensions'] ?? {}) as Record<string, Record<string, unknown>>)) {
      for (const key of Object.keys(slice)) expect(ORGANIZATION_AUDIT_KEYS.has(key), `extensions.*.${key}`).toBe(true);
    }
    expect(JSON.stringify(entry['stateAfter'])).not.toMatch(/S176-/);
  }
}

describe('organizations declares six hookable actions (176 T028, FR-024; #1057)', () => {
  it('lists the six refs in its manifest, for both phases', () => {
    expect(manifest.hookableActions).toEqual(
      [ORG.create, ORG.register, ORG.adminPatch, ORG.setCustomFieldValues, ORG.convertToCompany, ORG.changeTaxId].map((ref) => ({
        action: ref.action,
        objectType: ref.objectType,
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });
});

describe('organization.create is hookable', () => {
  const input = {
    name: 'S176-NAME',
    taxId: 'S176TAXID',
    status: 'active' as const,
    registeredAddress: { street: 'S176-STREET', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    salesChannelIds: [CHANNEL_B, CHANNEL_A, CHANNEL_B],
  };
  const deps = { membership: { replaceChannelsForEntity: async () => undefined } as never };

  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(makeCreateOrganizationCommand(deps, input as never), ORG.create, {
      result: organization(),
      sentinels: ['S176-'],
    });
  });

  it("hands a hook the uncommitted record and the channels, and merges its noted names into the one entry", async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      {
        moduleId: 'acme_erp',
        entries: [recording.on(ORG.create, { then: (ctx) => ctx.noteAuditChanges(['x_acme_erp_code']) })],
      },
    ]);

    await asSystem(() =>
      h.bus.run(makeCreateOrganizationCommand(deps, input as never, { extensions: { acme_erp: { code: 'E-1' } } })),
    );

    expect(recording.calls).toHaveLength(1);
    const data = recording.calls[0]!.data as OrganizationCreateHookData;
    expect(data.organization).toMatchObject({ name: 'S176-NAME', status: 'active' });
    expect(data.salesChannelIds).toEqual([CHANNEL_A, CHANNEL_B]);
    expect(recording.calls[0]!.extension).toEqual({ code: 'E-1' });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!['stateAfter']).toMatchObject({ extensions: { acme_erp: { changedFields: ['x_acme_erp_code'] } } });
    expectNamesOnly(h.audits);
  });
});

describe('organization.register is hookable', () => {
  const account: Command<CustomerAccountRecord> = {
    action: 'customer_account.create',
    objectType: 'customer_account',
    objectId: ACCOUNT_ID,
    run: async () => ({ result: { id: ACCOUNT_ID } as CustomerAccountRecord, after: { changedFields: ['email'] } }),
  };
  const input = {
    request: {
      organization: {
        name: 'S176-NAME',
        taxId: 'S176TAXID',
        registeredAddress: { street: 'S176-STREET', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
      },
    },
    taxId: 'S176TAXID',
    salesChannelId: CHANNEL_A,
    customFieldValues: { organization: {}, customer: {} },
    lookupRow: null,
    account: { command: () => account },
  };
  const deps = { events: { emit: () => undefined } as never };

  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(makeRegisterOrganizationCommand(deps, input as never), ORG.register, {
      result: {
        organization: organization(),
        customerAccount: { id: ACCOUNT_ID } as CustomerAccountRecord,
        verificationToken: 'S176-TOKEN',
      },
      sentinels: ['S176-'],
    });
  });

  it('hands a hook the new record, the first account and the channel — never the verification token', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(ORG.register)] }]);

    await asSystem(() => h.bus.run(makeRegisterOrganizationCommand(deps, input as never)));

    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.data).toMatchObject({
      organization: { name: 'S176-NAME', status: 'pending_verification' },
      customerAccountId: ACCOUNT_ID,
      salesChannelId: CHANNEL_A,
      registryLookupOutcome: null,
    });
    expect(JSON.stringify(recording.calls[0]!.data)).not.toContain('verificationToken');
    expect(h.audits.map((entry) => entry['action'])).toEqual(['customer_account.create', 'organization.register']);
    expectNamesOnly(h.audits);
  });
});

describe('organization.admin_patch is hookable', () => {
  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(
      makeAdminPatchOrganizationCommand({ organizationId: ORG_ID, changes: {}, assertCurrent: () => undefined }),
      ORG.adminPatch,
    );
  });

  it('hands a hook the after-state and the names of what changed', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(ORG.adminPatch)] }]);

    await asSystem(() =>
      h.bus.run(
        makeAdminPatchOrganizationCommand({
          organizationId: ORG_ID,
          changes: { name: 'S176-RENAMED', status: 'blocked' },
          assertCurrent: () => undefined,
          mergeCustomFieldValues: async (current) => ({ ...current, tier: 'S176-CF-NEW' }),
          extensions: { acme_erp: { code: 'E-2' } },
        }),
      ),
    );

    const data = recording.calls[0]!.data as OrganizationUpdateHookData;
    expect(data.organization).toMatchObject({ name: 'S176-RENAMED', status: 'blocked' });
    expect(data.changedFields).toEqual(['name', 'status']);
    expect(data.changedCustomFields).toEqual(['tier']);
    expect(recording.calls[0]!.extension).toEqual({ code: 'E-2' });
    expectNamesOnly(h.audits);
  });
});

describe('organization.set_custom_field_values is hookable', () => {
  it('supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(
      makeSetCustomFieldValuesCommand({ organizationId: ORG_ID, merge: async (current) => current }),
      ORG.setCustomFieldValues,
    );
  });

  it('hands a hook the after-state and the custom-field keys that changed', async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(ORG.setCustomFieldValues)] }]);

    await asSystem(() =>
      h.bus.run(
        makeSetCustomFieldValuesCommand({
          organizationId: ORG_ID,
          merge: async (current) => ({ ...current, region: 'S176-CF-REGION' }),
        }),
      ),
    );

    const data = recording.calls[0]!.data as OrganizationUpdateHookData;
    expect(data.changedFields).toEqual([]);
    expect(data.changedCustomFields).toEqual(['region']);
    expectNamesOnly(h.audits);
  });
});

describe('organizationCustomFieldWritePort forwards extension input (architect ruling on #1055, Q2)', () => {
  it("hands a claimed key to its module's hook through the port", async () => {
    const recording = recordingCommandHooks();
    const h = harness([{ moduleId: 'acme_erp', entries: [recording.on(ORG.setCustomFieldValues)] }]);
    const port = new OrganizationCustomFieldWriteService(h.bus as never);

    await asSystem(() =>
      port.setCustomFieldValues(ORG_ID, async (current) => ({ ...current, region: 'S176-CF-REGION' }), {
        extensions: { acme_erp: { code: 'E-3' } },
      }),
    );

    expect(recording.calls.map((call) => call.extension)).toEqual([{ code: 'E-3' }]);
  });

  it('answers 422 COMMAND_EXTENSION_UNCLAIMED for a key no present hook module claims, before the merge runs', async () => {
    const h = harness([{ moduleId: 'acme_erp', entries: [recordingCommandHooks().on(ORG.setCustomFieldValues)] }]);
    const port = new OrganizationCustomFieldWriteService(h.bus as never);
    let merged = false;

    const err = await asSystem(() =>
      port.setCustomFieldValues(
        ORG_ID,
        async (current) => {
          merged = true;
          return current;
        },
        { extensions: { acme_typo: { code: 'x' } } },
      ),
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({
      statusCode: 422,
      code: 'COMMAND_EXTENSION_UNCLAIMED',
      details: [{ path: 'extensions.acme_typo' }],
    });
    expect(merged).toBe(false);
    expect(h.audits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Issue #1057 — the conversion and the tax-ID correction
// ---------------------------------------------------------------------------

const ADMIN_ROLE = '00000000-0000-4000-8000-000000176b05';
/** Tax IDs and names a hook must never be handed nor the audit entry carry. */
const TAX_SENTINELS = ['S176-', 'PL5260250995', 'PL1234567890', 'S1057'];

function personal(): Organization {
  return {
    ...organization(),
    name: 'S176-PERSONAL',
    taxId: null,
    isPersonal: true,
    approvedAt: null,
    personalAccountId: ACCOUNT_ID,
    vatStatus: 'vat_exempt',
  } as unknown as Organization;
}

function company(): Organization {
  return {
    ...organization(),
    taxId: 'PL5260250995',
    vatValidatedAt: new Date('2026-11-01T10:00:00Z'),
    vatValidationProvider: 'mf_pl',
    vatValidationOutcome: 'validated',
  } as unknown as Organization;
}

/**
 * A fake EM for the two tax-ID writers: the row lock answers the stored
 * Organization, the scope row answers `global`, no other holder has the tax ID,
 * the predefined Administrator role exists. `flushes` counts the writes.
 */
function taxIdHarness(
  stored: Organization,
  hooks: ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }>,
) {
  const audits: Array<Record<string, unknown>> = [];
  let flushes = 0;
  const em: Record<string, unknown> = {
    execute: async (sql: string) => {
      if (sql.includes('for update') && sql.includes('"organizations"')) return [{ id: stored.id }];
      if (sql.includes('organization_tax_id_policy')) {
        return [{ scope: 'global', updated_at: new Date(), updated_by_admin_user_id: null }];
      }
      return [];
    },
    findOne: async (entity: unknown) =>
      entity === OrganizationEntity ? stored : entity === OrganizationRole ? { id: ADMIN_ROLE } : null,
    flush: async () => {
      flushes += 1;
    },
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => fn(em as unknown as EntityManager);
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      audits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'organizations', ...declaration })),
    moduleDependencies: { acme_erp: ['organizations'] },
    hooks,
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  const accounts = { listByOrganization: async () => [{ id: ACCOUNT_ID, organizationRoleId: ADMIN_ROLE }] as never };
  return { bus, audits, accounts, stored, flushes: () => flushes };
}

const conversionInput = {
  name: 'S176-COMPANY',
  legalName: 'S176-LEGAL',
  taxId: 'pl 526-025-09-95',
  registeredAddress: { street: 'S176-STREET-2', city: 'Warsaw', postalCode: '00-002', country: 'PL' },
  vatStatus: 'vat_payer' as const,
};

/** Neither tax ID, name nor address reaches what a hook is handed. */
function expectNoValuesHanded(data: unknown): void {
  const serialised = JSON.stringify(data);
  for (const sentinel of TAX_SENTINELS) expect(serialised, sentinel).not.toContain(sentinel);
}

describe('organization.convert_to_company is hookable (#1057)', () => {
  const deps = { accounts: { listByOrganization: async () => [] } };

  it('supplies hookData and list-1 outboxData', () => {
    const converted = { ...company(), convertedToCompanyAt: new Date() } as unknown as Organization;
    const command = makeConvertToCompanyCommand(deps, { organizationId: ORG_ID, input: conversionInput });
    expectHookableCommand(command, ORG.convertToCompany, { result: converted, sentinels: TAX_SENTINELS });
    expectNoValuesHanded(command.hookData!(converted));
  });

  it('hands a hook ids, codes and the names of what changed — never the tax ID — and merges its notes', async () => {
    const recording = recordingCommandHooks();
    const h = taxIdHarness(personal(), [
      {
        moduleId: 'acme_erp',
        entries: [recording.on(ORG.convertToCompany, { then: (ctx) => ctx.noteAuditChanges(['kyc_status']) })],
      },
    ]);

    await asSystem(() =>
      h.bus.run(
        makeConvertToCompanyCommand(
          { accounts: h.accounts },
          { organizationId: ORG_ID, input: conversionInput, extensions: { acme_erp: { creditLimitCode: 'C-1' } } },
        ),
      ),
    );

    expect(recording.calls).toHaveLength(1);
    const data = recording.calls[0]!.data as OrganizationConvertToCompanyHookData;
    expect(data).toEqual({
      organizationId: ORG_ID,
      status: 'active',
      vatStatus: 'vat_payer',
      changedFields: ['isPersonal', 'legalName', 'name', 'registeredAddress', 'taxId', 'vatStatus'],
      approvalStamped: true,
    });
    expectNoValuesHanded(data);
    expect(recording.calls[0]!.extension).toEqual({ creditLimitCode: 'C-1' });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]!['stateAfter']).toMatchObject({ extensions: { acme_erp: { changedFields: ['kyc_status'] } } });
    expectNamesOnly(h.audits);
    expect(JSON.stringify(h.audits)).not.toContain('PL5260250995');
  });

  it('a veto from the hook refuses the conversion with its own error', async () => {
    const vetoed = Object.assign(new Error('KYC pending'), { statusCode: 409, code: 'ACME_KYC_PENDING' });
    const h = taxIdHarness(personal(), [
      {
        moduleId: 'acme_erp',
        entries: [recordingCommandHooks().on(ORG.convertToCompany, { then: () => { throw vetoed; } })],
      },
    ]);

    const err = await asSystem(() =>
      h.bus.run(makeConvertToCompanyCommand({ accounts: h.accounts }, { organizationId: ORG_ID, input: conversionInput })),
    ).catch((e: unknown) => e);

    expect(err).toBe(vetoed);
    expect(h.audits).toEqual([]);
  });
});

describe('organization.tax_id.change is hookable (#1057)', () => {
  it('supplies hookData and list-1 outboxData', () => {
    const command = makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } });
    const result = { organization: company(), changed: true };
    expectHookableCommand(command, ORG.changeTaxId, { result, sentinels: TAX_SENTINELS });
    expectNoValuesHanded(command.hookData!(result));
  });

  it('hands a hook the id and the changed field by name — never the old or new tax ID', async () => {
    const recording = recordingCommandHooks();
    const h = taxIdHarness(company(), [{ moduleId: 'acme_erp', entries: [recording.on(ORG.changeTaxId)] }]);

    await asSystem(() =>
      h.bus.run(
        makeChangeTaxIdCommand({
          organizationId: ORG_ID,
          input: { taxId: 'PL1234567890' },
          extensions: { acme_erp: { erpSync: true } },
        }),
      ),
    );

    expect(recording.calls).toHaveLength(1);
    const data = recording.calls[0]!.data as OrganizationTaxIdChangeHookData;
    expect(data).toEqual({ organizationId: ORG_ID, changedFields: ['taxId'], vatValidationReset: true });
    expectNoValuesHanded(data);
    expect(recording.calls[0]!.extension).toEqual({ erpSync: true });
    expect(h.audits).toHaveLength(1);
    expectNamesOnly(h.audits);
    expect(JSON.stringify(h.audits)).not.toMatch(/PL5260250995|PL1234567890/);
  });

  describe('the same value (the owner answers skipAudit)', () => {
    it("records no entry when no hook noted a write — the hook still sees an empty change", async () => {
      const recording = recordingCommandHooks();
      const h = taxIdHarness(company(), [{ moduleId: 'acme_erp', entries: [recording.on(ORG.changeTaxId)] }]);

      await asSystem(() =>
        h.bus.run(makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'pl 526-025-09-95' } })),
      );

      expect(h.flushes()).toBe(0);
      expect(recording.calls.map((call) => call.data)).toEqual([
        { organizationId: ORG_ID, changedFields: [], vatValidationReset: false },
      ]);
      expect(h.audits).toEqual([]);
    });

    it("records exactly one entry, the hook's names alone, when a hook noted a write", async () => {
      const recording = recordingCommandHooks();
      const h = taxIdHarness(company(), [
        {
          moduleId: 'acme_erp',
          entries: [recording.on(ORG.changeTaxId, { then: (ctx) => ctx.noteAuditChanges(['erp_synced_at']) })],
        },
      ]);

      await asSystem(() =>
        h.bus.run(makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL5260250995' } })),
      );

      expect(h.flushes()).toBe(0);
      expect(h.audits).toHaveLength(1);
      expect(h.audits[0]).toMatchObject({
        action: 'organization.tax_id.change',
        objectId: ORG_ID,
        stateBefore: null,
        stateAfter: { extensions: { acme_erp: { changedFields: ['erp_synced_at'] } } },
      });
      expect(Object.keys(h.audits[0]!['stateAfter'] as object)).toEqual(['extensions']);
      expectNamesOnly(h.audits);
    });
  });
});

describe('organizationCommandPort forwards extension input (#1057, as #1055 Q2 did for the custom-field port)', () => {

  it("convertToCompany hands a claimed key to its module's hook", async () => {
    const recording = recordingCommandHooks();
    const h = taxIdHarness(personal(), [{ moduleId: 'acme_erp', entries: [recording.on(ORG.convertToCompany)] }]);
    const port = new OrganizationCommandService({ commandBus: h.bus, accounts: h.accounts });

    await asSystem(() =>
      port.convertToCompany(ORG_ID, conversionInput, { extensions: { acme_erp: { creditLimitCode: 'C-2' } } }),
    );

    expect(recording.calls.map((call) => call.extension)).toEqual([{ creditLimitCode: 'C-2' }]);
  });

  it("changeTaxId hands a claimed key to its module's hook", async () => {
    const recording = recordingCommandHooks();
    const h = taxIdHarness(company(), [{ moduleId: 'acme_erp', entries: [recording.on(ORG.changeTaxId)] }]);
    const port = new OrganizationCommandService({ commandBus: h.bus, accounts: h.accounts });

    await asSystem(() => port.changeTaxId(ORG_ID, { taxId: 'PL1234567890' }, { extensions: { acme_erp: { erpSync: true } } }));

    expect(recording.calls.map((call) => call.extension)).toEqual([{ erpSync: true }]);
  });

  it.each([
    ['convertToCompany', personal, (port: OrganizationCommandService) =>
      port.convertToCompany(ORG_ID, conversionInput, { extensions: { acme_typo: { code: 'x' } } })],
    ['changeTaxId', company, (port: OrganizationCommandService) =>
      port.changeTaxId(ORG_ID, { taxId: 'PL1234567890' }, { extensions: { acme_typo: { code: 'x' } } })],
  ] as const)(
    '%s answers 422 COMMAND_EXTENSION_UNCLAIMED for a key no present hook module claims — no write, no entry',
    async (_name, seed, call) => {
      const recording = recordingCommandHooks();
      const stored = seed();
      const h = taxIdHarness(stored, [
        { moduleId: 'acme_erp', entries: [recording.on(ORG.convertToCompany), recording.on(ORG.changeTaxId)] },
      ]);
      const before = { taxId: stored.taxId, isPersonal: stored.isPersonal, name: stored.name };
      const port = new OrganizationCommandService({ commandBus: h.bus, accounts: h.accounts });

      const err = await asSystem(() => call(port)).catch((e: unknown) => e);

      expect(err).toMatchObject({
        statusCode: 422,
        code: 'COMMAND_EXTENSION_UNCLAIMED',
        details: [{ path: 'extensions.acme_typo' }],
      });
      expect(h.flushes()).toBe(0);
      expect({ taxId: stored.taxId, isPersonal: stored.isPersonal, name: stored.name }).toEqual(before);
      expect(recording.calls).toEqual([]);
      expect(h.audits).toEqual([]);
    },
  );
});
