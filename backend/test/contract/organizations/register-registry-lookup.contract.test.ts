import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registryLookupResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  REGISTER_URL,
  REGISTRY_LOOKUP_SETTINGS,
  configureGusCredential,
  enableRegistryLookup,
  flushRegistryLookupRedis,
  lookup,
  registrationBody,
  registryFakes,
  resetRegistryLookup,
  setRegistrySetting,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T030, T042; FR-016, FR-017, FR-019 – FR-021, SC-002) — a
 * registration carrying a lookup reference persists the registry snapshot from
 * the platform's own store, and no lookup outcome ever stops a registration.
 */

interface ValidationRow {
  organization_id: string;
  origin: string;
  provider: string;
  outcome: string;
  error_kind: string | null;
  tax_id_value: string;
  legal_name_returned: string | null;
  address_returned: Record<string, unknown> | null;
  registry_details: Record<string, unknown> | null;
  submitted_values: Record<string, unknown> | null;
  requested_by_admin_user_id: string | null;
}

describe('registration with a registry lookup (feature 173)', () => {
  let h: BackendServerHandle;
  let seed = 30_000_000;
  const nip = (marker = '1'): string => fakeNip((seed += 7), marker);

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await resetRegistryLookup(h);
    await flushRegistryLookupRedis(h);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    registryFakes(h).reset();
    await enableRegistryLookup(h, 'gus_mf');
    await configureGusCredential(h);
  });

  async function lookupId(taxId: string, country = 'PL') {
    const res = await lookup(h, taxId, country);
    expect(res.statusCode, res.body).toBe(200);
    return registryLookupResponseSchema.parse(res.json()).data;
  }

  async function register(body: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: REGISTER_URL, payload: body });
  }

  async function rowsOf(organizationId: string): Promise<ValidationRow[]> {
    return (await h.em().execute(
      `select * from "organization_tax_id_validations" where "organization_id" = ? order by "created_at"`,
      [organizationId],
    )) as ValidationRow[];
  }

  async function registered(body: Record<string, unknown>): Promise<string> {
    const res = await register(body);
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { organization: { id: string } } }).data.organization.id;
  }

  describe('US1 — the snapshot is persisted with the new Organization', () => {
    it('lookup, edit the street, register ⇒ one registration row equal to what the lookup answered', async () => {
      const taxId = nip();
      const answer = await lookupId(taxId);
      expect(answer.status).toBe('found');
      registryFakes(h).reset();

      const body = registrationBody(`PL${taxId}`, { street: 'ul. Poprawiona 99', registryLookupId: answer.lookupId! });
      const organizationId = await registered(body);

      // FR-021 — the register request contacts no registry.
      expect(registryFakes(h).totalCalls()).toBe(0);

      const rows = await rowsOf(organizationId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({
        origin: 'registration',
        provider: 'gus_pl',
        outcome: 'validated',
        error_kind: null,
        tax_id_value: `PL${taxId}`,
        legal_name_returned: answer.company!.legalName,
        address_returned: {
          line1: answer.company!.registeredAddress.street,
          postalCode: answer.company!.registeredAddress.postalCode,
          city: answer.company!.registeredAddress.city,
          countryCode: 'PL',
        },
        requested_by_admin_user_id: null,
      });
      expect(row.registry_details).toMatchObject({
        plSources: 'gus_mf',
        dataSource: 'gus_pl',
        vatStatusSource: 'mf_pl',
        regon: answer.company!.regon,
        vatPayerStatus: 'active',
        activityStatus: 'active',
        fetchedAt: answer.fetchedAt,
        fromCache: false,
      });
      const organization = body['organization'] as {
        name: string;
        taxId: string;
        registeredAddress: Record<string, string>;
      };
      expect(row.submitted_values).toEqual({
        name: organization.name,
        taxId: organization.taxId,
        registeredAddress: {
          street: 'ul. Poprawiona 99',
          postalCode: organization.registeredAddress['postalCode'],
          city: organization.registeredAddress['city'],
          country: 'PL',
        },
      });

      // The Organization stores what was submitted; its summary is stamped.
      const [org] = (await h.em().execute(
        `select "registered_address", "legal_name", "vat_validated_at", "vat_validation_provider", "vat_validation_outcome"
           from "organizations" where "id" = ?`,
        [organizationId],
      )) as Array<{
        registered_address: { street: string };
        legal_name: string | null;
        vat_validated_at: Date | null;
        vat_validation_provider: string | null;
        vat_validation_outcome: string | null;
      }>;
      expect(org!.registered_address.street).toBe('ul. Poprawiona 99');
      expect(org!.legal_name).toBeNull(); // OD-7
      expect(org!.vat_validated_at).not.toBeNull();
      expect(org!.vat_validation_provider).toBe('gus_pl');
      expect(org!.vat_validation_outcome).toBe('validated');

      // The existing `organization.register` audit entry carries the lookup.
      const [audit] = (await h.em().execute(
        `select "state_after" from "audit_log_entries" where "action" = 'organization.register' and "object_id" = ?`,
        [organizationId],
      )) as Array<{ state_after: Record<string, unknown> }>;
      expect(audit!.state_after['registryLookup']).toEqual({ provider: 'gus_pl', outcome: 'validated' });

      // The ticket is gone once the registration committed.
      expect(await h.redis.get(`b2b:org-registry-lookup:v1:ticket:${answer.lookupId}`)).toBeNull();
    });

    it('a registration without a reference writes no row and audits no lookup', async () => {
      const organizationId = await registered(registrationBody(nip()));
      expect(await rowsOf(organizationId)).toHaveLength(0);
      const [audit] = (await h.em().execute(
        `select "state_after" from "audit_log_entries" where "action" = 'organization.register' and "object_id" = ?`,
        [organizationId],
      )) as Array<{ state_after: Record<string, unknown> }>;
      expect(audit!.state_after['registryLookup']).toBeUndefined();
    });
  });

  describe('US2 — no lookup outcome stops a registration', () => {
    it.each([
      ['not found', '9', 'failed', 'not_found'],
      ['unavailable', '8', 'deferred', 'provider_503'],
      ['VAT inactive', '7', 'failed', 'not_active_vat_payer'],
    ] as const)('after %s: 201 and the mapped row', async (_label, marker, outcome, errorKind) => {
      const taxId = nip(marker);
      const answer = await lookupId(taxId);
      const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
      const rows = await rowsOf(organizationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ origin: 'registration', outcome, error_kind: errorKind });
    });

    it('a ticket for a different tax ID ⇒ 201 and no row', async () => {
      const answer = await lookupId(nip());
      const organizationId = await registered(registrationBody(nip(), { registryLookupId: answer.lookupId! }));
      expect(await rowsOf(organizationId)).toHaveLength(0);
    });

    it('an unknown ticket ⇒ 201 and no row', async () => {
      const organizationId = await registered(registrationBody(nip(), { registryLookupId: 'Z'.repeat(43) }));
      expect(await rowsOf(organizationId)).toHaveLength(0);
    });

    it('an expired ticket ⇒ 201 and no row', async () => {
      const taxId = nip();
      const answer = await lookupId(taxId);
      await h.redis.del(`b2b:org-registry-lookup:v1:ticket:${answer.lookupId}`);
      const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
      expect(await rowsOf(organizationId)).toHaveLength(0);
    });

    it('a ticket read failing ⇒ 201 and no row', async () => {
      const taxId = nip();
      const answer = await lookupId(taxId);
      const redis = h.redis as unknown as { get: (key: string) => Promise<unknown> };
      const original = redis.get;
      redis.get = async (key: string) => {
        if (key.startsWith('b2b:org-registry-lookup:')) throw new Error('ECONNREFUSED');
        return original.call(h.redis, key);
      };
      try {
        const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
        expect(await rowsOf(organizationId)).toHaveLength(0);
      } finally {
        redis.get = original;
      }
    });

    it('a register refused with 409 leaves the ticket usable for the retry', async () => {
      const taxId = nip();
      const answer = await lookupId(taxId);
      const taken = registrationBody(nip());
      await registered(taken);
      const email = (taken['firstUser'] as { email: string }).email;

      const refused = await register(registrationBody(taxId, { registryLookupId: answer.lookupId!, email }));
      expect(refused.statusCode).toBe(409);
      expect(await h.redis.get(`b2b:org-registry-lookup:v1:ticket:${answer.lookupId}`)).not.toBeNull();

      const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
      expect(await rowsOf(organizationId)).toHaveLength(1);
    });

    describe('gus mode', () => {
      beforeEach(async () => {
        await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
      });

      it('found ⇒ unverified / vat_status_not_checked, the White List excluded by setting', async () => {
        const taxId = nip();
        const answer = await lookupId(taxId);
        const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
        const [row] = await rowsOf(organizationId);
        expect(row).toMatchObject({ provider: 'gus_pl', outcome: 'unverified', error_kind: 'vat_status_not_checked' });
        expect(row!.registry_details).toMatchObject({ plSources: 'gus' });
        expect((row!.registry_details as { attempts: unknown[] }).attempts).toContainEqual({
          provider: 'mf_pl',
          outcome: 'skipped',
          errorKind: 'excluded_by_setting',
          durationMs: null,
        });
      });

      it('unavailable ⇒ 201', async () => {
        registryFakes(h).gusPl.force('unavailable');
        const taxId = nip();
        const answer = await lookupId(taxId);
        expect(answer.status).toBe('unavailable');
        await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
      });
    });

    it('a ticket minted under gus_mf and registered after the switch to mf keeps its own sources', async () => {
      const taxId = nip();
      const answer = await lookupId(taxId);
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'mf');
      const organizationId = await registered(registrationBody(taxId, { registryLookupId: answer.lookupId! }));
      const [row] = await rowsOf(organizationId);
      expect(row!.registry_details).toMatchObject({ plSources: 'gus_mf' });
    });
  });
});
