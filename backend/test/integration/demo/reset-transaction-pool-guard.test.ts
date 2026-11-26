import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';

import { runDemoResetTransaction } from '../../../../packages/platform/src/demo/reset-transaction.js';
import { DemoResetRefusedError } from '../../../../packages/platform/src/demo/refusal.js';

/**
 * The demo reset's "no second connection" guard, on a real MikroORM 7 pool
 * (issue #1866, from #1864 / PR #1890).
 *
 * The guard replaces the pool's `connect` for the length of the run, so a reset
 * body that asks for a connection of its own is refused on the spot. On
 * MikroORM 6 it reached the pool through knex (`getKnex().client`); on 7 that
 * lookup finds nothing, and a guard that found nothing used to skip itself —
 * silently inert. The unit test (`reset-transaction.test.ts`) pins the
 * mechanism over a fake; this pins that the fake's shape is the one MikroORM 7
 * really has. **If the guard is inert, the first case fails**: the bare
 * connection's statement runs, the body returns, and the reset commits.
 */
describe('the demo reset guard over a real pool (#1866)', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({ entities: [], discovery: { warnWhenNoEntities: false }, clientUrl: process.env['DATABASE_URL']!, allowGlobalContext: true });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it('refuses a statement a reset body sends on the bare connection, before it is sent', async () => {
    let ran = false;
    const outcome = await runDemoResetTransaction(orm.em, async () => {
      // No transaction context: this asks the pool for a second connection.
      await orm.em.getConnection().execute('select 1');
      ran = true;
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(DemoResetRefusedError);
    expect((outcome as Error).message).toMatch(/wrote outside the reset transaction/);
    expect(ran).toBe(false);
  });

  it('refuses a fork, which is a connection of its own too', async () => {
    const outcome = await runDemoResetTransaction(orm.em, async () => {
      await orm.em.fork().execute('select 1');
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(DemoResetRefusedError);
  });

  it('lets the body write through the transaction it was handed, and gives the pool back afterwards', async () => {
    const answer = await runDemoResetTransaction(orm.em, async (tx) => {
      const [row] = await tx.execute<{ n: number }[]>('select 1 as n');
      return row?.n;
    });
    expect(answer).toBe(1);
    // Outside a run the pool is the pool again.
    await expect(orm.em.getConnection().execute('select 1')).resolves.toBeDefined();
  });
});
