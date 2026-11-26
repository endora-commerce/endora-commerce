/**
 * The route ↔ port parity helper every aggregate write port's contract test
 * uses (`specs/186-aggregate-ports/` T015).
 *
 * Pure: the comparison is driven with observations built by hand, and the
 * measurement reads through a fake connection that answers from in-memory
 * rows, so it runs in the fast unit job.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import {
  expectPortParity,
  observeWrite,
  shapeOf,
  type ParityObservation,
} from '../../helpers/aggregate-port-parity.js';

const entry = (overrides: Partial<ParityObservation['audit'][number]> = {}): ParityObservation['audit'][number] => ({
  action: 'organization.approved',
  objectType: 'organization',
  objectId: 'org-a',
  actorAdminUserId: 'admin-1',
  stateBefore: { status: 'pending_verification', version: 1 },
  stateAfter: { status: 'active', version: 2 },
  ...overrides,
});

const observation = (overrides: Partial<ParityObservation> = {}): ParityObservation => ({
  audit: [entry()],
  hooks: [],
  outbox: [],
  ...overrides,
});

const parity = (route: ParityObservation, port: ParityObservation) =>
  expectPortParity({ viaRoute: async () => route, viaPort: async () => port });

describe('shapeOf', () => {
  it('keeps keys and value kinds, drops values, and ignores key order', () => {
    expect(shapeOf({ b: 'x', a: [1, null], c: { d: true } })).toEqual(
      shapeOf({ c: { d: false }, a: [7, null], b: 'y' }),
    );
    expect(shapeOf({ a: 'x' })).not.toEqual(shapeOf({ a: 1 }));
    expect(shapeOf({ a: 'x' })).not.toEqual(shapeOf({ a: 'x', b: 'y' }));
    expect(shapeOf({ ids: ['a'] })).not.toEqual(shapeOf({ ids: ['a', 'b'] }));
  });
});

describe('expectPortParity', () => {
  it('passes two writes of the same operation on two objects, whatever their ids, values and actors', async () => {
    await expect(
      parity(
        observation(),
        observation({
          audit: [
            entry({
              objectId: 'org-b',
              actorAdminUserId: null,
              stateBefore: { status: 'pending_verification', version: 4 },
              stateAfter: { status: 'active', version: 5 },
            }),
          ],
        }),
      ),
    ).resolves.toMatchObject({ port: { audit: [{ objectId: 'org-b' }] } });
  });

  it('ignores the source a port caller recorded beside the state', async () => {
    await expect(
      parity(
        observation(),
        observation({ audit: [entry({ stateAfter: { status: 'active', version: 2, source: 'erp.sync' } })] }),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses another action, another object type, another entry count or another state shape', async () => {
    for (const port of [
      observation({ audit: [entry({ action: 'organization.update' })] }),
      observation({ audit: [entry({ objectType: 'customer_account' })] }),
      observation({ audit: [entry(), entry()] }),
      observation({ audit: [] }),
      observation({ audit: [entry({ stateBefore: null })] }),
      observation({ audit: [entry({ stateAfter: { status: 'active', version: 2, extra: true } })] }),
    ]) {
      await expect(parity(observation(), port)).rejects.toThrow(/audit entries/);
    }
  });

  it('refuses a different set or order of hooks fired', async () => {
    const route = observation({ hooks: ['a#one', 'b#two'] });
    await expect(parity(route, observation({ hooks: ['a#one'] }))).rejects.toThrow(/command hooks fired/);
    await expect(parity(route, observation({ hooks: ['b#two', 'a#one'] }))).rejects.toThrow(/command hooks fired/);
  });

  it('refuses a missing outbox row or one for another handler, and compares the data by shape', async () => {
    const row = {
      action: 'organization.approved',
      objectType: 'organization',
      hookModule: 'erp',
      hookId: 'notify',
      data: { organizationId: 'org-a' },
    };
    const route = observation({ outbox: [row] });
    await expect(parity(route, observation({ outbox: [{ ...row, data: { organizationId: 'org-b' } }] }))).resolves.toBeDefined();
    await expect(parity(route, observation())).rejects.toThrow(/outbox rows written/);
    await expect(parity(route, observation({ outbox: [{ ...row, hookId: 'other' }] }))).rejects.toThrow(
      /outbox rows written/,
    );
  });

  it('compares the side-effect probe by value', async () => {
    const route = observation({ sideEffects: { notices: 1, events: ['organization.status_changed.v1'] } });
    await expect(
      parity(route, observation({ sideEffects: { notices: 1, events: ['organization.status_changed.v1'] } })),
    ).resolves.toBeDefined();
    await expect(parity(route, observation({ sideEffects: { notices: 0, events: [] } }))).rejects.toThrow(
      /side effects/,
    );
  });

  it('refuses two writes that recorded nothing, rather than calling them equal', async () => {
    await expect(parity(observation({ audit: [] }), observation({ audit: [] }))).rejects.toThrow(
      /the route wrote no audit entry/,
    );
  });

  it('runs the route before the port', async () => {
    const order: string[] = [];
    await expectPortParity({
      viaRoute: async () => {
        order.push('route');
        return observation();
      },
      viaPort: async () => {
        order.push('port');
        return observation();
      },
    });
    expect(order).toEqual(['route', 'port']);
  });
});

/** A connection answering the two reads `observeWrite` makes from in-memory tables. */
function fakeDatabase() {
  const audit: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const em = {
    getConnection: () => ({
      async execute(sql: string, [objectType, objectId]: [string, string]) {
        const table = sql.includes('"audit_log_entries"') ? audit : sql.includes('"command_outbox"') ? outbox : null;
        if (!table) throw new Error(`unexpected statement: ${sql}`);
        return table.filter((row) => row['object_type'] === objectType && row['object_id'] === objectId);
      },
    }),
  } as unknown as EntityManager;
  return { audit, outbox, em: () => em };
}

