import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerDeliveryMethodsAdminRoutes, type DeliveryMethodsAdminDeps } from './routes.js';

/**
 * A method must never be left **more widely offered than the operator asked**
 * because a later step of the upsert failed.
 *
 * The method's row is written by a Command, on the bus's transaction; its
 * channel memberships are written by the sales-channel bridge, on its own. A
 * failure between the two therefore leaves the row without the assignment —
 * and for this entity type a row with no membership is offered on **every**
 * channel. For a method that was just created, that is the widest possible
 * outcome of a request that asked for one channel.
 *
 * The first line of defence is ahead of the write: an unknown channel id is
 * refused before the Command runs (held over HTTP by
 * `backend/test/contract/methods/sales-channel-availability.contract.test.ts`).
 * This file holds the second, for the failures validation cannot foresee: when
 * the assignment of a **new** method fails, the creation is taken back.
 *
 * It drives the registered `PUT` handler directly, with a bridge that fails on
 * demand — a failure no real database can be asked to produce at the right
 * moment.
 */
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';
const METHOD_ID = '00000000-0000-4000-8000-00000000f00d';

interface Rig {
  put(body: Record<string, unknown>): Promise<unknown>;
  commands: string[];
  logged: unknown[];
}

async function rig(options: {
  existing: boolean;
  membershipFails: boolean;
  deleteFails?: boolean;
  deactivateFails?: boolean;
}): Promise<Rig> {
  const commands: string[] = [];
  const logged: unknown[] = [];
  let handler: ((request: unknown) => Promise<unknown>) | undefined;
  const app = {
    get: () => undefined,
    patch: () => undefined,
    delete: () => undefined,
    put: (_path: string, _opts: unknown, h: (request: unknown) => Promise<unknown>) => {
      handler = h;
    },
  } as unknown as FastifyInstance;

  const row = { id: METHOD_ID, code: 'fail_closed' };
  const deps = {
    emFactory: () => ({
      findOne: async () => (options.existing ? row : null),
      // Every channel the body names exists: validation passes, the bridge is
      // what fails.
      find: async () => [{ id: CHANNEL }],
    }),
    requireAdmin: () => async () => undefined,
    commandBus: {
      run: async (command: { action: string; objectId: string }) => {
        commands.push(`${command.action}:${command.objectId}`);
        if (command.action.endsWith('.delete')) {
          if (options.deleteFails) throw new Error('delete failed');
          return undefined;
        }
        // The first command of a request is the upsert itself; a later
        // `.update` in a request that created the row is the deactivation.
        if (commands.length > 1 && command.action.endsWith('.update')) {
          if (options.deactivateFails) throw new Error('deactivate failed');
          return undefined;
        }
        return { method: row, created: !options.existing };
      },
    },
    salesChannelMembership: {
      replaceChannelsForEntity: async () => {
        if (options.membershipFails) throw new Error('the bridge is unavailable');
        return { changed: true };
      },
      listChannelsForEntity: async () => [{ id: CHANNEL }],
    },
    resolveAuditActor: () => ({ actorAdminUserId: 'admin-1' }),
    countShipmentsForMethod: async () => 0,
  } as unknown as DeliveryMethodsAdminDeps;

  await registerDeliveryMethodsAdminRoutes(app, deps);
  if (!handler) throw new Error('the PUT route was not registered');
  const registered = handler;
  return {
    commands,
    logged,
    put: (body) =>
      registered({
        params: { code: 'fail_closed' },
        body,
        log: { error: (...args: unknown[]) => logged.push(args) },
      }),
  };
}

const BODY = { name: { 'en-US': 'Fail closed' }, cost: 1, currency: 'PLN', adapter: 'manual_courier' };

describe('delivery-method upsert — a failed channel assignment', () => {
  it('takes back a method it had just created, and reports the failure', async () => {
    const r = await rig({ existing: false, membershipFails: true });

    await expect(r.put({ ...BODY, salesChannelIds: [CHANNEL] })).rejects.toThrow(
      'the bridge is unavailable',
    );

    expect(r.commands).toHaveLength(2);
    expect(r.commands[0]).toMatch(/^delivery_method\.create:/);
    expect(r.commands[1]).toBe(`delivery_method.delete:${METHOD_ID}`);
  });

  it('leaves an existing method alone — its assignment is replaced whole or not at all', async () => {
    const r = await rig({ existing: true, membershipFails: true });

    await expect(r.put({ ...BODY, salesChannelIds: [CHANNEL] })).rejects.toThrow(
      'the bridge is unavailable',
    );

    expect(r.commands).toEqual([`delivery_method.update:${METHOD_ID}`]);
  });

  /**
   * The take-back is a removal that asks nobody: the row was created in this
   * request, so nothing can reference it. If the removal fails all the same,
   * the method is set inactive — never left active and bound to nothing.
   */
  it('sets the new method inactive when it cannot be removed, and still reports the original failure', async () => {
    const r = await rig({ existing: false, membershipFails: true, deleteFails: true });

    await expect(r.put({ ...BODY, salesChannelIds: [CHANNEL] })).rejects.toThrow(
      'the bridge is unavailable',
    );

    expect(r.commands).toHaveLength(3);
    expect(r.commands[1]).toBe(`delivery_method.delete:${METHOD_ID}`);
    expect(r.commands[2]).toBe(`delivery_method.update:${METHOD_ID}`);
    expect(r.logged).toHaveLength(1);
  });

  it('says so loudly, and still reports the original failure, when it can be neither removed nor deactivated', async () => {
    const r = await rig({
      existing: false,
      membershipFails: true,
      deleteFails: true,
      deactivateFails: true,
    });

    await expect(r.put({ ...BODY, salesChannelIds: [CHANNEL] })).rejects.toThrow(
      'the bridge is unavailable',
    );

    expect(r.logged).toHaveLength(2);
  });

  it('deletes nothing when the assignment succeeds', async () => {
    const r = await rig({ existing: false, membershipFails: false });

    await r.put({ ...BODY, salesChannelIds: [CHANNEL] });

    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]).toMatch(/^delivery_method\.create:/);
  });
});
