import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type OrganizationCommandPort,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';

import { EXAMPLE_ERP_KEYS_ERROR_CODES } from '../../../src/apps/example/modules/example_erp_keys/manifest.js';
import type { ExampleErpKeysPort } from '../../../src/apps/example/modules/example_erp_keys/ports.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { deploymentDatabase, type DeploymentDatabase } from '../../helpers/deployment-database.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `example_erp_keys`, the reference overlay, through a composed server on the
 * deployment's own database (`specs/190-overlay-full-modules/` US8, FR-095,
 * T120, T123 C-4; `specs/conventions/module-activation.md` item 6).
 *
 * The module keeps one external ERP key per Organization in a side table it
 * declares on `organizations.Organization` (`specs/187-side-table-extensions/`).
 * A server-side caller — an ERP import — creates an Organization through
 * `organizationCommandPort.create` with `extensions.example_erp_keys.erpKey`;
 * the module's `beforeCommit` hook writes the side row inside that Command, so
 * a refused key rolls the whole create back. A reader asks
 * `organizationDetailsPort` for `include: ['extensions.example_erp_keys']`.
 *
 * As `overlay-notes-fixture-off-state.test.ts` sets out, the server runs on the
 * deployment's template (`deploymentDatabase`), selected in-process before the
 * server opens its ORM: the run's bare-core database has no such table.
 */
const DEPLOYMENT = 'example';
const MODULE_ID = 'example_erp_keys';
const KEYS = '/api/v1/admin/example-erp-keys/keys';
const ADMIN = { b2b_session: 'stub-admin-session' };
/** Seeded with `orders:read` only — no `example_erp_keys:read`. */
const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };
const INCLUDE = { include: ['extensions.example_erp_keys' as const] };

let database: DeploymentDatabase;
let h: BackendServerHandle;
let organizations: OrganizationCommandPort;
let details: OrganizationDetailsPort;
let channel: string;
const restore: Record<string, string | undefined> = {};
const stamp = Date.now().toString().slice(-8);
let seq = 0;

/** The organization with an ERP key, and one without. */
let keyed: string;
let unkeyed: string;
const KEY = `SAP-${stamp}`;

const taxId = (): string => `PL190E${stamp}${(seq++).toString().padStart(3, '0')}`;
const asImport = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: ERP key import', fn);
const inOrganization = (organizationId: string): TenantContext => ({
  mode: 'single-org',
  organizationId,
  actor: { kind: 'admin', id: 'example-erp-keys-test' },
});

function input(name: string) {
  return {
    name,
    taxId: taxId(),
    registeredAddress: { street: 'ul. Magazynowa 4', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
    salesChannelIds: [channel] as [string],
    status: 'active' as const,
  };
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
  }
  throw new Error('expected a refusal');
}

const port = (): ExampleErpKeysPort => h.container.resolve<ExampleErpKeysPort>('exampleErpKeysPort');

async function paletteActions(cookies: Record<string, string>): Promise<string[]> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/admin-actions?language=en', cookies });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
  return body.data.data.filter((action) => action.moduleId === MODULE_ID).map((action) => action.actionId);
}

beforeAll(async () => {
  database = await deploymentDatabase(DEPLOYMENT);
  for (const name of ['DEPLOYMENT', 'DATABASE_URL']) restore[name] = process.env[name];
  process.env['DEPLOYMENT'] = DEPLOYMENT;
  process.env['DATABASE_URL'] = database.url;
  h = await setupBackendServer({ deployment: DEPLOYMENT });
  organizations = h.container.resolve<OrganizationCommandPort>('organizationCommandPort');
  details = h.container.resolve<OrganizationDetailsPort>('organizationDetailsPort');
  channel = (await h.em().fork().findOneOrFail(SalesChannel, { code: 'default' })).id;

  keyed = (
    await asImport(() =>
      organizations.create(input(`ERP keyed ${stamp}`), { extensions: { [MODULE_ID]: { erpKey: ` ${KEY.toLowerCase()} ` } } }),
    )
  ).id;
  unkeyed = (await asImport(() => organizations.create(input(`ERP unkeyed ${stamp}`)))).id;
}, 180_000);

