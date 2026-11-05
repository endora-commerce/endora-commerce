import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  organizationTaxIdValidationRecordSchema,
  registryLookupResponseSchema,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  REGISTER_URL,
  configureGusCredential,
  enableRegistryLookup,
  flushRegistryLookupRedis,
  lookup,
  registrationBody,
  resetRegistryLookup,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T051; FR-022, FR-024) — the admin VAT validation history
 * carries where each row came from, the registry snapshot of a registration
 * row and the per-field divergence from what was submitted; "Validate now"
 * behaves as before; and an Organization outside a scoped administrator's
 * reach answers as one that does not exist (Principle XI).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

describe('VAT validation history with registration rows (feature 173)', () => {
  let h: BackendServerHandle;
  let organizationId: string;
  const stamp = Date.now().toString().slice(-9);
  const REP = `stub-vat173-rep-${stamp}`;

  const history = (id: string, cookies: Record<string, string> = ADMIN) =>
    h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${id}/vat-validations`, cookies });

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
    h = await setupBackendServer();
    await flushRegistryLookupRedis(h);
    await enableRegistryLookup(h, 'gus_mf');
    await configureGusCredential(h);

    const taxId = fakeNip(90_000_000, '1');
    const found = registryLookupResponseSchema.parse((await lookup(h, taxId)).json()).data;
    const body = registrationBody(taxId, { street: 'ul. Poprawiona 99', registryLookupId: found.lookupId! });
    // The submitted name differs from the registry's only in case and legal-form spelling.
    (body['organization'] as { name: string }).name = found.company!.legalName!
      .toLowerCase()
      .replace('spółka z ograniczoną odpowiedzialnością', 'sp. z o.o.');
    const res = await h.app.inject({ method: 'POST', url: REGISTER_URL, payload: body });
    expect(res.statusCode, res.body).toBe(201);
    organizationId = (res.json() as { data: { organization: { id: string } } }).data.organization.id;
  }, 120_000);

  afterAll(async () => {
    await resetRegistryLookup(h);
    await flushRegistryLookupRedis(h);
    await teardownBackendServer(h);
  });

  it('the registration row carries origin, details, submitted values and the street divergence', async () => {
    const res = await history(organizationId);
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { items: unknown[] }).items.map((item) => organizationTaxIdValidationRecordSchema.parse(item));
    expect(items).toHaveLength(1);
    const row = items[0]!;
    expect(row.origin).toBe('registration');
    expect(row.provider).toBe('gus_pl');
    expect(row.registryDetails).toMatchObject({ plSources: 'gus_mf', dataSource: 'gus_pl', regon: '123456785' });
    expect(row.submittedValues?.registeredAddress.street).toBe('ul. Poprawiona 99');
    expect(row.divergence).toEqual([{ field: 'street', registry: 'ul. Rejestrowa 12/3', submitted: 'ul. Poprawiona 99' }]);
  });

  it('"Validate now" answers as before, its row with origin admin and nulls', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/vat-validations`,
      cookies: ADMIN,
      payload: { providerHint: 'auto', applyAutoFill: false },
    });
    expect(res.statusCode, res.body).toBe(200);
    const answer = res.json() as Record<string, unknown>;
    expect(answer).toMatchObject({ origin: 'admin', registryDetails: null, submittedValues: null, divergence: null });
    expect(answer['organization']).toBeNull();
    const { organization: _organization, ...item } = answer;
    expect(organizationTaxIdValidationRecordSchema.safeParse(item).success).toBe(true);

    const items = (await history(organizationId)).json() as { items: Array<{ origin: string }> };
    expect(items.items.map((i) => i.origin)).toEqual(['admin', 'registration']);
  });

  it('a scoped sales representative sees another Organization’s history as one that does not exist', async () => {
    await withSystemScope('feature 173: a sales representative of one organisation', async () => {
      const fork = h.orm.em.fork();
      let role = await fork.findOne(AdminRole, { code: 'sales_representative' });
      const grants = ['customers:read', 'customers:manage'];
      if (!role) {
        role = fork.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        role.permissions = Array.from(new Set([...role.permissions, ...grants]));
      }
      await fork.persistAndFlush(role);
      const own = fork.create(Organization, {
        name: `VAT173 own ${stamp}`,
        taxId: `PL173O${stamp}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-173', country: 'PL' },
      });
      const rep = fork.create(AdminUser, {
        email: `vat173-rep-${stamp}@scope.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '173',
        lastName: 'Rep',
      });
      await fork.persistAndFlush([own, rep]);
      await fork.persistAndFlush(fork.create(OrganizationSalesRepAssignment, { organizationId: own.id, adminUserId: rep.id }));
      ADMIN_COOKIES[REP] = { adminUserId: rep.id };
    });
    const foreign = await history(organizationId, { b2b_session: REP });
    const absent = await history('00000000-0000-4000-8000-000000000173', { b2b_session: REP });
    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.json()).toEqual(absent.json());
    expect(JSON.stringify(foreign.json())).not.toContain('Poprawiona');
  });
});
