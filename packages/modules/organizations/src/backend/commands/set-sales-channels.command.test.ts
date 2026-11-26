import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort, MembershipMutationOptions } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { makeSetSalesChannelsCommand } from './set-sales-channels.command.js';

/**
 * `organization.sales_channels.set` (`specs/186-aggregate-ports/` T022, T028;
 * research R-16.1). The replacement runs through the kernel's membership
 * writer on the Command's own `em` — so the writer enlists, and its
 * per-membership entries commit or roll back with this one — and the Command
 * records one `organization` entry of its own, the channel ids before (the
 * writer's own in-transaction read) and after. The same set again changes nothing and records nothing; an unknown
 * Organization and an unknown channel are refused before anything is written,
 * the channel with the code the caller names (R-16.5).
 */

const ORG = '00000000-0000-4000-8000-000000186281';
const CH_A = '00000000-0000-4000-8000-0000001862c1';
const CH_B = '00000000-0000-4000-8000-0000001862c2';
const CH_C = '00000000-0000-4000-8000-0000001862c3';
const ADMIN = '00000000-0000-4000-8000-0000001862d1';

interface WriterCall {
  readonly entityType: string;
  readonly entityId: string;
  readonly channelIds: readonly string[];
  readonly options: MembershipMutationOptions;
}

