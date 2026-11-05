import type { BackendServerHandle } from './test-server.js';
import type { FakeRegistryClients } from './fake-registry-clients.js';

/**
 * Feature 173 — what the registration-lookup contract tests share
 * (`specs/173-registration-registry-lookup/`): the three settings, the GUS
 * credential, the fakes and the module's Redis keys.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

export const REGISTRY_LOOKUP_SETTINGS = {
  enabled: 'organizations.registration.registry_lookup_enabled',
  gusCredentials: 'organizations.registration.gus_credentials',
  plSources: 'organizations.registration.registry_lookup_pl_sources',
} as const;

export const GUS_TEST_CREDENTIAL = 'organizations-gus-test';
export const GUS_TEST_KEY = 'gus-fake-user-key-0123456789';

export const LOOKUP_URL = '/api/v1/organizations/registry-lookup';
export const OPTIONS_URL = '/api/v1/organizations/registration-options';
export const REGISTER_URL = '/api/v1/organizations/register';

export async function setRegistrySetting(h: BackendServerHandle, code: string, value: unknown): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${code}/value`,
    cookies: ADMIN,
    payload: { scope: 'all', value },
  });
  if (res.statusCode !== 200) throw new Error(`setting ${code} failed: ${res.statusCode} ${res.body}`);
}

/** The GUS credential for an environment, created on first use, then selected. */
export async function configureGusCredential(
  h: BackendServerHandle,
  environment: 'production' | 'test' = 'test',
): Promise<string> {
  const code = `${GUS_TEST_CREDENTIAL}-${environment}`;
  const existing = await h.app.inject({ method: 'GET', url: `/api/v1/admin/credentials/${code}`, cookies: ADMIN });
  if (existing.statusCode !== 200) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      cookies: ADMIN,
      payload: {
        code,
        name: `GUS test credential (${environment})`,
        typeCode: 'organizations_gus_bir',
        providerCode: 'bir11',
        values: { apiKey: GUS_TEST_KEY, environment },
      },
    });
    if (created.statusCode !== 201) throw new Error(`GUS credential failed: ${created.statusCode} ${created.body}`);
  }
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.gusCredentials, code);
  return code;
}

export async function clearGusCredential(h: BackendServerHandle): Promise<void> {
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.gusCredentials, '');
}

/** Switches the lookup on with the given Polish sources. */
export async function enableRegistryLookup(
  h: BackendServerHandle,
  plSources: 'gus_mf' | 'gus' | 'mf' = 'gus_mf',
): Promise<void> {
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, true);
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, plSources);
}

/** Back to the shipped defaults (OD-6: off; `gus_mf`; no credential). */
export async function resetRegistryLookup(h: BackendServerHandle): Promise<void> {
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, false);
  await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus_mf');
  await clearGusCredential(h);
}

export function registryFakes(h: BackendServerHandle): FakeRegistryClients {
  return (h.container.cradle as unknown as { organizationsRegistryClients: FakeRegistryClients })
    .organizationsRegistryClients;
}

/** Drops every key of the lookup's Redis prefix: cached answers, tickets, budgets. */
export async function flushRegistryLookupRedis(h: BackendServerHandle): Promise<void> {
  const keys = await h.redis.keys('b2b:org-registry-lookup:v1:*');
  if (keys.length > 0) await h.redis.del(keys);
}

export async function lookup(
  h: BackendServerHandle,
  taxId: string,
  country = 'PL',
  headers: Record<string, string> = {},
) {
  return h.app.inject({ method: 'POST', url: LOOKUP_URL, headers, payload: { taxId, country } });
}

let registrationSeq = 0;

/** A registration body for a tax ID, unique in everything else. */
export function registrationBody(
  taxId: string,
  overrides: { street?: string; country?: string; registryLookupId?: string; email?: string } = {},
): Record<string, unknown> {
  registrationSeq += 1;
  const stamp = `${Date.now()}${registrationSeq}`;
  return {
    organization: {
      name: `Registry Test ${stamp}`,
      taxId,
      registeredAddress: {
        street: overrides.street ?? 'ul. Zmieniona 7',
        city: 'Warszawa',
        postalCode: '00-950',
        country: overrides.country ?? 'PL',
      },
    },
    firstUser: {
      email: overrides.email ?? `registry-${stamp}@example.test`,
      password: 'a-very-strong-password-123!',
      firstName: 'Anna',
      lastName: 'Nowak',
    },
    acceptedTermsVersion: '1.0.0',
    ...(overrides.registryLookupId !== undefined ? { registryLookupId: overrides.registryLookupId } : {}),
  };
}

/** Spends a registry's budget for the current window through the module's own store. */
export async function exhaustRegistryBudget(h: BackendServerHandle, provider: 'gus_pl' | 'mf_pl' | 'vies'): Promise<void> {
  const store = (
    h.container.cradle as unknown as {
      organizationsRegistryLookupStore: { consumeBudget(provider: string): Promise<boolean> };
    }
  ).organizationsRegistryLookupStore;
  for (let i = 0; i < 1000; i += 1) if (!(await store.consumeBudget(provider))) return;
  throw new Error(`budget for ${provider} never ran out`);
}
