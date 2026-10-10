import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { DemoResetRefusedError } from './refusal.js';
import {
  DemoResetFailedError,
  demoContextWithin,
  runDemoResetTransaction,
} from './reset-transaction.js';
import { DemoRunFailedError } from './runner.js';

describe("a module's demo context inside the reset's transaction (issue #143)", () => {
  const pooled = { name: 'pooled' } as unknown as EntityManager;
  const transactional = { name: 'transactional' } as unknown as EntityManager;
  const context = {
    module: { id: 'catalog', version: '1.0.0' },
    cradle: () => ({ emFactory: () => pooled, catalogService: 'the composed service' }),
  };

  it("answers the body's emFactory with the run's EntityManager", () => {
    const within = demoContextWithin(transactional, () => context)('catalog') as typeof context;
    expect(within.cradle().emFactory()).toBe(transactional);
  });

  it('leaves every other registration, and the rest of the context, as composed', () => {
    const within = demoContextWithin(transactional, () => context)('catalog') as typeof context;
    expect(within.cradle().catalogService).toBe('the composed service');
    expect(within.module).toBe(context.module);
  });

  it('does not change the context it was given', () => {
    demoContextWithin(transactional, () => context)('catalog');
    expect(context.cradle().emFactory()).toBe(pooled);
  });

  it('asks for the context of the module it was asked about', () => {
    const asked: string[] = [];
    demoContextWithin(transactional, (moduleId) => {
      asked.push(moduleId);
      return context;
    })('inventory');
    expect(asked).toEqual(['inventory']);
  });
});

describe('the reset transaction (issue #143)', () => {
  /** An EntityManager over a pool, recording what the transaction is told. */
  function database(options: { sessionGone?: boolean } = {}) {
    const statements: string[] = [];
    const acquired: string[] = [];
    let isolation: unknown;
    const client = {
      acquireConnection: async () => {
        acquired.push('connection');
        return {};
      },
    };
    const original = client.acquireConnection;
    const tx = {
      execute: async (statement: string) => {
        statements.push(statement);
        return statement.includes('pg_backend_pid') ? [{ pid: 4242 }] : [];
      },
    } as unknown as EntityManager;
    const em = {
      getConnection: () => ({ getKnex: () => ({ client }) }),
      transactional: async (
        work: (inner: EntityManager) => Promise<unknown>,
        opts: { isolationLevel?: unknown },
      ) => {
        isolation = opts.isolationLevel;
        return await work(tx);
      },
      execute: async () => [{ n: options.sessionGone === true ? '0' : '1' }],
    } as unknown as EntityManager;
    return { em, tx, client, original, statements, acquired, isolation: () => isolation };
  }

  const foreignKey = Object.assign(new Error('violates foreign key constraint "x_fk" on table "x"'), {
    code: '23503',
  });

  it('is one snapshot with bounded waits, set on the transaction itself', async () => {
    const db = database();
    await runDemoResetTransaction(db.em, async () => 'done', {
      lockTimeoutMs: 5000,
      idleTimeoutMs: 9000,
    });
    expect(db.isolation()).toBe('repeatable read');
    expect(db.statements).toEqual([
      'set local lock_timeout = 5000',
      'set local idle_in_transaction_session_timeout = 9000',
      'select pg_backend_pid() as pid',
    ]);
  });

  it('refuses a second connection asked for inside the run, without sending anything', async () => {
    const db = database();
    const refused = await runDemoResetTransaction(db.em, async () => {
      // What `em.getConnection().execute(…)`, `em.getKnex()` and a fork all
      // come down to: asking the pool.
      await db.client.acquireConnection();
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(DemoResetRefusedError);
    expect((refused as Error).message).toMatch(/wrote outside the reset transaction/);
    expect((refused as Error).message).toMatch(/Nothing has been changed/);
    expect(db.acquired).toEqual([]);
  });

  it('refuses the run even where the body swallowed that refusal and carried on', async () => {
    const db = database();
    await expect(
      runDemoResetTransaction(db.em, async () => {
        await db.client.acquireConnection().catch(() => undefined);
        return 'looks fine';
      }),
    ).rejects.toBeInstanceOf(DemoResetRefusedError);
  });

  it('leaves everybody else, and everything afterwards, their connections', async () => {
    const db = database();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const run = runDemoResetTransaction(db.em, () => held);
    // Another request of the same process, while the reset is running.
    await db.client.acquireConnection();
    release();
    await run;
    await db.client.acquireConnection();
    expect(db.acquired).toHaveLength(2);
    expect(db.client.acquireConnection).toBe(db.original);
  });

  it('presents a foreign-key refusal as a refusal: what refused, and that nothing changed', async () => {
    const refused = (await runDemoResetTransaction(database().em, async () => {
      throw foreignKey;
    }).catch((error: unknown) => error)) as Error;
    expect(refused).toBeInstanceOf(DemoResetRefusedError);
    expect(refused.message).toContain('"x_fk"');
    expect(refused.message).toContain('Nothing has been changed');
    expect(refused.message).toContain('No flag of this command overrides a foreign key');
  });

  it("names the module whose withdrawal the database refused, and unwraps a module's own refusal", async () => {
    const fromModule = (await runDemoResetTransaction(database().em, async () => {
      throw new DemoRunFailedError('organizations', 'reset', foreignKey, true);
    }).catch((error: unknown) => error)) as Error;
    expect(fromModule).toBeInstanceOf(DemoResetRefusedError);
    expect(fromModule.message).toContain("module 'organizations'");

    const declined = new DemoResetRefusedError('[demo] declined');
    await expect(
      runDemoResetTransaction(database().em, async () => {
        throw new DemoRunFailedError('crm', 'reset', declined, true);
      }),
    ).rejects.toBe(declined);
  });

  it('presents a snapshot conflict and a lock wait as refusals too', async () => {
    const conflict = Object.assign(new Error('could not serialize access'), { code: '40001' });
    const locked = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    });
    for (const [error, sentence] of [
      [conflict, /changed by another session.*Run it again/],
      [locked, /waited more than 60 s.*wrote outside the reset transaction/],
    ] as const) {
      const refused = (await runDemoResetTransaction(database().em, async () => {
        throw error;
      }).catch((caught: unknown) => caught)) as Error;
      expect(refused).toBeInstanceOf(DemoResetRefusedError);
      expect(refused.message).toMatch(sentence);
      expect(refused.message).toContain('Nothing has been changed');
    }
  });

  it('says what most likely happened when the database ended an idle reset', async () => {
    const refused = (await runDemoResetTransaction(
      database({ sessionGone: true }).em,
      async () => {
        throw new Error('Connection terminated unexpectedly');
      },
      { lockTimeoutMs: 1000, idleTimeoutMs: 3000 },
    ).catch((error: unknown) => error)) as Error;
    expect(refused).toBeInstanceOf(DemoResetRefusedError);
    expect(refused.message).toMatch(/did nothing for more than 3 s/);
    expect(refused.message).toMatch(/wrote outside the reset transaction/);
  });

  it('keeps the stack of a failure nobody anticipated, and still says nothing changed', async () => {
    const bug = new TypeError('cannot read properties of undefined');
    const failed = (await runDemoResetTransaction(database().em, async () => {
      throw bug;
    }).catch((error: unknown) => error)) as Error;
    expect(failed).toBeInstanceOf(DemoResetFailedError);
    expect(failed.message).toContain('Nothing has been changed');
    expect(failed.stack).toContain('TypeError');
    expect((failed as { cause?: unknown }).cause).toBe(bug);
  });
});
