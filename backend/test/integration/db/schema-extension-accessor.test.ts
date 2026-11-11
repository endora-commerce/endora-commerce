import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extensionColumnsWithPresence, migrateUpVerified } from '@endora-commerce/platform/db';
import {
  ExtensionHostRowNotFoundError,
  ExtensionProjectionWriteError,
  ExtensionWriteOutsideCommandError,
  ModuleDisabledError,
} from '@endora-commerce/platform/kernel';

import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  ORG_HOST_TABLE,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-032, FR-033 (tasks.md T024) — the typed,
 * UPDATE-only accessor over a declaration's projection.
 */

const onHost = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
    since: { type: 'date', nullable: true },
    syncedAt: { type: 'timestamptz', nullable: true },
    big: { type: 'bigint', default: '0' },
  },
});
const onOrgHost = declare({ host: ORG_HOST_TABLE, columns: { erpCode: { type: 'text', nullable: true } } });

let db: ThrowawayDatabase;
let orm: MikroORM;
const queries: string[] = [];
const present = { isPresent: (moduleId: string) => moduleId === 'acme_erp' };
const absent = { isPresent: () => false };

const hostA = randomUUID();
const hostB = randomUUID();
const orgA = randomUUID();
const orgB = randomUUID();
const orderOfA = randomUUID();
const orderOfB = randomUUID();

beforeAll(async () => {
  db = await throwawayDatabase();
  orm = await openFixtureOrm(db.url, [onHost, onOrgHost], {
    debug: true,
    logger: (message) => queries.push(message),
  });
  await migrateUpVerified(orm);
  await db.query(`insert into x178_hosts (id, name) values ($1, 'a'), ($2, 'b')`, [hostA, hostB]);
  await db.query(
    `insert into x178_org_hosts (id, organization_id, name, x_acme_erp_erp_code) values ($1, $2, 'oa', 'A'), ($3, $4, 'ob', 'B')`,
    [orderOfA, orgA, orderOfB, orgB],
  );
}, 60_000);

afterAll(async () => {
  await orm.close(true);
  await db.drop();
});

beforeEach(() => {
  queries.length = 0;
});

const sqlOf = (verb: string): string[] =>
  queries.filter((line) => line.toLowerCase().includes(verb)).filter((line) => !line.includes('mikro_orm_migrations'));

describe('extensionColumns', () => {
  it('load issues one fields-limited select and returns typed values', async () => {
    const result = await extensionColumnsWithPresence(present, onHost, orm.em.fork()).load([hostA, hostB]);
    const selects = sqlOf('select');
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('x_acme_erp_erp_code');
    expect(selects[0]).not.toContain('"name"');
    expect(selects[0]).not.toContain('.*');
    expect(result.get(hostA)).toEqual({ erpCode: null, creditTier: 0, since: null, syncedAt: null, big: '0' });
    expect(result.size).toBe(2);
  });

  it('set issues one UPDATE of the changed columns only and returns their sorted names', async () => {
    const em = orm.em.fork();
    const outcome = await em.transactional(async (tx) =>
      extensionColumnsWithPresence(present, onHost, tx).set(hostA, {
        erpCode: 'ERP-42',
        creditTier: 0,
        since: '2026-11-10',
      }),
    );
    expect(outcome).toEqual({ changedFields: ['erpCode', 'since'] });
    const updates = sqlOf('update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/update "x178_hosts" set "x_acme_erp_erp_code" = .*, "x_acme_erp_since" = /);
    expect(updates[0]).not.toContain('credit_tier');
    expect(sqlOf('insert')).toEqual([]);
    const got = await extensionColumnsWithPresence(present, onHost, orm.em.fork()).get(hostA);
    expect(got).toMatchObject({ erpCode: 'ERP-42', since: '2026-11-10' });
  });

  it('set on an unknown id is not found and inserts nothing', async () => {
    const em = orm.em.fork();
    await expect(
      em.transactional((tx) => extensionColumnsWithPresence(present, onHost, tx).set(randomUUID(), { erpCode: 'X' })),
    ).rejects.toBeInstanceOf(ExtensionHostRowNotFoundError);
    expect(sqlOf('insert')).toEqual([]);
  });

  it('set outside a transaction is refused', async () => {
    await expect(
      extensionColumnsWithPresence(present, onHost, orm.em.fork()).set(hostA, { erpCode: 'Y' }),
    ).rejects.toBeInstanceOf(ExtensionWriteOutsideCommandError);
  });

  it('refuses an invalid patch before touching the database', async () => {
    const em = orm.em.fork();
    await expect(
      em.transactional((tx) => extensionColumnsWithPresence(present, onHost, tx).set(hostA, { creditTier: 40000 })),
    ).rejects.toThrow();
    expect(sqlOf('update')).toEqual([]);
  });

  it('fails closed with ModuleDisabledError when the declaring module is off', async () => {
    const accessor = extensionColumnsWithPresence(absent, onHost, orm.em.fork());
    await expect(accessor.load([hostA])).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(accessor.get(hostA)).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(accessor.set(hostA, { erpCode: 'Z' })).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(queries).toEqual([]);
  });

  it('refuses a delete through the projection', async () => {
    const em = orm.em.fork();
    await em.transactional(async (tx) => {
      const accessor = extensionColumnsWithPresence(present, onHost, tx);
      await accessor.load([hostB]);
      const managed = tx.getUnitOfWork().getIdentityMap().values().find((entity) => (entity as { id?: string }).id === hostB);
      expect(managed).toBeDefined();
      tx.remove(managed!);
      await expect(tx.flush()).rejects.toBeInstanceOf(ExtensionProjectionWriteError);
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ExtensionProjectionWriteError);
    });
    const [row] = await db.query(`select 1 from x178_hosts where id = $1`, [hostB]);
    expect(row).toBeDefined();
  });

  it('narrows an org-scoped host to the actor organization (US2 scenario 5)', async () => {
    const result = await runWithTenantContext(
      { mode: 'single-org', organizationId: orgA, actor: { kind: 'admin', id: 'x178-admin' } },
      () => extensionColumnsWithPresence(present, onOrgHost, orm.em.fork()).load([orderOfA, orderOfB]),
    );
    expect([...result.keys()]).toEqual([orderOfA]);
    expect(result.get(orderOfA)).toEqual({ erpCode: 'A' });
  });
});
