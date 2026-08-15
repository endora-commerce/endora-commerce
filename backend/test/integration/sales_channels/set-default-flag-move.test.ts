import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import type { CommandActor } from '../../../src/commands/command.js';
import { DefaultChannelReconciler } from '../../../src/kernel/sales-channels/default-channel-reconciler.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { makeSetSystemDefaultChannelCommand } from '../../../src/modules/sales_channels/commands/set-default.command.js';

/**
 * D-51 — moving the `system_default` flag, against real Postgres.
 *
 * Three things this file pins, and only this file can:
 *
 *   1. **The wrong order is not a style preference.** Promoting before demoting
 *      trips `sales_channels_one_system_default`, the partial unique index from
 *      `20260430T170044_core_sales_channels_promote.ts:99`. Postgres has no
 *      deferrable partial unique index, so there is no ordering-agnostic way to
 *      write this — the demote has to hit the table first.
 *   2. **The right order leaves exactly one default.** Never zero (which the boot
 *      reconciler would have to repair), never two (which the index forbids).
 *   3. **The reconciler leaves a moved flag alone.** Its promote branch fires only
 *      when *no* row is default, so an operator's deliberate choice survives the
 *      next boot — including when the demoted row is the one still called
 *      `default`, which is exactly what its tie-break would otherwise pick.
 *
 * The command is run directly on the test transaction rather than through
 * `CommandBus.run`, which forks its own EM and commits outside it. The bus's own
 * contract — one audit row, one event, all-or-nothing — is covered end to end in
 * `test/contract/sales_channels/admin-set-default.contract.test.ts`.
 */
const ACTOR: CommandActor = {
  actorAdminUserId: null,
  impersonatedCustomerAccountId: null,
  kind: 'system',
};

describe('moving the system-default flag (D-51) [real DB]', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  /** Two channels: `default` holds the flag, `shop-b` is the promotion target. */
  async function seedTwoChannels(): Promise<{ def: SalesChannel; other: SalesChannel }> {
    const em = db.em();
    for (const c of await em.find(SalesChannel, {})) em.remove(c);
    await em.flush();

    const def = em.create(SalesChannel, {
      code: 'default',
      name: { en: 'Default' },
      defaultLanguage: 'en',
      defaultCurrency: 'EUR',
      languages: ['en'],
      currencies: ['EUR'],
      isPublic: false,
      active: true,
      systemDefault: true,
      version: 1,
    });
    const other = em.create(SalesChannel, {
      code: 'shop-b',
      name: { en: 'Shop B' },
      defaultLanguage: 'en',
      defaultCurrency: 'EUR',
      languages: ['en'],
      currencies: ['EUR'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush([def, other]);
    return { def, other };
  }

  it('promoting before demoting trips the partial unique index', async () => {
    try {
      const { other } = await seedTwoChannels();
      const em = db.em();
      const conn = em.getConnection();
      const ctx = em.getTransactionContext();

      // A savepoint, so the failed statement does not abort the test transaction.
      await conn.execute('savepoint wrong_order', [], 'run', ctx);
      await expect(
        conn.execute(
          `update "sales_channels" set "system_default" = true where "id" = ?`,
          [other.id],
          'run',
          ctx,
        ),
      ).rejects.toThrow(/sales_channels_one_system_default/);
      await conn.execute('rollback to savepoint wrong_order', [], 'run', ctx);

      // The table is untouched: the constraint failed closed.
      const defaults = await em.find(SalesChannel, { systemDefault: true }, { refresh: true });
      expect(defaults.map((c) => c.code)).toEqual(['default']);
    } finally {
      await db.rollbackTx();
    }
  });

  it('the command moves the flag and leaves exactly one default', async () => {
    try {
      const { def, other } = await seedTwoChannels();
      const em = db.em();

      const outcome = await makeSetSystemDefaultChannelCommand(other.id).run({ em, actor: ACTOR });

      expect(outcome.result.changed).toBe(true);
      expect(outcome.result.previousDefaultCode).toBe('default');

      const defaults = await em.find(SalesChannel, { systemDefault: true }, { refresh: true });
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.id).toBe(other.id);
      expect(await em.findOneOrFail(SalesChannel, { id: def.id })).toMatchObject({
        systemDefault: false,
      });
    } finally {
      await db.rollbackTx();
    }
  });

  it('moves the flag back again — the move is reversible by repeating it', async () => {
    try {
      const { def, other } = await seedTwoChannels();
      const em = db.em();

      await makeSetSystemDefaultChannelCommand(other.id).run({ em, actor: ACTOR });
      const back = await makeSetSystemDefaultChannelCommand(def.id).run({ em, actor: ACTOR });

      expect(back.result.previousDefaultCode).toBe('shop-b');
      const defaults = await em.find(SalesChannel, { systemDefault: true }, { refresh: true });
      expect(defaults.map((c) => c.code)).toEqual(['default']);
    } finally {
      await db.rollbackTx();
    }
  });

  it('the boot reconciler does not take a moved flag back to the channel coded "default"', async () => {
    try {
      const { other } = await seedTwoChannels();
      const em = db.em();
      await makeSetSystemDefaultChannelCommand(other.id).run({ em, actor: ACTOR });

      // Exactly the call `composition.ts` makes on every boot.
      const result = await new DefaultChannelReconciler(() => em).run();

      expect(result.action).toBe('no_change');
      expect(result.systemDefault?.code).toBe('shop-b');
      const defaults = await em.find(SalesChannel, { systemDefault: true }, { refresh: true });
      expect(defaults.map((c) => c.code)).toEqual(['shop-b']);
    } finally {
      await db.rollbackTx();
    }
  });
});
