import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` US1, US3, SC-002, SC-003,
 * contracts/registration-and-admin-create.md §1 – §3) — buyer input on the
 * `organization.register` surface, end to end over `POST
 * /api/v1/organizations/register` [real DB].
 *
 * A buyer writes only the values of fields open on registration, each into
 * its own group (`organization` → the Organization, `firstUser` → the
 * account). Anything else — a closed field, an unknown key, another entity
 * type's key, a value of the wrong shape or size — is refused `422
 * CUSTOM_FIELD_VALUE_INVALID` naming the field (`not_open_for_input` for a key
 * not open), and a refused registration leaves no Organization, no account and
 * no channel binding behind.
 *
 * This file is the `test` the organizations buyer-input declaration names
 * (`customFieldWrites`, research R-11): it must mention the surface and
 * `not_open_for_input`.
 */

const SURFACE = 'organization.register';
const NOT_OPEN = 'not_open_for_input';
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';
const REGISTER_URL = '/api/v1/organizations/register';

const VALUE_TYPES = ['text', 'number', 'boolean', 'date', 'select', 'multiselect'] as const;
const SAMPLE: Record<(typeof VALUE_TYPES)[number], unknown> = {
  text: 'x',
  number: 1,
  boolean: true,
  date: '2026-01-01',
  select: 'a',
  multiselect: ['a'],
};
const OPTION_A = { value: 'a', labelDefault: 'A', label: {}, isDefault: false, sortOrder: 0 };

type Group = Record<string, unknown> | undefined;
interface Refusal {
  field: string;
  code: string;
  message: string;
}

describe('POST /api/v1/organizations/register — custom-field values (feature 175)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  async function define(payload: Record<string, unknown>): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS_URL,
      ...ADMIN,
      payload: {
        label: {},
        valueType: 'text',
        required: false,
        audience: 'customer',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
        ...payload,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as { id: string }).id;
    created.push(id);
    return id;
  }

  async function undefine(id: string): Promise<void> {
    await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    created.splice(created.indexOf(id), 1);
  }

  /** One registration with a fresh tax ID and e-mail, so each call is its own business. */
  async function register(organization: Group, firstUser: Group, headers: Record<string, string> = {}) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const taxId = `PL${suffix.replace(/[a-f]/g, '7')}`;
    const email = `cf175-${suffix}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: REGISTER_URL,
      headers,
      payload: {
        organization: {
          name: `CF175 ${suffix}`,
          taxId,
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
          ...(organization !== undefined ? { customFieldValues: organization } : {}),
        },
        firstUser: {
          email,
          password: 'a-very-strong-password-123!',
          firstName: 'Anna',
          lastName: 'Nowak',
          ...(firstUser !== undefined ? { customFieldValues: firstUser } : {}),
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    return { res, taxId, email };
  }

  /** What a registration left behind (SC-002). */
  async function traces(taxId: string, email: string): Promise<{ organizations: number; accounts: number; bindings: number }> {
    const knex = h.em().getKnex();
    const count = async (query: Promise<Array<{ n: string | number }>>): Promise<number> => Number((await query)[0]!.n);
    return {
      organizations: await count(knex('organizations').where({ tax_id: taxId }).count({ n: '*' })),
      accounts: await count(knex('customer_accounts').where({ email }).count({ n: '*' })),
      bindings: await count(
        knex('sales_channel_organizations')
          .join('organizations', 'organizations.id', 'sales_channel_organizations.organization_id')
          .where('organizations.tax_id', taxId)
          .count({ n: '*' }),
      ),
    };
  }

  async function refused(organization: Group, firstUser: Group): Promise<Refusal[]> {
    const { res, taxId, email } = await register(organization, firstUser);
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details: Refusal[] } };
    expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(await traces(taxId, email)).toEqual({ organizations: 0, accounts: 0, bindings: 0 });
    return body.error.details;
  }

  // Before any definition of this file exists — nothing is open (US1-7).
  it('registers exactly as before when no field is open and no value is sent (US1-7, FR-026)', async () => {
    const { res, taxId, email } = await register(undefined, undefined);
    expect(res.statusCode, res.body).toBe(201);
    expect(await traces(taxId, email)).toMatchObject({ organizations: 1, accounts: 1 });
  });

  describe('with fields open on the surface', () => {
    beforeAll(async () => {
      await define({
        entityType: 'organization',
        key: 'cf175r_source',
        labelDefault: 'How did you hear about us',
        valueType: 'select',
        options: [
          { value: 'fair', labelDefault: 'Trade fair', label: {}, isDefault: false, sortOrder: 0 },
          { value: 'web', labelDefault: 'Web', label: {}, isDefault: false, sortOrder: 1 },
        ],
        customerInput: [SURFACE],
      });
      await define({ entityType: 'organization', key: 'cf175r_employees', labelDefault: 'Employees', valueType: 'number', customerInput: [SURFACE] });
      await define({ entityType: 'customer', key: 'cf175r_phone', labelDefault: 'Phone', customerInput: [SURFACE] });
      // Closed fields: internal, hidden in the admin, and a required one.
      await define({ entityType: 'organization', key: 'cf175r_internal_note', labelDefault: 'Sales note', audience: 'internal' });
      await define({ entityType: 'organization', key: 'cf175r_hidden', labelDefault: 'Sync checksum', adminAccess: 'hidden' });
      await define({ entityType: 'organization', key: 'cf175r_required_closed', labelDefault: 'Credit tier', required: true, audience: 'internal' });
      // One closed field per value type, on both entity types (SC-003).
      for (const entityType of ['organization', 'customer']) {
        for (const valueType of VALUE_TYPES) {
          await define({
            entityType,
            key: `cf175r_closed_${valueType}`,
            labelDefault: `Closed ${valueType}`,
            valueType,
            options: valueType === 'select' || valueType === 'multiselect' ? [OPTION_A] : [],
          });
        }
      }
    });

    it('stores an Organization choice on the Organization, and the admin reads it (US1-1)', async () => {
      const { res, taxId } = await register({ cf175r_source: 'fair' }, undefined);
      expect(res.statusCode, res.body).toBe(201);
      const organizationId = (res.json().data as { organization: { id: string } }).organization.id;

      const row = await h.em().getKnex()('organizations').where({ tax_id: taxId }).first('custom_field_values');
      expect(row.custom_field_values).toEqual({ cf175r_source: 'fair' });
      const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${organizationId}`, ...ADMIN });
      expect(admin.statusCode, admin.body).toBe(200);
      expect((admin.json().data as { customFieldValues: Record<string, unknown> }).customFieldValues).toMatchObject({
        cf175r_source: 'fair',
      });
    });

    it('stores a person text value on the account, trimmed (US1-2)', async () => {
      const { res, email } = await register(undefined, { cf175r_phone: '  +48 600 175 042 ' });
      expect(res.statusCode, res.body).toBe(201);
      const row = await h.em().getKnex()('customer_accounts').where({ email }).first('custom_field_values');
      expect(row.custom_field_values).toEqual({ cf175r_phone: '+48 600 175 042' });
    });

    it('names the supplied fields in the registration audit row and records no value (FR-028, D-288)', async () => {
      // `specs/conventions/audit-state.md` §6 — sentinel values, then the keys only.
      const { res } = await register({ cf175r_employees: 470470, cf175r_source: 'web' }, { cf175r_phone: 'S470-CF' });
      expect(res.statusCode, res.body).toBe(201);
      const organizationId = (res.json().data as { organization: { id: string } }).organization.id;

      h.em().clear();
      const entries = await h.em().find(AuditLogEntry, { action: 'organization.register', objectId: organizationId });
      expectNoAuditValues(entries, ['S470-CF', 470470]);
      expect(entries[0]?.stateAfter).toMatchObject({
        changedCustomFields: ['firstUser.cf175r_phone', 'organization.cf175r_employees', 'organization.cf175r_source'],
      });
      expect(entries[0]?.stateAfter).not.toHaveProperty('customFieldKeys');
      // The Organization's name and tax ID by name only (D-288, #470 O-2).
      expect(entries[0]?.stateAfter).toMatchObject({ changedFields: expect.arrayContaining(['name', 'taxId']) });
      expect(entries[0]?.stateAfter).not.toHaveProperty('name');
      expect(entries[0]?.stateAfter).not.toHaveProperty('taxId');
    });

    it('refuses an empty required open field beside it and creates nothing (US1-4)', async () => {
      const id = await define({ entityType: 'organization', key: 'cf175r_required_open', labelDefault: 'VAT contact', required: true, customerInput: [SURFACE] });
      try {
        const details = await refused({ cf175r_required_open: '   ' }, undefined);
        expect(details).toContainEqual(expect.objectContaining({ field: 'organization.cf175r_required_open', code: 'missing_required' }));
      } finally {
        await undefine(id);
      }
    });

    it('registers with an optional open field left empty, storing no value for it (US1-5)', async () => {
      const { res, taxId } = await register({ cf175r_source: '' }, {});
      expect(res.statusCode, res.body).toBe(201);
      const row = await h.em().getKnex()('organizations').where({ tax_id: taxId }).first('custom_field_values');
      expect(row.custom_field_values).toEqual({});
    });

    it('refuses a field that exists but is not open, naming it (US3-1)', async () => {
      const details = await refused({ cf175r_internal_note: 'VIP' }, undefined);
      expect(details).toEqual([expect.objectContaining({ field: 'organization.cf175r_internal_note', code: NOT_OPEN })]);
    });

    it('refuses a key no definition has, naming it (US3-2)', async () => {
      const details = await refused(undefined, { cf175r_no_such_key: 'x' });
      expect(details).toEqual([expect.objectContaining({ field: 'firstUser.cf175r_no_such_key', code: NOT_OPEN })]);
    });

    it('refuses an open field sent under the other group, both ways (US3-3)', async () => {
      expect(await refused({ cf175r_phone: '+48' }, undefined)).toEqual([
        expect.objectContaining({ field: 'organization.cf175r_phone', code: NOT_OPEN }),
      ]);
      expect(await refused(undefined, { cf175r_source: 'fair' })).toEqual([
        expect.objectContaining({ field: 'firstUser.cf175r_source', code: NOT_OPEN }),
      ]);
    });

    it('refuses an oversize text, a non-number and an unknown option, naming field and reason (US3-4)', async () => {
      const details = await refused(
        { cf175r_employees: 'many', cf175r_source: 'radio' },
        { cf175r_phone: 'x'.repeat(1001) },
      );
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'organization.cf175r_employees', code: 'wrong_type' }),
          expect.objectContaining({ field: 'organization.cf175r_source', code: 'unknown_option' }),
          expect.objectContaining({ field: 'firstUser.cf175r_phone', code: 'out_of_range' }),
        ]),
      );
      expect(details).toHaveLength(3);
    });

    it('is not refused because of a required field that is not open (US3-5)', async () => {
      const { res } = await register({ cf175r_source: 'web' }, { cf175r_phone: '+48 1' });
      expect(res.statusCode, res.body).toBe(201);
    });

    it('refuses a hidden field like any closed one — admin access never opens a field (US3-7)', async () => {
      const details = await refused({ cf175r_hidden: 'abc' }, undefined);
      expect(details).toEqual([expect.objectContaining({ field: 'organization.cf175r_hidden', code: NOT_OPEN })]);
    });

    // `specs/conventions/module-i18n.md`, case 1 — the backend can resolve the
    // buyer's language, so it words the refusal and ships the code beside it.
    it('words each refusal for the buyer, in the request language, beside its code', async () => {
      for (const [language, expected] of [
        ['pl', { envelope: 'Niektóre pola są puste lub niepoprawne. Popraw je i spróbuj ponownie.', wrongType: 'Wpisz poprawną wartość.', notOpen: 'Tego pola nie można tutaj wypełnić.' }],
        ['en', { envelope: 'Some fields are missing or invalid. Correct them and try again.', wrongType: 'Enter a valid value.', notOpen: 'This field cannot be filled in here.' }],
      ] as const) {
        const { res } = await register({ cf175r_employees: 'many', cf175r_internal_note: 'VIP' }, undefined, {
          'accept-language': language,
        });
        expect(res.statusCode, res.body).toBe(422);
        const error = (res.json() as { error: { code: string; message: string; details: Refusal[] } }).error;
        expect(error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
        expect(error.message).toBe(expected.envelope);
        expect(error.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'organization.cf175r_employees', code: 'wrong_type', message: expected.wrongType }),
            expect.objectContaining({ field: 'organization.cf175r_internal_note', code: NOT_OPEN, message: expected.notOpen }),
          ]),
        );
        for (const entry of error.details) expect(entry.message).not.toMatch(/cf175r_|many|VIP/);
      }
    });

    it('refuses more than 50 keys in one group, naming the group', async () => {
      const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'x']));
      const details = await refused(undefined, many);
      expect(details).toEqual([expect.objectContaining({ field: 'firstUser', code: 'too_many_keys' })]);
    });

    for (const [group, entityType] of [
      ['organization', 'organization'],
      ['firstUser', 'customer'],
    ] as const) {
      for (const valueType of VALUE_TYPES) {
        it(`refuses a closed ${valueType} field of ${entityType} and creates nothing (SC-003, US3-6)`, async () => {
          const values = { [`cf175r_closed_${valueType}`]: SAMPLE[valueType] };
          const details = await refused(
            group === 'organization' ? values : undefined,
            group === 'firstUser' ? values : undefined,
          );
          expect(details).toEqual([
            expect.objectContaining({ field: `${group}.cf175r_closed_${valueType}`, code: NOT_OPEN }),
          ]);
        });
      }
    }
  });
});
