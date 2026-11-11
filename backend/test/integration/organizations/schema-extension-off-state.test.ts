import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';

import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { bootAcmeErpInstance, type AcmeErpInstance } from '../../helpers/acme-erp-instance.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/178-extensible-columns/` SC-002, FR-052 (tasks.md T043) — a declared
 * extension leaves the core organization write and read paths byte-identical,
 * in every presence state of the declaring module (Constitution XVII: off
 * behaves as never installed).
 *
 * `acme_erp` is installed and its columns migrated onto this file's own
 * database (`helpers/acme-erp-instance.ts`). The same operator journey — create
 * an organization, read it, list it, and the audit row the create wrote — runs
 * three times:
 *
 *  - **absent** — the platform axis off (`platform-unavailable`): the module is
 *    not installed as far as presence knows;
 *  - **installed and off** — the operator axis off (`deactivated`), the case
 *    Constitution XVII names;
 *  - **installed and on**, without `?extensions=`.
 *
 * The three are compared after identifiers and timestamps are normalised, and
 * the core INSERT is compared as SQL: it names no `x_*` column in any state. A
 * platform with no package installed at all is the same as the first state by
 * construction — the core entity never maps the columns (FR-030, OR-2), which
 * the last test asserts on the metadata.
 */

let instance: AcmeErpInstance;
let h: BackendServerHandle;
let channelId: string;
const stamp = Date.now().toString().slice(-8);
const SESSION = { b2b_session: 'stub-admin-session' };

beforeAll(async () => {
  instance = await bootAcmeErpInstance();
  h = await setupBackendServer();
  registryCache.__setEnabledForTesting([...registryCache.enabledIds().filter((id) => id !== 'acme_erp'), 'acme_erp']);
  const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
  channelId = channel.id;
}, 600_000);

afterAll(async () => {
  registryCache.__setEnabledForTesting(registryCache.enabledIds().filter((id) => id !== 'acme_erp'));
  await teardownBackendServer(h);
  await instance.dispose();
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;

/** One journey's observable output, with its own identifiers taken out. */
async function journey(label: string): Promise<{ observed: string; inserts: string[] }> {
  const taxId = `PL178O${stamp}${label}`;
  const name = `Off State Co ${stamp}`;
  const spy = vi.spyOn(h.orm.config.getLogger(), 'logQuery');
  let inserts: string[];
  let created;
  try {
    created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: SESSION,
      payload: {
        name,
        taxId,
        registeredAddress: { street: 'ul. Kolumnowa 3', city: 'Warszawa', postalCode: '00-178', country: 'PL' },
        salesChannelIds: [channelId],
      },
    });
    inserts = spy.mock.calls
      .map(([context]) => String(context.query))
      .filter((query) => /^insert into "organizations"/i.test(query));
  } finally {
    spy.mockRestore();
  }
  expect(created.statusCode, created.body).toBe(201);
  const id = (created.json() as { data: { id: string } }).data.id;
  const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${id}`, cookies: SESSION });
  const list = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/organizations?q=${encodeURIComponent(taxId)}`,
    cookies: SESSION,
  });
  expect(detail.statusCode).toBe(200);
  expect(list.statusCode).toBe(200);
  const audits = await h.em().find(AuditLogEntry, { action: 'organization.create', objectId: id });
  expect(audits).toHaveLength(1);
  const audit = audits[0]!;
  const observed = JSON.stringify({
    created: created.body,
    detail: detail.body,
    list: list.body,
    audit: { action: audit.action, objectType: audit.objectType, before: audit.stateBefore, after: audit.stateAfter },
  })
    .replaceAll(taxId, '<tax-id>')
    .replace(UUID, '<uuid>')
    .replace(ISO, '<timestamp>');
  return { observed, inserts };
}

describe('the core organization paths with acme_erp declared on organizations', () => {
  it('are byte-identical absent, installed-and-off and installed-and-on without ?extensions=', async () => {
    const absent = await withModuleOff('acme_erp', 'platform-unavailable', () => journey('A'));
    const off = await withModuleOff('acme_erp', 'deactivated', () => journey('B'));
    const on = await journey('C');

    expect(off.observed).toBe(absent.observed);
    expect(on.observed).toBe(absent.observed);
    expect(absent.observed).not.toContain('x_acme_erp');
    expect(absent.observed).not.toContain('extensions');

    for (const { inserts } of [absent, off, on]) {
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).not.toMatch(/"x_/);
    }
    expect(off.inserts).toEqual(absent.inserts);
    expect(on.inserts).toEqual(absent.inserts);
  });

  it('keeps the extension columns out of the core entity metadata', () => {
    const meta = h.orm.getMetadata().get(Organization.name);
    expect(meta.props.map((prop) => prop.fieldNames ?? []).flat().filter((field) => field.startsWith('x_'))).toEqual(
      [],
    );
  });
});
