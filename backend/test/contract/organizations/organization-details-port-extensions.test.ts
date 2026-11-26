import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { migrateUpVerified } from '@endora-commerce/platform/db';
import {
  EntityExtensionLoaderRegistry,
  composeModules,
  createEntityExtensionReads,
  createRootContainer,
  entityExtensionDeclarationsFrom,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import type { EntityExtensionReads } from '@endora-commerce/platform/kernel';

import * as acmeLinksBackend from '../../fixtures/installed-packages/mod-acme-links/lib/backend/index.js';
import { manifest as acmeLinksManifest } from '../../fixtures/installed-packages/mod-acme-links/lib/manifest.js';
import { openAcmeLinksInstance, type AcmeLinksInstance } from '../../helpers/acme-links-instance.js';
import { Organization } from '../../helpers/package-entities.js';
import {
  OrganizationDetailsService,
  toOrganizationRecord,
} from '../../../../packages/modules/organizations/src/backend/services/organization-details-port.js';

/**
 * `specs/187-side-table-extensions/` T037 (FR-054 – FR-058, US4) —
 * `OrganizationDetailsPort` with `include: ['extensions.acme_links']`, over the
 * side-table fixture `mod-acme-links` and the loader its `registerModule`
 * registers (`contracts/extension-attributes-read-ports.md` §3, §4).
 *
 * The fixture is migrated onto a clone of the template
 * (`helpers/acme-links-instance.ts`), its module composed through
 * `composeModules` with a real loader registry, and the port is the
 * `organizations` module's own service over the reads service a root registers
 * as `entityExtensionReads`. Without `include` every method answers what it
 * answered before the feature — the row mapped by `toOrganizationRecord`, no
 * `extensions` key, no side-table statement.
 */

const SIDE_TABLE = 'acme_links_organization_refs';
const log = { info: () => {}, warn: () => {}, error: () => {} };
const stamp = Date.now().toString().slice(-8);

let instance: AcmeLinksInstance;
let reads: EntityExtensionReads;
let port: OrganizationDetailsService;
const present = new Set<string>(['organizations', 'acme_links']);
const ids: string[] = [];
const em = (): EntityManager => instance.orm.em.fork() as unknown as EntityManager;

beforeAll(async () => {
  instance = await openAcmeLinksInstance();
  await migrateUpVerified(instance.orm, undefined, () => {});

  const registry = new EntityExtensionLoaderRegistry({
    declarations: entityExtensionDeclarationsFrom([acmeLinksManifest]),
  });
  composeModules(
    [
      {
        id: acmeLinksManifest.id,
        version: acmeLinksManifest.version,
        registerModule: acmeLinksBackend.registerModule,
      },
    ],
    { container: createRootContainer(), eventBus: new EventBus(), log, entityExtensionLoaderRegistry: registry },
  );
  reads = createEntityExtensionReads({ registry, state: { isPresent: (moduleId) => present.has(moduleId) } });
  port = new OrganizationDetailsService(em, reads);

  const seed = em();
  for (let index = 0; index < 50; index += 1) {
    const org = seed.create(Organization, {
      name: `Side Table Co ${stamp} ${index.toString().padStart(2, '0')}`,
      taxId: `PL187S${stamp}${index.toString().padStart(2, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: 'ul. Boczna 1', city: 'Warszawa', postalCode: '00-187', country: 'PL' },
    });
    seed.persist(org);
    ids.push(org.id);
  }
  await seed.flush();
  // Every even organization has a side row; the odd ones have none.
  const even = ids.filter((_, index) => index % 2 === 0);
  await instance.query(
    `insert into "${SIDE_TABLE}" ("organization_id", "external_ref") select id, 'ERP-' || substr(tax_id, 7) from organizations where id = any($1::uuid[])`,
    [even],
  );
}, 600_000);

afterAll(async () => {
  await instance?.dispose();
});

/** The statements a call issued, and its answer. */
async function observed<T>(run: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  const logger = instance.orm.config.getLogger();
  const spy = vi.spyOn(logger, 'logQuery');
  try {
    const result = await run();
    return { result, statements: spy.mock.calls.map(([context]) => String(context.query)) };
  } finally {
    spy.mockRestore();
  }
}

const sideStatements = (statements: readonly string[]): string[] =>
  statements.filter((statement) => statement.includes(SIDE_TABLE));

/** What the port answered before this feature: the row, mapped. */
async function before(id: string) {
  const row = await em().findOneOrFail(Organization, { id });
  return toOrganizationRecord(row as never);
}

const INCLUDE = { include: ['extensions.acme_links'] as const };

describe('OrganizationDetailsPort without include (FR-055)', () => {
  it('findById, findByIds, searchByName and findByTaxId are byte-identical to the row as mapped before', async () => {
    const id = ids[4]!;
    const expected = JSON.stringify(await before(id));
    for (const options of [undefined, {}, { include: [] }]) {
      const { result, statements } = await observed(async () => [
        await port.findById(id, options),
        (await port.findByIds([id], options))[0],
        (await port.searchByName(`Side Table Co ${stamp} 04`, 5, options))[0],
        (await port.findByTaxId(`PL187S${stamp}04`, options))[0],
      ]);
      for (const record of result) expect(JSON.stringify(record)).toBe(expected);
      expect(sideStatements(statements)).toEqual([]);
    }
  });
});

describe('OrganizationDetailsPort with include (FR-054, FR-056)', () => {
  it('attaches the loader’s value under extensions.acme_links on every method, null without a side row', async () => {
    const withRow = ids[4]!;
    const withoutRow = ids[5]!;
    const value = { externalRef: `ERP-${stamp}04` };
    const base = await before(withRow);

    expect(await port.findById(withRow, INCLUDE)).toEqual({ ...base, extensions: { acme_links: value } });
    expect((await port.findById(withoutRow, INCLUDE))?.extensions).toEqual({ acme_links: null });
    expect((await port.findByIds([withRow, withoutRow], INCLUDE)).map((record) => [record.id, record.extensions])).toEqual(
      expect.arrayContaining([
        [withRow, { acme_links: value }],
        [withoutRow, { acme_links: null }],
      ]),
    );
    expect((await port.searchByName(`Side Table Co ${stamp} 04`, 5, INCLUDE))[0]?.extensions).toEqual({
      acme_links: value,
    });
    expect((await port.findByTaxId(`PL187S${stamp}04`, INCLUDE))[0]?.extensions).toEqual({ acme_links: value });
  });

  it('loads 50 records’ values with exactly one statement for the loader', async () => {
    const { result, statements } = await observed(() => port.findByIds(ids, INCLUDE));
    expect(result).toHaveLength(50);
    expect(sideStatements(statements)).toHaveLength(1);
    const byId = new Map(result.map((record) => [record.id, record.extensions]));
    ids.forEach((id, index) => {
      expect(byId.get(id)).toEqual({
        acme_links: index % 2 === 0 ? { externalRef: `ERP-${stamp}${index.toString().padStart(2, '0')}` } : null,
      });
    });
    // The same read through the search method: one statement as well.
    const searched = await observed(() => port.searchByName(`Side Table Co ${stamp}`, 50, INCLUDE));
    expect(searched.result).toHaveLength(50);
    expect(sideStatements(searched.statements)).toHaveLength(1);
  });

  it('refuses an unclaimed include with 422 ENTITY_EXTENSION_UNCLAIMED before the loader runs', async () => {
    const { result, statements } = await observed(() =>
      port.findById(ids[4]!, { include: ['extensions.acme_links', 'extensions.nobody_here'] }).catch((error: unknown) => error),
    );
    expect(result).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.nobody_here', issue: 'unclaimed' }],
    });
    expect(sideStatements(statements)).toEqual([]);
  });

  it('omits the key, and runs no loader, while acme_links is absent (XVII)', async () => {
    present.delete('acme_links');
    try {
      const { result, statements } = await observed(() => port.findById(ids[4]!, INCLUDE));
      expect(JSON.stringify(result)).toBe(JSON.stringify(await before(ids[4]!)));
      expect(sideStatements(statements)).toEqual([]);
    } finally {
      present.add('acme_links');
    }
  });
});