function harness(options: { assigned?: string[]; deleted?: boolean; writerFails?: unknown } = {}) {
  const org = { id: ORG, deletedAt: options.deleted ? new Date() : null };
  let assigned = [...(options.assigned ?? [CH_A])];
  const channels = new Set([CH_A, CH_B, CH_C]);
  const audits: Array<Record<string, unknown>> = [];
  const writerCalls: WriterCall[] = [];
  const em = {
    async findOne(_entity: unknown, where: { id: string; deletedAt?: null }) {
      if (where.id !== ORG) return null;
      if (where.deletedAt === null && org.deletedAt !== null) return null;
      return org;
    },
    async find(_entity: unknown, where: { id: { $in: string[] } }) {
      return where.id.$in.filter((id) => channels.has(id)).map((id) => ({ id }));
    },
    async flush() {},
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const membership = {
    async replaceChannelsForEntity(
      entityType: string,
      entityId: string,
      channelIds: readonly [string, ...string[]],
      writeOptions: MembershipMutationOptions = {},
    ) {
      writerCalls.push({ entityType, entityId, channelIds: [...channelIds], options: writeOptions });
      if (options.writerFails) throw options.writerFails;
      const desired = [...new Set(channelIds)].sort();
      const current = [...assigned].sort();
      if (desired.length === current.length && desired.every((id, i) => id === current[i])) {
        return { changed: false, previousChannelIds: current };
      }
      assigned = desired;
      return { changed: true, previousChannelIds: current };
    },
  };
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(
    { em: { fork: () => em } } as unknown as MikroORM,
    audit,
    new EventBus<Record<string, EventBase>>(),
  );
  return { em, audits, writerCalls, bus, membership, assigned: () => assigned };
}

describe('organization.sales_channels.set (186 T028, R-16.1)', () => {
  it('replaces the set through the writer on the Command’s em, and records the ids before and after', async () => {
    const h = harness({ assigned: [CH_A] });
    const org = await withSystemScopeActingFor(ADMIN, 'unit test: set sales channels', () =>
      h.bus.run(
        makeSetSalesChannelsCommand({ membership: h.membership }, { organizationId: ORG, salesChannelIds: [CH_C, CH_B] }),
      ),
    );
    expect(org.id).toBe(ORG);
    expect(h.assigned()).toEqual([CH_B, CH_C]);
    expect(h.writerCalls).toEqual([
      {
        entityType: 'organization',
        entityId: ORG,
        channelIds: [CH_C, CH_B],
        options: { em: h.em, actorAdminUserId: ADMIN },
      },
    ]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'organization.sales_channels.set',
        objectType: 'organization',
        objectId: ORG,
        actorAdminUserId: ADMIN,
        stateBefore: { salesChannelIds: [CH_A] },
        stateAfter: { salesChannelIds: [CH_B, CH_C] },
      }),
    ]);
  });

  it('passes the system actor as no administrator', async () => {
    const h = harness();
    await withSystemScope('unit test: set sales channels as the system', () =>
      h.bus.run(makeSetSalesChannelsCommand({ membership: h.membership }, { organizationId: ORG, salesChannelIds: [CH_B] })),
    );
    expect(h.writerCalls[0]!.options).toEqual({ em: h.em, actorAdminUserId: null });
    expect(h.audits[0]).toMatchObject({ actorAdminUserId: null });
  });

  it('records nothing for the set the Organization already has', async () => {
    const h = harness({ assigned: [CH_B, CH_A] });
    await withSystemScope('unit test: same set', () =>
      h.bus.run(
        makeSetSalesChannelsCommand({ membership: h.membership }, { organizationId: ORG, salesChannelIds: [CH_A, CH_B] }),
      ),
    );
    expect(h.writerCalls).toHaveLength(1);
    expect(h.audits).toEqual([]);
  });

  it('refuses an unknown, malformed or deleted Organization with 404, before the writer runs', async () => {
    for (const [organizationId, deleted] of [
      ['00000000-0000-4000-8000-000000000000', false],
      ['not-a-uuid', false],
      [ORG, true],
    ] as const) {
      const h = harness({ deleted });
      await expect(
        withSystemScope('unit test: unknown organization', () =>
          h.bus.run(makeSetSalesChannelsCommand({ membership: h.membership }, { organizationId, salesChannelIds: [CH_B] })),
        ),
      ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND, message: 'Organization not found.' });
      expect(h.writerCalls).toEqual([]);
      expect(h.audits).toEqual([]);
    }
  });

  it('refuses a channel that does not exist with the field path, VALIDATION_FAILED unless the caller names UNKNOWN_SALES_CHANNEL', async () => {
    const unknown = '00000000-0000-4000-8000-00000000beef';
    for (const [code, expected] of [
      [undefined, ERROR_CODES.VALIDATION_FAILED],
      [ERROR_CODES.UNKNOWN_SALES_CHANNEL, ERROR_CODES.UNKNOWN_SALES_CHANNEL],
    ] as const) {
      const h = harness();
      await expect(
        withSystemScope('unit test: unknown channel', () =>
          h.bus.run(
            makeSetSalesChannelsCommand(
              { membership: h.membership },
              { organizationId: ORG, salesChannelIds: [CH_B, unknown], ...(code ? { unknownChannelCode: code } : {}) },
            ),
          ),
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: expected,
        details: [{ path: 'salesChannelIds.1', issue: unknown }],
      });
      expect(h.writerCalls).toEqual([]);
      expect(h.audits).toEqual([]);
      expect(h.assigned()).toEqual([CH_A]);
    }
  });

  it('refuses to guess the previous set when the writer does not answer it', async () => {
    const h = harness();
    const membership = {
      replaceChannelsForEntity: async () => ({ changed: true }),
    };
    await expect(
      withSystemScope('unit test: writer without previous set', () =>
        h.bus.run(makeSetSalesChannelsCommand({ membership }, { organizationId: ORG, salesChannelIds: [CH_B] })),
      ),
    ).rejects.toThrow(/did not answer the set it replaced/);
    expect(h.audits).toEqual([]);
  });

  it('records nothing when the writer refuses', async () => {
    const refusal = Object.assign(new Error('zero channels'), { statusCode: 422 });
    const h = harness({ writerFails: refusal });
    await expect(
      withSystemScope('unit test: writer refuses', () =>
        h.bus.run(makeSetSalesChannelsCommand({ membership: h.membership }, { organizationId: ORG, salesChannelIds: [CH_B] })),
      ),
    ).rejects.toBe(refusal);
    expect(h.audits).toEqual([]);
  });
});
