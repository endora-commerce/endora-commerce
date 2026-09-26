import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Migration20260819T155150AdminUsersFoldEmailCase } from '@endora-commerce/mod-admin-users/migrations';

/**
 * The backfill's collision policy, executed rather than described.
 *
 * The measured collision count on both developer databases is zero, so the
 * migration's interesting branch would otherwise ship untested and be met for
 * the first time on somebody's data. Here the colliding rows are built on
 * purpose and the migration's own SQL is run over them — the statements come
 * from the migration class, not from a copy of them in this file, so a change
 * to the policy shows up here.
 *
 * The rows are written through `em.create`, which is deliberately below the
 * services: the whole point is a row in the state the code can no longer
 * produce.
 */
describe('admin_users — folding e-mail case over existing rows', () => {
  let h: BackendServerHandle;

  const SUFFIX = '@admin-fold-migration-test.example';

  async function runMigration(): Promise<void> {
    const em = h.em();
    const migration = new Migration20260819T155150AdminUsersFoldEmailCase(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
    em.clear();
  }

  async function seed(email: string, createdAt: string): Promise<string> {
    const em = h.em();
    const admin = em.create(AdminUser, {
      email,
      passwordHash: 'not-a-real-hash',
      firstName: 'Fold',
      lastName: 'Fixture',
    });
    await em.persistAndFlush(admin);
    // `onCreate` stamps `createdAt`, and the tie-break under test is precisely
    // that column, so it is set explicitly afterwards.
    await em.execute('update admin_users set created_at = ? where id = ?', [createdAt, admin.id]);
    em.clear();
    return admin.id;
  }

  async function emailOf(id: string): Promise<string> {
    const row = await h.em().findOne(AdminUser, { id });
    expect(row, `fixture ${id} still exists`).not.toBeNull();
    return row!.email;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Scoped to this file's fixtures — the table is shared with every other
    // integration file in the run.
    await h.em().execute('delete from admin_users where email ilike ?', [`%${SUFFIX}`]);
    await teardownBackendServer(h);
  });

  it('folds a mixed-case address that collides with nothing', async () => {
    const id = await seed(`Operator.Mixed${SUFFIX}`, '2026-01-01T00:00:00Z');

    await runMigration();

    expect(await emailOf(id)).toBe(`operator.mixed${SUFFIX}`);
  });

  it('leaves the address with the row that already holds it, and drops nobody', async () => {
    // The already-folded row is the *younger* one on purpose: holding the
    // address beats being first, because that is the row every audit entry and
    // every assignment resolved through the address has been pointing at.
    const mixed = await seed(`Twin${SUFFIX}`, '2026-01-01T00:00:00Z');
    const folded = await seed(`twin${SUFFIX}`, '2026-02-01T00:00:00Z');

    await runMigration();

    expect(await emailOf(folded)).toBe(`twin${SUFFIX}`);
    expect(await emailOf(mixed), 'the loser keeps its spelling rather than vanishing').toBe(
      `Twin${SUFFIX}`,
    );
  });

  it('gives a collision with no folded row to the earliest-created operator', async () => {
    const earliest = await seed(`Pair${SUFFIX}`, '2026-01-01T00:00:00Z');
    const later = await seed(`PAIR${SUFFIX}`, '2026-03-01T00:00:00Z');

    await runMigration();

    expect(await emailOf(earliest)).toBe(`pair${SUFFIX}`);
    expect(await emailOf(later)).toBe(`PAIR${SUFFIX}`);
  });

  it('is idempotent — a second run changes nothing', async () => {
    const id = await seed(`Rerun${SUFFIX}`, '2026-01-01T00:00:00Z');

    await runMigration();
    const afterFirst = await emailOf(id);
    await runMigration();

    expect(await emailOf(id)).toBe(afterFirst);
  });
});
