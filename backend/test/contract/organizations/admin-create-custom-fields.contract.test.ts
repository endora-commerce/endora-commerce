import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` US4, FR-015, FR-018,
 * FR-021, FR-023, contracts/registration-and-admin-create.md §5) — the admin
 * Organization create and the admin member direct-create accept the record's
 * custom-field values: validated with the administrator's rules inside the
 * create, stored on the new row, named (never valued) by its audit row
 * (`specs/conventions/audit-state.md`, D-288), and a refused value creates
 * nothing. The administrator's rules are not the buyer's: an internal
 * field that is not open on registration is accepted here and refused there.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';

describe('admin creates — custom-field values (feature 175)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const created: string[] = [];
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  let seq = 0;
  const taxId = (): string => `PL175A${stamp.replace(/[a-f]/g, '3')}${(seq++).toString().padStart(2, '0')}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `cf175-admin-${stamp}`,
      name: { en: 'cf175' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
    await define({ entityType: 'organization', key: 'cf175a_note', labelDefault: 'Sales note', audience: 'internal' });
    await define({ entityType: 'customer', key: 'cf175a_badge', labelDefault: 'Badge number', audience: 'internal' });
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
      payload: { label: {}, valueType: 'text', required: false, audience: 'customer', sortOrder: 0, config: {}, carryTo: [], options: [], ...payload },
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

  function createOrganization(extra: Record<string, unknown> = {}, tax = taxId()) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      ...ADMIN,
      payload: {
        name: `CF175 Admin ${stamp}`,
        taxId: tax,
        registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
        salesChannelIds: [channelId],
        ...extra,
      },
    });
  }

  function addMember(organizationId: string, extra: Record<string, unknown> = {}, email = `cf175a-${randomUUID().slice(0, 8)}@example.test`) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/members`,
      ...ADMIN,
      payload: { email, password: 'a-very-strong-password-123!', firstName: 'Jan', lastName: 'Kowalski', ...extra },
    });
  }

  const knex = () => h.em().getKnex();

  describe('POST /api/v1/admin/organizations', () => {
    it('stores the values, answers them and names them — never their values — in the audit row', async () => {
      const res = await createOrganization({ customFieldValues: { cf175a_note: 'S470-CF' } });
      expect(res.statusCode, res.body).toBe(201);
      const org = res.json().data as { id: string; customFieldValues: Record<string, unknown> };
      expect(org.customFieldValues).toEqual({ cf175a_note: 'S470-CF' });

      const row = await knex()('organizations').where({ id: org.id }).first('custom_field_values');
      expect(row.custom_field_values).toEqual({ cf175a_note: 'S470-CF' });

      h.em().clear();
      const entries = await h.em().find(AuditLogEntry, { action: 'organization.create', objectId: org.id });
      expectNoAuditValues(entries, ['S470-CF']);
      expect(entries[0]?.stateAfter).not.toHaveProperty('customFieldValues');
      expect(entries[0]?.stateAfter).toMatchObject({ changedCustomFields: ['cf175a_note'] });
    });

    it('refuses a missing required field and creates nothing', async () => {
      const id = await define({ entityType: 'organization', key: 'cf175a_required', labelDefault: 'Account manager', required: true, audience: 'internal' });
      try {
        const tax = taxId();
        const res = await createOrganization({ customFieldValues: { cf175a_note: 'x' } }, tax);
        expect(res.statusCode, res.body).toBe(422);
        const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
        expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
        expect(body.error.details.map((d) => d.path)).toContain('cf175a_required');
        expect(await knex()('organizations').where({ tax_id: tax }).count({ n: '*' })).toEqual([{ n: '0' }]);
      } finally {
        await undefine(id);
      }
    });

    it('accepts an internal field that registration refuses (FR-023)', async () => {
      const admin = await createOrganization({ customFieldValues: { cf175a_note: 'internal is fine here' } });
      expect(admin.statusCode, admin.body).toBe(201);

      const suffix = randomUUID().replace(/-/g, '').slice(0, 8).replace(/[a-f]/g, '5');
      const buyer = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/register',
        payload: {
          organization: {
            name: 'CF175 buyer',
            taxId: `PL175B${suffix}`,
            registeredAddress: { street: 'ul. Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
            customFieldValues: { cf175a_note: 'internal is fine here' },
          },
          firstUser: { email: `cf175b-${suffix}@example.test`, password: 'a-very-strong-password-123!', firstName: 'A', lastName: 'B' },
          acceptedTermsVersion: '1.0.0',
        },
      });
      expect(buyer.statusCode, buyer.body).toBe(422);
      expect((buyer.json() as { error: { details: Array<{ code: string }> } }).error.details[0]?.code).toBe('not_open_for_input');
    });
  });

  describe('POST /api/v1/admin/organizations/:id/members', () => {
    let organizationId: string;

    beforeAll(async () => {
      const res = await createOrganization();
      expect(res.statusCode, res.body).toBe(201);
      organizationId = (res.json().data as { id: string }).id;
    });

    it('stores the values on the account and names them — never their values — in the audit row', async () => {
      const email = `cf175a-${randomUUID().slice(0, 8)}@example.test`;
      const res = await addMember(organizationId, { customFieldValues: { cf175a_badge: 'S470-CF' } }, email);
      expect(res.statusCode, res.body).toBe(201);

      const row = await knex()('customer_accounts').where({ email }).first('id', 'custom_field_values');
      expect(row.custom_field_values).toEqual({ cf175a_badge: 'S470-CF' });

      h.em().clear();
      const entries = await h.em().find(AuditLogEntry, { action: 'customer_account.admin_create', objectId: row.id });
      // Nor the address or the Organization, the tenant anchor (D-288, #470).
      expectNoAuditValues(entries, ['S470-CF', email, organizationId]);
      expect(entries[0]?.stateAfter).not.toHaveProperty('customFieldValues');
      expect(entries[0]?.stateAfter).toMatchObject({ changedCustomFields: ['cf175a_badge'] });
    });

    it('refuses a missing required field and creates no account', async () => {
      const id = await define({ entityType: 'customer', key: 'cf175a_member_required', labelDefault: 'Cost centre', required: true, audience: 'internal' });
      try {
        const email = `cf175a-${randomUUID().slice(0, 8)}@example.test`;
        const res = await addMember(organizationId, { customFieldValues: { cf175a_badge: 'x' } }, email);
        expect(res.statusCode, res.body).toBe(422);
        const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
        expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
        expect(body.error.details.map((d) => d.path)).toContain('cf175a_member_required');
        expect(await knex()('customer_accounts').where({ email }).count({ n: '*' })).toEqual([{ n: '0' }]);
      } finally {
        await undefine(id);
      }
    });

    it('still refuses an unknown body member (the schema stays strict)', async () => {
      const res = await addMember(organizationId, { customFieldValues: {}, surprise: true });
      expect(res.statusCode).toBe(400);
    });
  });
});
