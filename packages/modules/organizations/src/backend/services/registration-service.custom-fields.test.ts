import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CustomFieldInputSurface,
  type CustomFieldValidationError,
  type CustomerAccountCreateInput,
  type CustomerAccountRecord,
  type RegisterOrganizationRequest,
  type SupportedEntityType,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import {
  RegistrationService,
  type OrganizationEventBus,
  type RegistrationCustomFieldValues,
} from './registration-service.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` research R-5, FR-022 –
 * FR-028, contracts/registration-and-admin-create.md §2 – §3): registration
 * validates both custom-field groups **before its first write**, merges their
 * refusals into one 422 whose entries are prefixed by group, stores the
 * Organization's bag on the row and hands the person's bag to the account
 * owner, and audits the keys it stored (`changedCustomFields`) — never a value.
 */

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000c1781';
const ROLE_ID = '00000000-0000-4000-8000-0000000c1782';
const ACCOUNT_ID = '00000000-0000-4000-8000-0000000c1783';

class ValidationFailure extends Error {
  override readonly name = 'CustomFieldValidationError';
  constructor(readonly errors: CustomFieldValidationError[]) {
    super('Custom field validation failed.');
  }
}

function request(
  organizationValues?: Record<string, unknown>,
  personValues?: Record<string, unknown>,
): RegisterOrganizationRequest {
  return {
    organization: {
      name: 'Acme',
      taxId: 'PL1234567890',
      registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
      ...(organizationValues !== undefined ? { customFieldValues: organizationValues } : {}),
    },
    firstUser: {
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
      ...(personValues !== undefined ? { customFieldValues: personValues } : {}),
    },
    acceptedTermsVersion: '1',
  } as RegisterOrganizationRequest;
}

function harness(values?: RegistrationCustomFieldValues, steps: string[] = []) {
  const audits: Array<{ action: string; stateAfter?: unknown }> = [];
  const accountInputs: CustomerAccountCreateInput[] = [];
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = [];
  const em = {
    findOne: async (entity: unknown) => {
      if (entity === OrganizationRole) return { id: ROLE_ID };
      return null;
    },
    create: (entity: unknown, data: Record<string, unknown>) => {
      steps.push(`create:${entity === Organization ? 'Organization' : 'other'}`);
      created.push({ entity, data });
      return { id: entity === Organization ? ORGANIZATION_ID : 'token', ...data };
    },
    persistAndFlush: async () => {
      steps.push('flush');
    },
    flush: async () => {
      steps.push('flush');
    },
  } as unknown as EntityManager;
  const auditLog = {
    recordWithin: (_em: unknown, entry: { action: string; stateAfter?: unknown }) => {
      audits.push(entry);
    },
  } as unknown as AuditPort;
  const accounts = {
    read: { findByEmail: async () => null },
    write: {
      create: async (input: CustomerAccountCreateInput) => {
        steps.push('account.create');
        accountInputs.push(input);
        return { id: ACCOUNT_ID, organizationId: ORGANIZATION_ID, customFieldValues: input.customFieldValues ?? {} } as CustomerAccountRecord;
      },
    },
  };
  const events = { emit: vi.fn() } as unknown as OrganizationEventBus;
  const service = new RegistrationService(
    () => em,
    events,
    accounts as never,
    undefined,
    auditLog,
    undefined,
    undefined,
    values,
  );
  return { service, steps, audits, accountInputs, created };
}

