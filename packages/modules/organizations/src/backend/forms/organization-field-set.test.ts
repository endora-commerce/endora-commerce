/**
 * `specs/193-admin-form-extensions/` WP-E1, T042 (FR-003, FR-041, FR-081,
 * I-5; `contracts/field-rules.md` §2, `form-field-declaration.md` §4).
 *
 * The organization field set agrees with the admin create and update bodies,
 * and every writer `organizations` registers with `ctx.fieldSets` is proven by
 * its own Command: the Command is that action's, supplies hook data, and the
 * writer's projection of that hook data returns every key it claims to write.
 * `organization.register` is a writer too — it is proven here like the others,
 * and the field-rule check skips it for a buyer (D-300.3, D-300.10).
 */
import { describe, expect, it } from 'vitest';
import {
  AdminOrganizationCreateBodySchema,
  ORGANIZATION_FIELD_SET,
  ORGANIZATION_FORMS,
  ORGANIZATION_HOOKABLE_ACTIONS,
  adminPatchOrganizationRequestSchema,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { expectFieldSetMatchesSchemas, expectFieldSetWriters } from '@endora-commerce/test-kit/forms';
import { manifest } from '../../manifest.js';
import { makeAdminPatchOrganizationCommand } from '../commands/admin-patch-organization.command.js';
import { makeConvertToCompanyCommand } from '../commands/convert-to-company.command.js';
import { makeCreateOrganizationCommand } from '../commands/create-organization.command.js';
import { makeRegisterOrganizationCommand } from '../commands/register-organization.command.js';
import { makeSetCustomFieldValuesCommand } from '../commands/set-custom-field-values.command.js';
import { makeMergeFinalizeCommand } from '../commands/merge-finalize.command.js';
import { makeMergeStartCommand } from '../commands/merge-start.command.js';
import { makeProvisionPersonalOrganizationCommand } from '../commands/provision-personal-organization.command.js';
import { makeUpdateOrganizationCommand } from '../commands/update-organization.command.js';
import type { Organization } from '../entities/organization.entity.js';
import { ORGANIZATION_UPDATE_RULE_CHECK, organizationFieldSetRegistration } from './organization-field-set.js';

const ORG_ID = '00000000-0000-4000-8000-000000193e01';
const CHANNEL = '00000000-0000-4000-8000-000000193e02';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000193e03';

function organization(): Organization {
  return {
    id: ORG_ID,
    name: 'Acme',
    legalName: null,
    taxId: 'PL5260001246',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    customerGroupId: null,
    registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    orderConfirmationEmails: ['ops@example.com'],
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

const createInput = {
  name: 'Acme',
  taxId: 'PL5260001246',
  registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
  status: 'active' as const,
  salesChannelIds: [CHANNEL],
};

const account: Command<CustomerAccountRecord> = {
  action: 'customer_account.create',
  objectType: 'customer_account',
  objectId: ACCOUNT_ID,
  run: async () => ({ result: { id: ACCOUNT_ID } as CustomerAccountRecord }),
};

function registerCommand() {
  return makeRegisterOrganizationCommand({ events: { emit: () => undefined } as never }, {
    request: { organization: createInput } as never,
    taxId: createInput.taxId,
    salesChannelId: CHANNEL,
    customFieldValues: { organization: {}, customer: {} },
    lookupRow: null,
    account: { command: () => account } as never,
  });
}

describe('ORGANIZATION_FIELD_SET agrees with the admin write bodies (FR-003)', () => {
  it('matches the create and the update body schemas', () => {
    expectFieldSetMatchesSchemas(ORGANIZATION_FIELD_SET, {
      create: AdminOrganizationCreateBodySchema,
      update: adminPatchOrganizationRequestSchema,
    });
  });
});

describe('the writers organizations registers (T042, I-5)', () => {
  it('lists every Organization write that changes a field of the set', () => {
    expect(organizationFieldSetRegistration.set).toBe(ORGANIZATION_FIELD_SET);
    expect(organizationFieldSetRegistration.writers.map((writer) => writer.on.action).sort()).toEqual([
      'organization.admin_patch',
      'organization.convert_to_company',
      'organization.create',
      'organization.merge.finalize',
      'organization.merge.start',
      'organization.personal.provision',
      'organization.register',
      'organization.set_custom_field_values',
      'organization.update',
    ]);
  });

  it('projects what each writer writes, from its own Command', () => {
    expectFieldSetWriters(organizationFieldSetRegistration, {
      'organization.create': {
        command: makeCreateOrganizationCommand({ membership: { replaceChannelsForEntity: async () => ({}) as never } }, createInput),
        result: organization(),
      },
      'organization.register': {
        command: registerCommand(),
        result: { organization: organization(), customerAccount: { id: ACCOUNT_ID } as CustomerAccountRecord, verificationToken: 'token' },
      },
      'organization.admin_patch': {
        command: makeAdminPatchOrganizationCommand({ organizationId: ORG_ID, changes: { name: 'Acme' }, assertCurrent: () => undefined }),
        result: organization(),
      },
      'organization.set_custom_field_values': {
        command: makeSetCustomFieldValuesCommand({ organizationId: ORG_ID, merge: async (current) => current }),
        result: organization(),
      },
      'organization.convert_to_company': {
        command: makeConvertToCompanyCommand(
          { accounts: { listByOrganization: async () => [] } },
          { organizationId: ORG_ID, input: { ...createInput, vatStatus: 'vat_payer' } },
        ),
        result: organization(),
      },
      'organization.merge.start': {
        command: makeMergeStartCommand(
          { recordMerge: () => ({}) as never },
          { mergeId: ORG_ID, survivorId: ORG_ID, loserId: ACCOUNT_ID, fieldChoices: {}, customFieldChoices: {}, source: null, participantCounts: {} },
        ),
        result: {} as never,
      },
      'organization.merge.finalize': {
        command: makeMergeFinalizeCommand(
          { recordMerge: () => ({}) as never },
          { mergeId: ORG_ID, hostType: 'organization', survivorId: ORG_ID, loserId: ACCOUNT_ID, batchSize: 100 } as never,
        ),
        result: { survivor: organization(), finalized: true, mergedAt: new Date() },
      },
      'organization.personal.provision': {
        command: makeProvisionPersonalOrganizationCommand(
          { name: () => 'Acme' },
          { customerAccountId: ACCOUNT_ID, email: 'solo@example.test' },
          { child: true },
        ),
        result: organization(),
      },
      'organization.update': {
        command: makeUpdateOrganizationCommand({ validateCountry: async () => undefined }, { organizationId: ORG_ID, patch: { name: 'Acme' } }),
        result: organization(),
      },
    });
  });

  it('registers the merge: start as an update writer of the outcome it fixes, finalize as the rule-check-only backstop (D-300.28)', () => {
    const start = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.merge.start')!;
    const finalize = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.merge.finalize')!;
    expect(start.on).toBe(ORGANIZATION_HOOKABLE_ACTIONS.mergeStart);
    expect(start.ruleCheckOnly).toBeUndefined();
    expect(finalize.ruleCheckOnly).toBe(true);
    for (const writer of [start, finalize]) {
      expect(writer.mode).toBe('update');
      expect([...writer.writes].sort()).toEqual([
        'fulfilmentStrategy',
        'fulfilmentStrategyWarehouseOrder',
        'name',
        'orderConfirmationEmails',
        'registeredAddress',
        'taxId',
        'vatStatus',
      ]);
    }
    expect(
      start.project({
        mergeId: ORG_ID,
        survivorId: ORG_ID,
        loserId: ACCOUNT_ID,
        source: null,
        survivor: { after: { name: 'Loser Co', orderConfirmationEmails: ['a@x.test'] }, changed: ['name', 'orderConfirmationEmails', 'legalName'] },
      }),
    ).toEqual({ after: { name: 'Loser Co', orderConfirmationEmails: ['a@x.test'] }, changed: ['name', 'orderConfirmationEmails'] });
    expect((manifest.hookableActions ?? []).map((declaration) => declaration.action)).not.toContain('organization.merge.finalize');
  });

  it('registers organization.personal.provision as a rule-check-only create that names only the derived name as chosen (D-300.31)', () => {
    const provision = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.personal.provision')!;
    expect(provision.ruleCheckOnly).toBe(true);
    expect(provision.mode).toBe('create');
    expect([...provision.writes].sort()).toEqual(['name', 'registeredAddress', 'status', 'taxId', 'vatStatus']);
    expect(provision.project({ organization: organization(), created: true })).toEqual({
      after: { name: 'Acme', status: 'active', vatStatus: 'vat_payer', registeredAddress: organization().registeredAddress, taxId: 'PL5260001246' },
      changed: ['name'],
    });
    // A re-found organisation wrote nothing, so nothing is held.
    expect(provision.project({ organization: organization(), created: false })).toEqual({ after: {}, changed: [] });
    expect((manifest.hookableActions ?? []).map((declaration) => declaration.action)).not.toContain('organization.personal.provision');
  });

  it('registers organization.update as rule-check-only: the port write is checked, and no module may hook it', () => {
    const update = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.update');
    expect(update?.on).toBe(ORGANIZATION_UPDATE_RULE_CHECK);
    expect(update?.ruleCheckOnly).toBe(true);
    expect((manifest.hookableActions ?? []).map((declaration) => declaration.action)).not.toContain('organization.update');
  });

  it('registers every other writer on the ref the manifest declares hookable', () => {
    const declared = new Set((manifest.hookableActions ?? []).map((declaration) => declaration.action));
    for (const writer of organizationFieldSetRegistration.writers) {
      if (writer.ruleCheckOnly === true) continue;
      expect(declared.has(writer.on.action), writer.on.action).toBe(true);
    }
    expect(organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.create')?.on).toBe(
      ORGANIZATION_HOOKABLE_ACTIONS.create,
    );
  });

  it('a create writer projects no before-state; an update writer names what changed', () => {
    const create = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.create')!;
    expect(create.project({ organization: { ...organization(), registeredAddress: createInput.registeredAddress }, salesChannelIds: [CHANNEL] })).toMatchObject({
      before: null,
      after: { name: 'Acme', salesChannelIds: [CHANNEL] },
    });
    const conversion = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.convert_to_company')!;
    expect(
      conversion.project({
        organizationId: ORG_ID,
        status: 'active',
        vatStatus: 'vat_payer',
        changedFields: ['isPersonal', 'legalName', 'name', 'registeredAddress', 'taxId', 'vatStatus'],
        approvalStamped: false,
        organization: organization(),
      }),
    ).toEqual({
      // D-300.26 — the name, the address and the VAT status, from the after-state; never the tax ID.
      after: { name: 'Acme', registeredAddress: organization().registeredAddress, vatStatus: 'vat_payer' },
      changed: ['name', 'registeredAddress', 'vatStatus'],
    });
    const patch = organizationFieldSetRegistration.writers.find((writer) => writer.on.action === 'organization.admin_patch')!;
    expect(patch.project({ organization: organization(), changedFields: ['orderConfirmationEmails', 'status'], changedCustomFields: ['tier'] })).toMatchObject({
      after: { orderConfirmationEmails: ['ops@example.com'] },
      // Only the keys this writer writes: a name outside the set is not a field of it.
      changed: ['orderConfirmationEmails'],
    });
  });
});

describe('the manifest declares the field set, its forms and the buyer write (FR-080, D-300.10)', () => {
  it('declares the field set and both admin forms', () => {
    expect(manifest.fieldSets).toEqual([ORGANIZATION_FIELD_SET]);
    expect(manifest.adminForms).toEqual([ORGANIZATION_FORMS.create, ORGANIZATION_FORMS.edit]);
  });

  it('lists organization.register as a buyer self-service action, and its Command says so', () => {
    expect(manifest.buyerSelfServiceActions).toEqual(['organization.register']);
    expect(registerCommand().buyerSelfService).toBe(true);
  });

  it('marks no operator write as buyer self-service', () => {
    expect(makeCreateOrganizationCommand({ membership: { replaceChannelsForEntity: async () => ({}) as never } }, createInput).buyerSelfService).toBeUndefined();
    expect(
      makeAdminPatchOrganizationCommand({ organizationId: ORG_ID, changes: {}, assertCurrent: () => undefined }).buyerSelfService,
    ).toBeUndefined();
  });
});
