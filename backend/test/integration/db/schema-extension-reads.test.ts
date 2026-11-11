import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSchemaExtensionReads, migrateUpVerified } from '@endora-commerce/platform/db';

import {
  ORG_HOST_TABLE,
  HOST_TABLE,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-051, FR-052 (tasks.md T026) — the
 * platform's extension attributes on admin reads, over the fixture host.
 */

const exposed = declare({
  adminReads: true,
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true },
    syncedAt: { type: 'timestamptz', nullable: true },
  },
});
const unexposed = declare({ host: ORG_HOST_TABLE, columns: { erpCode: { type: 'text', nullable: true } } });

let db: ThrowawayDatabase;
let orm: MikroORM;
const queries: string[] = [];
let presentModules = new Set(['acme_erp']);
const reads = createSchemaExtensionReads({
  declarations: () => [exposed, unexposed],
  state: { isPresent: (moduleId) => presentModules.has(moduleId) },
});
const ids = Array.from({ length: 50 }, () => randomUUID());

beforeAll(async () => {
  db = await throwawayDatabase();
  orm = await openFixtureOrm(db.url, [exposed, unexposed], { debug: true, logger: (m) => queries.push(m) });
  await migrateUpVerified(orm);
  await db.query(
    `insert into x178_hosts (id, name, x_acme_erp_erp_code, x_acme_erp_synced_at)
     select id, 'n', 'E-' || ord, case when ord = 1 then timestamptz '2026-11-10T10:00:00Z' end
       from unnest($1::uuid[]) with ordinality as t(id, ord)`,
    [ids],
  );
}, 60_000);

afterAll(async () => {
  await orm.close(true);
  await db.drop();
});

beforeEach(() => {
  queries.length = 0;
  presentModules = new Set(['acme_erp']);
});

const selects = (): string[] => queries.filter((q) => q.toLowerCase().includes('select'));

describe('schemaExtensionReads.attach', () => {
  it('attaches the exposed values to 50 records with exactly one query', async () => {
    const records = ids.map((id) => ({ id }));
    const map = await reads.attach(orm.em.fork(), HOST_TABLE, records, ['acme_erp']);
    expect(selects()).toHaveLength(1);
    expect(map.size).toBe(50);
    expect(map.get(ids[0]!)).toEqual({
      acme_erp: { erpCode: 'E-1', syncedAt: '2026-11-10T10:00:00.000Z' },
    });
    expect(map.get(ids[1]!)).toEqual({ acme_erp: { erpCode: 'E-2', syncedAt: null } });
  });

  it('omits a module that does not expose the host on admin reads', async () => {
    const map = await reads.attach(orm.em.fork(), ORG_HOST_TABLE, [{ id: randomUUID() }], ['acme_erp']);
    expect(map.size).toBe(0);
    expect(selects()).toEqual([]);
  });

  it('omits a module that is off, as if it were never installed', async () => {
    presentModules = new Set();
    const map = await reads.attach(orm.em.fork(), HOST_TABLE, [{ id: ids[0]! }], ['acme_erp']);
    expect(map.size).toBe(0);
    expect(selects()).toEqual([]);
  });

  it('omits an unknown or undeclared module without an error', async () => {
    const map = await reads.attach(orm.em.fork(), HOST_TABLE, [{ id: ids[0]! }], ['nobody', 'other_mod']);
    expect(map.size).toBe(0);
  });

  it('issues nothing for an empty page', async () => {
    expect((await reads.attach(orm.em.fork(), HOST_TABLE, [], ['acme_erp'])).size).toBe(0);
    expect(selects()).toEqual([]);
  });
});
