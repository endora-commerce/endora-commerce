import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { ORGANIZATION_FIELD_SET, type CustomerAccountRecord, type FieldOverride } from '@endora-commerce/contracts';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import { CommandHookRegistry, FormRegistry } from '@endora-commerce/platform/composition';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';

import { manifest } from '../../../../packages/modules/organizations/src/manifest.js';
import { makeConvertToCompanyCommand } from '../../../../packages/modules/organizations/src/backend/commands/convert-to-company.command.js';
import { makeCreateOrganizationCommand } from '../../../../packages/modules/organizations/src/backend/commands/create-organization.command.js';
import { makeRegisterOrganizationCommand } from '../../../../packages/modules/organizations/src/backend/commands/register-organization.command.js';
import type { Organization } from '../../../../packages/modules/organizations/src/backend/entities/organization.entity.js';
import { organizationFieldSetRegistration } from '../../../../packages/modules/organizations/src/backend/forms/organization-field-set.js';

/**
 * `specs/193-admin-form-extensions/` T088, WP-E1 half (D-300.3, D-300.10,
 * issue #2027): a deployment tightens a rule on the organization field set.
 * An operator's create is bound by it; the storefront self-registration, which
 * runs under the anonymous `system` actor, is skipped because
 * `organization.register` declares `buyerSelfService: true` — and only
 * because it does, and only because `organizations` lists the action in its
 * manifest.
 *
 * Composed the way `composeModules` composes it: `organizations`' real field
 * set, writer registration, hookable actions and buyer self-service actions,
 * and a deployment override, sealed into a `FormRegistry` that the command-hook
 * registry consults on the real `CommandBus`. Each Command is `organizations`'
 * own — its action, its hook data, its flag — with `run` replaced by a stand-in
 * answering the record, because the subject is the bus and the check, not the
 * write, which needs a database.
 */

const ORG_ID = '00000000-0000-4000-8000-000000193f01';
const CHANNEL = '00000000-0000-4000-8000-000000193f02';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000193f03';

/** The deployment allows VAT payers only. */
const OVERRIDE: FieldOverride = {
  target: 'organization.vatStatus',
  validation: { options: ['vat_payer'] },
  reason: 'This deployment trades with VAT payers only.',
};

/** …and caps a name at its ERP's length (D-300.26). */
const NAME_OVERRIDE: FieldOverride = {
  target: 'organization.name',
  validation: { maxLength: 20 },
  reason: 'The ERP holds 20 characters of a name.',
};

function organization(vatStatus: string, name = 'Acme'): Organization {
  return {
    id: ORG_ID,
    name,
    legalName: null,
    taxId: 'PL5260001246',
    status: 'active',
    vatStatus,
    isPersonal: false,
    customerGroupId: null,
    registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    orderConfirmationEmails: [],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    parentId: null,
    path: `/${ORG_ID}/`,
    version: 1,
    customFieldValues: {},
    createdAt: new Date('2026-11-28T00:00:00Z'),
    updatedAt: new Date('2026-11-28T00:00:00Z'),
    deletedAt: null,
  } as unknown as Organization;
}

function harness(options: { readonly buyerSelfServiceActions?: readonly string[] } = {}) {
  const committed: string[] = [];
  let pending: string[] = [];
  const em = {
    async transactional<T>(cb: (inner: EntityManager) => Promise<T>): Promise<T> {
      pending = [];
      const result = await cb(em as unknown as EntityManager);
      committed.push(...pending);
      return result;
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, entry: { action: string }) {
      pending.push(entry.action);
      return {} as never;
    },
  } as unknown as AuditPort;
  const hookableActions = (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'organizations', ...declaration }));
  const moduleDependencies = { organizations: [], acme: ['organizations'] };

  const forms = new FormRegistry();
  forms.registerFieldSets('organizations', [organizationFieldSetRegistration]);
  forms.seal({
    fieldSets: [{ moduleId: 'organizations', set: ORGANIZATION_FIELD_SET }],
    adminForms: (manifest.adminForms ?? []).map((form) => ({ moduleId: 'organizations', form })),
    formOverrides: [
      { moduleId: 'acme', override: OVERRIDE },
      { moduleId: 'acme', override: NAME_OVERRIDE },
    ],
    inputControls: [],
    hookableActions,
    moduleDependencies,
    permissionCodes: (manifest.permissions ?? []).map((permission) => permission.code),
    origins: { organizations: 'core', acme: 'deployment' },
    installedPackageNames: {},
  });
  const hooks = new CommandHookRegistry();
  hooks.seal({
    hookableActions,
    moduleDependencies,
    commandHookOrder: {},
    buyerSelfServiceActions: (options.buyerSelfServiceActions ?? manifest.buyerSelfServiceActions ?? []).map((action) => ({
      moduleId: 'organizations',
      action,
    })),
  });
  hooks.useFieldRuleCheck(forms);
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks });
  return { bus, committed };
}

/** `organizations`' Command, with `run` answering `result` and writing nothing. */
function standIn<T>(command: Command<T>, result: T): Command<T> {
  return { ...command, run: async () => ({ result, before: null, after: { status: 'active' } }) };
}