function stubValues(
  answer: (entityType: SupportedEntityType, values: Record<string, unknown> | undefined) => Record<string, unknown>,
  steps?: string[],
): RegistrationCustomFieldValues & {
  calls: Array<[SupportedEntityType, unknown, CustomFieldInputSurface]>;
  languages: Array<string | undefined>;
} {
  const calls: Array<[SupportedEntityType, unknown, CustomFieldInputSurface]> = [];
  const languages: Array<string | undefined> = [];
  return {
    calls,
    languages,
    validateForCustomerInput: async (entityType, values, surface, language) => {
      steps?.push(`validate:${entityType}`);
      calls.push([entityType, values, surface]);
      languages.push(language);
      return answer(entityType, values);
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('RegistrationService — custom-field values (feature 175)', () => {
  it('validates both groups on the registration surface before any write', async () => {
    const steps: string[] = [];
    const values = stubValues((_t, v) => ({ ...(v ?? {}) }), steps);
    const h = harness(values, steps);

    await h.service.registerOrganization(request({ source: 'fair' }, { phone: '+48 600' }));

    expect(steps.slice(0, 3)).toEqual(['validate:organization', 'validate:customer', 'create:Organization']);
    expect(values.calls).toEqual([
      ['organization', { source: 'fair' }, 'organization.register'],
      ['customer', { phone: '+48 600' }, 'organization.register'],
    ]);
  });

  it('stores the validated Organization bag on the row and hands the person bag to the account owner', async () => {
    const values = stubValues((entityType) =>
      entityType === 'organization' ? { source: 'fair' } : { phone: '+48 600' },
    );
    const h = harness(values);

    await h.service.registerOrganization(request({ source: ' fair ' }, { phone: '+48 600' }));

    const org = h.created.find((c) => c.entity === Organization)!;
    expect(org.data['customFieldValues']).toEqual({ source: 'fair' });
    expect(h.accountInputs[0]!.customFieldValues).toEqual({ phone: '+48 600' });
  });

  it('merges the refusals of both groups into one 422, prefixed by group, and writes nothing', async () => {
    const values = stubValues((entityType) => {
      if (entityType === 'organization') {
        throw new ValidationFailure([{ field: 'acquisition_source', code: 'missing_required', message: 'Field "acquisition_source" is required.' }]);
      }
      throw new ValidationFailure([
        { field: 'credit_limit_override', code: 'not_open_for_input', message: 'Field "credit_limit_override" cannot be supplied here.' },
      ]);
    });
    const h = harness(values);

    const err = await refusal(h.service.registerOrganization(request({}, { credit_limit_override: 1 })));

    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(err.details).toEqual([
      expect.objectContaining({ field: 'organization.acquisition_source', code: 'missing_required', message: 'Field "acquisition_source" is required.' }),
      expect.objectContaining({ field: 'firstUser.credit_limit_override', code: 'not_open_for_input', message: 'Field "credit_limit_override" cannot be supplied here.' }),
    ]);
    // The envelope's own entry shape, repeated, so every reader of a custom-field 422 can place it.
    expect((err.details as Array<{ path: string }>).map((d) => d.path)).toEqual([
      'organization.acquisition_source',
      'firstUser.credit_limit_override',
    ]);
    expect(h.steps.filter((s) => !s.startsWith('validate:'))).toEqual([]);
  });

  it('names the group itself for `too_many_keys`', async () => {
    const values = stubValues((entityType) => {
      if (entityType === 'customer') {
        throw new ValidationFailure([{ field: 'customer', code: 'too_many_keys', message: 'At most 50 custom fields may be supplied at once.' }]);
      }
      return {};
    });
    const h = harness(values);

    const err = await refusal(h.service.registerOrganization(request(undefined, { a: 1 })));

    expect(err.details).toEqual([
      expect.objectContaining({ field: 'firstUser', code: 'too_many_keys', message: 'At most 50 custom fields may be supplied at once.' }),
    ]);
  });

  it('audits the stored keys, prefixed by group and sorted, and no value', async () => {
    const values = stubValues((entityType) =>
      entityType === 'organization' ? { source: 'fair-2026', employees: 470470 } : { phone: '+48 600 175 041' },
    );
    const h = harness(values);

    await h.service.registerOrganization(
      request({ source: 'fair-2026', employees: 470470 }, { phone: '+48 600 175 041' }),
    );

    const entry = h.audits.find((a) => a.action === 'organization.register')!;
    // `specs/conventions/audit-state.md` (D-288): names in `changedCustomFields`, never values.
    expect(entry.stateAfter).toMatchObject({
      changedCustomFields: ['firstUser.phone', 'organization.employees', 'organization.source'],
    });
    expect(entry.stateAfter).not.toHaveProperty('customFieldKeys');
    expect(JSON.stringify(entry)).not.toContain('470470');
    expect(JSON.stringify(entry)).not.toContain('fair-2026');
    expect(JSON.stringify(entry)).not.toContain('+48 600 175 041');
  });

  it('refuses every key `not_open_for_input` when no value port is composed', async () => {
    const h = harness(undefined);

    const err = await refusal(h.service.registerOrganization(request({ source: 'fair' }, { phone: '1', fax: '2' })));

    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect((err.details as unknown as Array<{ field: string; code: string }>).map((d) => [d.field, d.code])).toEqual([
      ['organization.source', 'not_open_for_input'],
      ['firstUser.phone', 'not_open_for_input'],
      ['firstUser.fax', 'not_open_for_input'],
    ]);
    expect(h.steps).toEqual([]);
  });

  it('asks for the refusals in the request\'s language (module-i18n case 1)', async () => {
    const values = stubValues((_t, v) => ({ ...(v ?? {}) }));
    const h = harness(values);

    await h.service.registerOrganization(request({ source: 'fair' }, { phone: '1' }), {
      salesChannelId: null,
      language: 'pl',
    });

    expect(values.languages).toEqual(['pl', 'pl']);
  });

  it('words its own refusal for a buyer when no value port is composed — no key in the sentence', async () => {
    const h = harness(undefined);

    const err = await refusal(h.service.registerOrganization(request({ source_secret_key: 'fair' })));

    const [entry] = err.details as unknown as Array<{ field: string; message: string }>;
    expect(entry!.field).toBe('organization.source_secret_key');
    expect(entry!.message).not.toContain('source_secret_key');
  });

  it('registers exactly as before when no port is composed and no values are sent', async () => {
    const h = harness(undefined);

    await h.service.registerOrganization(request());

    const org = h.created.find((c) => c.entity === Organization)!;
    expect(org.data['customFieldValues']).toEqual({});
    expect(h.accountInputs[0]!.customFieldValues).toEqual({});
    const entry = h.audits.find((a) => a.action === 'organization.register')!;
    expect(entry.stateAfter).toMatchObject({ changedCustomFields: [] });
  });

  it('re-throws anything that is not a validation failure', async () => {
    const values = stubValues(() => {
      throw new Error('module disabled');
    });
    const h = harness(values);

    await expect(h.service.registerOrganization(request({ a: 1 }))).rejects.toThrow('module disabled');
    expect(h.steps.filter((s) => !s.startsWith('validate:'))).toEqual([]);
  });
});
