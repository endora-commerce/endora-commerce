import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { Command } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { BulkOperation, type BulkOperationRow } from '../../helpers/package-entities.js';

/**
 * FR-003 co-transactional guarantee against a REAL Postgres (feature 054, T004).
 *
 * A command that commits leaves exactly one audit row + the domain write + one
 * dispatched event. A command that throws leaves NONE of the three — the write,
 * the audit row, and the event all roll back together. The CommandBus runs its
 * own scoped-fork transaction, so these commit for real; each test tags its rows
 * with a unique marker and cleans them up.
 */
const ADMIN_ID = randomUUID();

describe('CommandBus transactional guarantee (feature 054, FR-003) [real DB]', () => {
  let orm: MikroORM;
  let bus: CommandBus;
  let events: EventBus<Record<string, EventBase>>;
  const createdBulkOpIds: string[] = [];

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    events = new EventBus<Record<string, EventBase>>();
    bus = new CommandBus(orm, new AuditLogService(() => orm.em.fork()), events);
  });

  afterEach(async () => {
    const em = orm.em.fork();
    for (const id of createdBulkOpIds.splice(0)) {
      await em.nativeDelete(BulkOperation, { id });
      await em.nativeDelete(AuditLogEntry, { objectId: id });
    }
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function makeBulkOp(em: import('@mikro-orm/postgresql').EntityManager, id: string): BulkOperationRow {
    const op = em.create(BulkOperation, {
      id,
      type: 'cmdbus_test',
      status: 'completed',
      requestedByAdminUserId: ADMIN_ID,
      total: 0,
      payload: { productIds: [], fields: {} },
    });
    em.persist(op);
    return op;
  }

  it('commits: exactly one audit row + the domain write + one dispatched event', async () => {
    const opId = randomUUID();
    createdBulkOpIds.push(opId);
    const dispatched: string[] = [];
    const off = events.on('cmdbus.committed', () => {
      dispatched.push('cmdbus.committed');
    });

    const cmd: Command<{ id: string }> = {
      action: 'cmdbus.test_commit',
      objectType: 'bulk_operation',
      objectId: opId,
      async run({ em }) {
        makeBulkOp(em, opId);
        return { result: { id: opId }, after: { status: 'completed' } };
      },
      event() {
        return {
          eventName: 'cmdbus.committed',
          payload: { eventId: randomUUID(), occurredAt: new Date().toISOString() },
        };
      },
    };

    const result = await bus.run(cmd);
    off();

    expect(result).toEqual({ id: opId });
    const em = orm.em.fork();
    const audits = await em.find(AuditLogEntry, { objectId: opId });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'cmdbus.test_commit',
      objectType: 'bulk_operation',
      stateAfter: { status: 'completed' },
    });
    expect(audits[0]?.actorAdminUserId ?? null).toBeNull(); // system actor
    expect(audits[0]?.stateBefore ?? null).toBeNull();
    expect(await em.findOne(BulkOperation, { id: opId })).not.toBeNull();
    expect(dispatched).toEqual(['cmdbus.committed']);
  });

  it('rolls back: a throwing command leaves no write, no audit row, no event', async () => {
    const opId = randomUUID();
    createdBulkOpIds.push(opId); // cleanup no-op if truly rolled back
    const dispatched: string[] = [];
    const off = events.on('cmdbus.rolledback', () => {
      dispatched.push('cmdbus.rolledback');
    });

    const cmd: Command<null> = {
      action: 'cmdbus.test_rollback',
      objectType: 'bulk_operation',
      objectId: opId,
      async run({ em }) {
        makeBulkOp(em, opId); // written, then rolled back by the throw below
        throw new Error('boom-after-write');
      },
      event() {
        return {
          eventName: 'cmdbus.rolledback',
          payload: { eventId: randomUUID(), occurredAt: new Date().toISOString() },
        };
      },
    };

    await expect(bus.run(cmd)).rejects.toThrow('boom-after-write');
    off();

    const em = orm.em.fork();
    expect(await em.find(AuditLogEntry, { objectId: opId })).toHaveLength(0);
    expect(await em.findOne(BulkOperation, { id: opId })).toBeNull();
    expect(dispatched).toEqual([]);
  });
});