afterAll(async () => {
  if (h) await teardownBackendServer(h);
  for (const [name, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await database?.drop();
});

describe('example_erp_keys fills its side table from a hook on organization.create [integration]', () => {
  it('stored the normalised key inside the create, and named the field — never the value — in the core entry', async () => {
    expect(await asImport(() => port().keyOf(keyed))).toBe(KEY);
    const [entry] = await h.em().fork().find(AuditLogEntry, { action: 'organization.create', objectId: keyed });
    expect(entry?.stateAfter).toMatchObject({ extensions: { [MODULE_ID]: { changedFields: ['erpKey'] } } });
    expect(JSON.stringify(entry?.stateAfter)).not.toContain(KEY);
  });

  it('left a create without the extension untouched', async () => {
    expect(await asImport(() => port().keyOf(unkeyed))).toBeNull();
  });

  it('refuses a key another organization holds, case-insensitively, and the whole create rolls back', async () => {
    const duplicate = input(`ERP duplicate ${stamp}`);
    const answer = await refusal(
      asImport(() => organizations.create(duplicate, { extensions: { [MODULE_ID]: { erpKey: KEY.toLowerCase() } } })),
    );
    expect(answer).toEqual({ statusCode: 409, code: EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_TAKEN });
    expect(await asImport(() => details.findByTaxId(duplicate.taxId))).toEqual([]);
  });

  it('refuses a malformed key with its own 422 before the Organization commits', async () => {
    const malformed = input(`ERP malformed ${stamp}`);
    const answer = await refusal(
      asImport(() => organizations.create(malformed, { extensions: { [MODULE_ID]: { erpKey: 'two words' } } })),
    );
    expect(answer).toEqual({ statusCode: 422, code: EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_INVALID });
    expect(await asImport(() => details.findByTaxId(malformed.taxId))).toEqual([]);
  });
});

describe('the extension attribute, read through the organizations read port (T123 C-4)', () => {
  it('attaches the value under extensions.example_erp_keys when include names the module', async () => {
    const [withKey, withoutKey] = await asImport(() => details.findByIds([keyed, unkeyed], INCLUDE));
    const byId = new Map([withKey, withoutKey].map((record) => [record!.id, record!]));
    expect(byId.get(keyed)?.extensions).toEqual({ [MODULE_ID]: { erpKey: KEY } });
    expect(byId.get(unkeyed)?.extensions).toEqual({ [MODULE_ID]: null });
  });

  it('answers exactly as core does without include', async () => {
    const record = await asImport(() => details.findById(keyed));
    expect(record).not.toBeNull();
    expect(record).not.toHaveProperty('extensions');
  });
});

describe('another organization cannot see the key (Principle XI)', () => {
  it('the port answers the owner and "not found" to anyone else', async () => {
    expect(await runWithTenantContext(inOrganization(keyed), () => port().keyOf(keyed))).toBe(KEY);
    expect(await runWithTenantContext(inOrganization(keyed), () => port().organizationIdOf(KEY))).toBe(keyed);
    expect(await runWithTenantContext(inOrganization(unkeyed), () => port().keyOf(keyed))).toBeNull();
    expect(await runWithTenantContext(inOrganization(unkeyed), () => port().organizationIdOf(KEY))).toBeNull();
  });

  it('the loader reads in the caller’s scope: a host record another organization may read carries no key', async () => {
    // `Organization` is a global entity, so the host read answers; the side
    // table is organization-scoped, so the loader — handed the record, never a
    // wider scope — finds nothing for it.
    const record = await runWithTenantContext(inOrganization(unkeyed), () => details.findById(keyed, INCLUDE));
    expect(record?.id).toBe(keyed);
    expect(record?.extensions).toEqual({ [MODULE_ID]: null });
  });
});

describe('the admin surface', () => {
  it('lists the keys, looked up by a key typed in any case', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${KEYS}?erpKey=${encodeURIComponent(KEY.toLowerCase())}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([
      { organizationId: keyed, organizationName: `ERP keyed ${stamp}`, erpKey: KEY },
    ]);
  });

  it('refuses an administrator without example_erp_keys:read', async () => {
    const res = await h.app.inject({ method: 'GET', url: KEYS, cookies: RESTRICTED });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('advertises its palette action to an administrator holding the permission, and hides it from one who does not (XVI)', async () => {
    expect(await paletteActions(ADMIN)).toEqual(['open-example-erp-keys']);
    expect(await paletteActions(RESTRICTED)).toEqual([]);
  });
});

describe('example_erp_keys while it is off [integration]', () => {
  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, MODULE_ID, {
      routes: [{ url: KEYS, cookies: ADMIN }],
      adminPresence: { cookies: ADMIN },
    });
  });

  it('withdraws its palette action, its hook and its extension attribute — and keeps its rows', async () => {
    await withModuleOff(MODULE_ID, 'deactivated', async () => {
      expect(await paletteActions(ADMIN)).toEqual([]);
      // No present module claims the key: refused as if the module were never installed.
      const off = input(`ERP while off ${stamp}`);
      expect(
        await refusal(asImport(() => organizations.create(off, { extensions: { [MODULE_ID]: { erpKey: 'OFF-1' } } }))),
      ).toMatchObject({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
      // A read naming it answers as core does: the key is absent, not null.
      const record = await asImport(() => details.findById(keyed, INCLUDE));
      expect(record).not.toHaveProperty('extensions');
    });
    // Off is not uninstall: the key written before is still there.
    expect(await asImport(() => port().keyOf(keyed))).toBe(KEY);
    expect(await paletteActions(ADMIN)).toEqual(['open-example-erp-keys']);
  });
});
