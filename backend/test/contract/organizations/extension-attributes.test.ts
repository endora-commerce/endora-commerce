import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtensionAttributesSchema } from '@endora-commerce/contracts';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

import { bootAcmeErpInstance, type AcmeErpInstance } from '../../helpers/acme-erp-instance.js';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/178-extensible-columns/` FR-050 – FR-052, US4 (tasks.md T044,
 * `contracts/extension-attributes.md`) — `?extensions=` on the organizations
 * admin detail and list reads.
 *
 * The worked example `acme_erp` is installed into a throwaway instance root and
 * its columns are migrated onto a database of this file's own
 * (`helpers/acme-erp-instance.ts`), so the harness boots the backend's own ORM
 * configuration with the extension's projection in it. Presence is seeded on the
 * registry cache — the axis an installed package's manifest would supply.
 */

let instance: AcmeErpInstance;
let h: BackendServerHandle;
let baseline: string[];
const ids: string[] = [];
const stamp = Date.now().toString().slice(-8);
const SESSION = { b2b_session: 'stub-admin-session' };

const present = (): void => registryCache.__setEnabledForTesting([...baseline, 'acme_erp']);

beforeAll(async () => {
  instance = await bootAcmeErpInstance();
  h = await setupBackendServer();
  baseline = registryCache.enabledIds().filter((id) => id !== 'acme_erp');
  const em = h.em();
  for (let index = 0; index < 50; index += 1) {
    const org = em.create(Organization, {
      name: `Extension Co ${stamp} ${index.toString().padStart(2, '0')}`,
      taxId: `PL178X${stamp}${index.toString().padStart(2, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Kolumnowa 1', city: 'Warszawa', postalCode: '00-178', country: 'PL' },
    });
    em.persist(org);
    ids.push(org.id);
  }
  await em.flush();
  await h.orm.em
    .getConnection()
    .execute(`update "organizations" set "x_acme_erp_erp_code" = 'ERP-' || substr("tax_id", 7) where "id" in (?)`, [
      ids,
    ]);
}, 600_000);

afterAll(async () => {
  registryCache.__setEnabledForTesting(baseline);
  await teardownBackendServer(h);
  await instance.dispose();
});

const get = (url: string) => h.app.inject({ method: 'GET', url, cookies: SESSION });

describe('GET /api/v1/admin/organizations/:id?extensions=', () => {
  it('attaches the named module’s declared values when it exposes the host on admin reads', async () => {
    present();
    const res = await get(`/api/v1/admin/organizations/${ids[3]}?extensions=acme_erp`);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { extensions: unknown } }).data;
    expect(ExtensionAttributesSchema.parse(data.extensions)).toEqual({
      acme_erp: { erpCode: `ERP-${stamp}03`, creditTier: 0, onboardedVia: null },
    });
  });

  it('is byte-identical to today without the parameter', async () => {
    present();
    const res = await get(`/api/v1/admin/organizations/${ids[3]}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('extensions');
    expect(res.body).not.toContain('acme_erp');
  });

  it('omits the module when it is off, unknown or not installed — no error', async () => {
    registryCache.__setEnabledForTesting([...baseline, 'acme_erp'], { deactivated: ['acme_erp'] });
    const off = await get(`/api/v1/admin/organizations/${ids[3]}?extensions=acme_erp`);
    registryCache.__setEnabledForTesting(baseline);
    const absent = await get(`/api/v1/admin/organizations/${ids[3]}?extensions=acme_erp`);
    present();
    const unknown = await get(`/api/v1/admin/organizations/${ids[3]}?extensions=nobody_here`);
    for (const res of [off, absent, unknown]) {
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { extensions: unknown } }).data.extensions).toEqual({});
    }
  });

  it('refuses a malformed parameter', async () => {
    present();
    const res = await get(`/api/v1/admin/organizations/${ids[3]}?extensions=Not-A-Module`);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/admin/organizations?extensions=', () => {
  const listUrl = `/api/v1/admin/organizations?q=${encodeURIComponent(`Extension Co ${stamp}`)}&limit=50`;

  async function queriesOf(url: string): Promise<{ body: string; queries: string[] }> {
    const logger = h.orm.config.getLogger();
    const spy = vi.spyOn(logger, 'logQuery');
    try {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      return { body: res.body, queries: spy.mock.calls.map(([context]) => String(context.query)) };
    } finally {
      spy.mockRestore();
    }
  }

  it('loads 50 records’ extension values with exactly one additional query', async () => {
    present();
    await queriesOf(listUrl); // warm the caches the first request fills
    const without = await queriesOf(listUrl);
    const withParam = await queriesOf(`${listUrl}&extensions=acme_erp`);

    expect(without.queries.filter((query) => query.includes('x_acme_erp_'))).toEqual([]);
    expect(withParam.queries.filter((query) => query.includes('x_acme_erp_'))).toHaveLength(1);
    expect(withParam.queries.length - without.queries.length).toBe(1);

    const records = (JSON.parse(withParam.body) as { data: { id: string; extensions: Record<string, unknown> }[] })
      .data;
    expect(records).toHaveLength(50);
    for (const record of records) {
      expect(record.extensions).toEqual({
        acme_erp: { erpCode: expect.stringMatching(/^ERP-/), creditTier: 0, onboardedVia: null },
      });
    }
    expect(without.body).not.toContain('extensions');
  });
});