const account: Command<CustomerAccountRecord> = {
  action: 'customer_account.create',
  objectType: 'customer_account',
  objectId: ACCOUNT_ID,
  run: async () => ({ result: { id: ACCOUNT_ID } as CustomerAccountRecord }),
};

function register(vatStatus: 'vat_payer' | 'vat_exempt') {
  const command = makeRegisterOrganizationCommand(
    { events: { emit: () => undefined } as never },
    {
      request: { organization: { name: 'Acme', taxId: 'PL5260001246', vatStatus } } as never,
      taxId: 'PL5260001246',
      salesChannelId: CHANNEL,
      customFieldValues: { organization: {}, customer: {} },
      lookupRow: null,
      account: { command: () => account } as never,
    },
  );
  return standIn(command, { organization: organization(vatStatus), customerAccount: { id: ACCOUNT_ID } as CustomerAccountRecord, verificationToken: 'token' });
}

function create(vatStatus: 'vat_payer' | 'vat_exempt') {
  const command = makeCreateOrganizationCommand(
    { membership: { replaceChannelsForEntity: async () => ({}) as never } },
    {
      name: 'Acme',
      taxId: 'PL5260001246',
      registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
      status: 'active',
      vatStatus,
      salesChannelIds: [CHANNEL],
    },
  );
  return standIn(command, organization(vatStatus));
}

const anonymous: TenantContext = { mode: 'system', actor: { kind: 'system' } };
const operator: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
const as = <T>(tenant: TenantContext, fn: () => Promise<T>): Promise<T> => runWithTenantContext(tenant, fn);

async function refusal(run: Promise<unknown>): Promise<{ statusCode?: number; code?: string; details?: unknown }> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the write was expected to be refused').not.toBeNull();
  return error as { statusCode?: number; code?: string; details?: unknown };
}

describe('a tightened organization rule and the buyer self-registration (T088, D-300.10)', () => {
  it('binds an operator create', async () => {
    const h = harness();
    const error = await refusal(as(operator, () => h.bus.run(create('vat_exempt'))));
    expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
    expect(error.details).toEqual([expect.objectContaining({ path: 'vatStatus', code: 'not_an_option' })]);
    expect(h.committed).toEqual([]);
  });

  it('lets a create that satisfies the rule through', async () => {
    const h = harness();
    await as(operator, () => h.bus.run(create('vat_payer')));
    expect(h.committed).toEqual(['organization.create']);
  });

  it('binds an anonymous system write that is not declared buyer self-service (fail closed)', async () => {
    const h = harness();
    const error = await refusal(as(anonymous, () => h.bus.run(create('vat_exempt'))));
    expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
  });

  it('skips the storefront self-registration, which runs as the anonymous system actor', async () => {
    const h = harness();
    await as(anonymous, () => h.bus.run(register('vat_exempt')));
    expect(h.committed).toEqual(['organization.register']);
  });

  it('ignores the flag under an operator: a registration Command an admin runs is bound', async () => {
    const h = harness();
    const error = await refusal(as(operator, () => h.bus.run(register('vat_exempt'))));
    expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
  });

  it('refuses the flag outright where the manifest does not list the action', async () => {
    const h = harness({ buyerSelfServiceActions: [] });
    const error = await refusal(as(anonymous, () => h.bus.run(register('vat_payer'))));
    expect((error as Error).name).toBe('UndeclaredBuyerSelfServiceActionError');
    expect(h.committed).toEqual([]);
  });
});

/** `organization.convert_to_company`, run as an operator: the run stands in for the write and names what it changed. */
function convert(name: string) {
  const command = makeConvertToCompanyCommand(
    { accounts: { listByOrganization: async () => [] } },
    {
      organizationId: ORG_ID,
      input: {
        name,
        taxId: 'PL5260001246',
        registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
        vatStatus: 'vat_payer',
      },
    },
  );
  // The real run sets `changedFields` before the hooks; the stand-in does what it would.
  return {
    ...command,
    hookData: (org: Organization) => ({ ...(command.hookData!(org) as object), changedFields: ['isPersonal', 'name', 'registeredAddress', 'taxId'] }),
    run: async () => ({ result: organization('vat_payer', name), before: null, after: { status: 'active' } }),
  } as Command<Organization>;
}

describe('a tightened name rule and the personal → company conversion (D-300.26)', () => {
  it('refuses a conversion whose name breaks the rule', async () => {
    const h = harness();
    const error = await refusal(as(operator, () => h.bus.run(convert('A company name far beyond twenty characters'))));
    expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
    expect(error.details).toEqual([expect.objectContaining({ path: 'name', code: 'too_long' })]);
    expect(h.committed).toEqual([]);
  });

  it('lets a conversion whose name keeps the rule through', async () => {
    const h = harness();
    await as(operator, () => h.bus.run(convert('Acme Sp. z o.o.')));
    expect(h.committed).toEqual(['organization.convert_to_company']);
  });
});