describe('observeWrite', () => {
  it('answers only what the write added for its object, reading JSON columns either way', async () => {
    const db = fakeDatabase();
    db.audit.push({ id: 'old', action: 'organization.create', object_type: 'organization', object_id: 'org-a', state_before: null, state_after: {} });
    db.audit.push({ id: 'other', action: 'organization.approved', object_type: 'organization', object_id: 'org-z', state_before: null, state_after: {} });
    const fired: string[] = ['earlier#hook'];

    const { result, observation: seen } = await observeWrite(
      { em: db.em, objectType: 'organization', objectId: 'org-a', hooks: () => fired, probe: (r: string) => ({ r }) },
      async () => {
        db.audit.push({
          id: 'new',
          action: 'organization.approved',
          object_type: 'organization',
          object_id: 'org-a',
          actor_admin_user_id: null,
          state_before: '{"status":"pending_verification"}',
          state_after: { status: 'active' },
        });
        db.outbox.push({ id: 'row', action: 'organization.approved', object_type: 'organization', object_id: 'org-a', hook_module: 'erp', hook_id: 'notify', data: '{"organizationId":"org-a"}' });
        fired.push('erp#veto');
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(seen).toEqual({
      audit: [
        {
          action: 'organization.approved',
          objectType: 'organization',
          objectId: 'org-a',
          actorAdminUserId: null,
          stateBefore: { status: 'pending_verification' },
          stateAfter: { status: 'active' },
        },
      ],
      hooks: ['erp#veto'],
      outbox: [{ action: 'organization.approved', objectType: 'organization', hookModule: 'erp', hookId: 'notify', data: { organizationId: 'org-a' } }],
      sideEffects: { r: 'done' },
    });
  });

  it('reads a created object’s id off the result, and answers no side effects without a probe', async () => {
    const db = fakeDatabase();
    const { observation: seen } = await observeWrite(
      { em: db.em, objectType: 'organization', objectId: (created: { id: string }) => created.id },
      async () => {
        db.audit.push({ id: 'c', action: 'organization.create', object_type: 'organization', object_id: 'org-new', state_before: null, state_after: { name: 'x' } });
        return { id: 'org-new' };
      },
    );
    expect(seen.audit.map((e) => e.action)).toEqual(['organization.create']);
    expect(seen.hooks).toEqual([]);
    expect('sideEffects' in seen).toBe(false);
  });
});
