import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { CommandActor } from '../../../src/commands/command.js';
import { HttpError } from '../../../src/http/error-envelope.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { makeSetSystemDefaultChannelCommand } from '../../../src/modules/sales_channels/commands/set-default.command.js';

/**
 * D-51 — moving the `system_default` flag, at the level where the ordering lives.
 *
 * `sales_channels_one_system_default` is a **partial unique index**, and Postgres
 * cannot defer one. So the flag has to leave the old row before it reaches the
 * new one, and "one flush with both rows dirty" is not the same statement order:
 * MikroORM emits the change set in its own order, which puts the promote first
 * often enough to be a production incident and never in a test.
 *
 * These assertions read the state the command had persisted at each flush. The
 * first flush must show the old default already demoted and the target NOT yet
 * promoted — an implementation that flushes once fails here with one flush
 * instead of two, and one that promotes first fails on the recorded values. The
 * database's own verdict on the wrong order is pinned separately, against real
 * Postgres, in `test/integration/sales_channels/set-default-flag-move.test.ts`.
 */

const ACTOR: CommandActor = {
  actorAdminUserId: 'a0000000-0000-4000-8000-000000000001',
  impersonatedCustomerAccountId: null,
  kind: 'admin',
};

function makeChannel(values: {
  id: string;
  code: string;
  systemDefault: boolean;
  active?: boolean;
}): SalesChannel {
  const channel = new SalesChannel();
  channel.id = values.id;
  channel.code = values.code;
  channel.name = { en: values.code };
  channel.languages = ['en'];
  channel.defaultLanguage = 'en';
  channel.currencies = ['EUR'];
  channel.defaultCurrency = 'EUR';
  channel.active = values.active ?? true;
  channel.systemDefault = values.systemDefault;
  channel.version = 1;
  return channel;
}

/**
 * The narrowest EM a Command can run against: enough `findOne` to answer "which
 * row is the target" and "which row holds the flag", plus a `flush` that records
 * what the command had assigned by the time it asked for a write.
 */
function fakeEm(rows: SalesChannel[], flushes: Array<Record<string, boolean>>): EntityManager {
  return {
    async findOne(_entity: unknown, where: Record<string, unknown>) {
      if (typeof where['id'] === 'string') {
        return rows.find((r) => r.id === where['id']) ?? null;
      }
      if (where['systemDefault'] === true) {
        return rows.find((r) => r.systemDefault) ?? null;
      }
      return null;
    },
    async flush() {
      flushes.push(Object.fromEntries(rows.map((r) => [r.code, r.systemDefault])));
    },
  } as unknown as EntityManager;
}

describe('set-default command — demote before promote (D-51)', () => {
  it('flushes the demote before the promote is even assigned', async () => {
    const current = makeChannel({ id: 'id-current', code: 'default', systemDefault: true });
    const target = makeChannel({ id: 'id-target', code: 'shop-b', systemDefault: false });
    const flushes: Array<Record<string, boolean>> = [];
    const em = fakeEm([current, target], flushes);

    const outcome = await makeSetSystemDefaultChannelCommand('id-target').run({
      em,
      actor: ACTOR,
    });

    expect(flushes).toHaveLength(2);
    // The load-bearing assertion: at the first write the flag belongs to nobody.
    expect(flushes[0]).toEqual({ default: false, 'shop-b': false });
    expect(flushes[1]).toEqual({ default: false, 'shop-b': true });
    expect(outcome.result.changed).toBe(true);
    expect(outcome.result.previousDefaultCode).toBe('default');
    expect(outcome.result.channel.code).toBe('shop-b');
    expect(outcome.skipAudit ?? false).toBe(false);
    // Both rows moved, so both optimistic-concurrency counters move with them.
    expect(current.version).toBe(2);
    expect(target.version).toBe(2);
  });

  it('promoting the channel that already holds the flag writes nothing at all', async () => {
    const current = makeChannel({ id: 'id-current', code: 'default', systemDefault: true });
    const other = makeChannel({ id: 'id-other', code: 'shop-b', systemDefault: false });
    const flushes: Array<Record<string, boolean>> = [];
    const em = fakeEm([current, other], flushes);

    const outcome = await makeSetSystemDefaultChannelCommand('id-current').run({
      em,
      actor: ACTOR,
    });

    expect(flushes).toEqual([]);
    expect(outcome.result.changed).toBe(false);
    expect(outcome.result.previousDefaultCode).toBe('default');
    expect(outcome.skipAudit).toBe(true);
    expect(current.version).toBe(1);
  });

  it('refuses an inactive target before touching either row', async () => {
    const current = makeChannel({ id: 'id-current', code: 'default', systemDefault: true });
    const target = makeChannel({
      id: 'id-target',
      code: 'shop-b',
      systemDefault: false,
      active: false,
    });
    const flushes: Array<Record<string, boolean>> = [];
    const em = fakeEm([current, target], flushes);

    await expect(
      makeSetSystemDefaultChannelCommand('id-target').run({ em, actor: ACTOR }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.INACTIVE_SALES_CHANNEL,
    });
    expect(flushes).toEqual([]);
    expect(current.systemDefault).toBe(true);
  });

  it('refuses a target that disappeared between the lookup and the transaction', async () => {
    const current = makeChannel({ id: 'id-current', code: 'default', systemDefault: true });
    const flushes: Array<Record<string, boolean>> = [];
    const em = fakeEm([current], flushes);

    const error = await makeSetSystemDefaultChannelCommand('id-gone')
      .run({ em, actor: ACTOR })
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(404);
    expect(flushes).toEqual([]);
  });
});
