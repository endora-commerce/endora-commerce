import { describe, expect, it } from 'vitest';
import type { Command } from '@endora-commerce/platform/commands';
import { createMemoryMergeWorld } from './memory-merge-world.js';

/**
 * `specs/192-organization-merge/` T051 – T057 — the in-memory world a
 * participant's co-located conformance test runs its own Command in: an
 * EntityManager over arrays (equality, `$in` and `$ne` filters, `orderBy`,
 * `limit`, `persist` / `remove` / `flush`), and a Command Bus that records the
 * audit entry and rolls the tables back whole when `run` throws.
 */

class Row {
  id = '';
  organizationId: string | null = null;
  rank = 0;
}

class Other {
  id = '';
  label = '';
}

const command = (write: (em: import('@mikro-orm/postgresql').EntityManager) => Promise<void>): Command<number> => ({
  action: 'row.write',
  objectType: 'organization',
  objectId: 's',
  run: async ({ em }) => {
    await write(em);
    return { result: 1, after: { done: true } };
  },
});

describe('createMemoryMergeWorld', () => {
  it('finds, counts, orders and limits by equality, $in and $ne', async () => {
    const world = createMemoryMergeWorld();
    world.insert(Row, { id: 'c', organizationId: 'L', rank: 3 });
    world.insert(Row, { id: 'a', organizationId: 'L', rank: 1 });
    world.insert(Row, { id: 'b', organizationId: 'S', rank: 2 });
    const em = world.emFactory();
    expect(await em.count(Row, { organizationId: 'L' })).toBe(2);
    expect((await em.find(Row, { organizationId: 'L' }, { orderBy: { id: 'asc' }, limit: 1 })).map((r) => r.id)).toEqual(['a']);
    expect((await em.find(Row, { id: { $in: ['a', 'b'] } })).length).toBe(2);
    expect((await em.find(Row, { organizationId: { $ne: 'L' } })).map((r) => r.id)).toEqual(['b']);
    expect((await em.findOne(Row, { id: 'c' }))?.rank).toBe(3);
    expect(await em.findOne(Other, { id: 'x' })).toBeNull();
  });

  it('records one audit entry per Command and applies persist and remove on flush', async () => {
    const world = createMemoryMergeWorld();
    world.insert(Row, { id: 'a', organizationId: 'L' });
    await world.commandBus.run(
      command(async (em) => {
        const [row] = await em.find(Row, { id: 'a' });
        em.remove(row!);
        em.persist(Object.assign(new Other(), { id: 'o', label: 'new' }));
        await em.flush();
      }),
    );
    expect(world.rows(Row)).toEqual([]);
    expect(world.rows(Other).map((o) => o.id)).toEqual(['o']);
    expect(world.audit.entries()).toEqual([
      { action: 'row.write', objectType: 'organization', objectId: 's', stateBefore: null, stateAfter: { done: true } },
    ]);
  });

  it('rolls every table back when the armed flush throws', async () => {
    const world = createMemoryMergeWorld();
    world.insert(Row, { id: 'a', organizationId: 'L' });
    world.injectFailure.arm();
    await expect(
      world.commandBus.run(
        command(async (em) => {
          const [row] = await em.find(Row, { id: 'a' });
          row!.organizationId = 'S';
          em.persist(Object.assign(new Other(), { id: 'o' }));
          await em.flush();
        }),
      ),
    ).rejects.toThrow(/injected/);
    world.injectFailure.disarm();
    expect(world.rows(Row).map((r) => r.organizationId)).toEqual(['L']);
    expect(world.rows(Other)).toEqual([]);
    expect(world.audit.entries()).toEqual([]);
  });

  it('counts the events Commands declare', async () => {
    const world = createMemoryMergeWorld();
    await world.commandBus.run({
      ...command(async () => undefined),
      event: () => ({ eventName: 'x.v1', payload: { eventId: 'e', occurredAt: 'now' } as never }),
    });
    expect(world.events()).toBe(1);
  });
});
