import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { Organization, OrganizationStatus } from '../entities/organization.entity.js';
import {
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from '../services/organization-moderation-errors.js';
import { makeBlockOrganizationCommand } from './block-organization.command.js';

/**
 * `organization.blocked` (`specs/186-aggregate-ports/` T021/T026): an active Organization is blocked, with or without a reason. One audit
 * entry inside the transaction, names and structure only; the event once, on
 * commit. The shared transaction properties (commit failure, optimistic lock,
 * not found, notice ordering) are exercised once, in
 * `approve-organization.command.test.ts`.
 */

const ORG = '00000000-0000-4000-8000-000000186121';
const REASON = 'S186-REASON-21';

function harness(status: OrganizationStatus, overrides: Partial<Organization> = {}) {
  const org = {
    id: ORG,
    status,
    version: 3,
    approvedAt: null,
    approvedByAdminUserId: null,
    blockedAt: null,
    blockedReason: null,
    rejectedAt: null,
    rejectedReason: null,
    deletedAt: null,
    ...overrides,
  } as unknown as Organization;
  const audits: Array<Record<string, unknown>> = [];
  const em = {
    async findOne(_entity: unknown, where: { id: string }) {
      return where.id === ORG ? org : null;
    },
    async flush() {
      org.version += 1;
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const events = new EventBus<Record<string, EventBase>>();
  const emitted: Array<Record<string, unknown>> = [];
  events.on('organization.status_changed.v1', (payload) => {
    emitted.push(payload as unknown as Record<string, unknown>);
  });
  const bus = new CommandBus({ em: { fork: () => em } } as unknown as MikroORM, audit, events);
  const run = (input: Parameters<typeof makeBlockOrganizationCommand>[0]) =>
    withSystemScope('organizations unit test: organization.blocked', () => bus.run(makeBlockOrganizationCommand(input)));
  return { org, audits, emitted, run };
}

describe('organization.blocked (186 T026)', () => {
  it('blocks an active Organization, storing the reason on the row and the event, never in the entry', async () => {
    const h = harness('active');
    await h.run({ organizationId: ORG, expectedVersion: 3, reason: REASON });

    expect(h.org.status).toBe('blocked');
    expect(h.org.blockedAt).toBeInstanceOf(Date);
    expect(h.org.blockedReason).toBe(REASON);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'organization.blocked',
      stateBefore: { status: 'active', hasBlockedReason: false, version: 3 },
      stateAfter: { status: 'blocked', hasBlockedReason: true, version: 4 },
    });
    expect(JSON.stringify(h.audits)).not.toContain(REASON);
    expect(h.emitted).toEqual([
      expect.objectContaining({ newStatus: 'blocked', previousStatus: 'active', reason: REASON }),
    ]);
  });

  it('blocks without a reason, and the event says null', async () => {
    const h = harness('active');
    await h.run({ organizationId: ORG, expectedVersion: 3 });
    expect(h.org.blockedReason).toBeNull();
    expect(h.audits[0]).toMatchObject({ stateAfter: { hasBlockedReason: false } });
    expect(h.emitted).toEqual([expect.objectContaining({ reason: null })]);
  });

  it('refuses every other status with the status guard, and writes nothing', async () => {
    for (const status of ['pending_verification', 'rejected', 'blocked'] as const) {
      const h = harness(status);
      await expect(h.run({ organizationId: ORG, expectedVersion: 3 })).rejects.toBeInstanceOf(
        OrganizationStatusGuardError,
      );
      expect(h.org.status).toBe(status);
      expect(h.audits).toEqual([]);
      expect(h.emitted).toEqual([]);
    }
  });

  it('refuses a stale expected version, and writes nothing', async () => {
    const h = harness('active');
    await expect(h.run({ organizationId: ORG, expectedVersion: 7 })).rejects.toBeInstanceOf(
      OrganizationVersionMismatchError,
    );
    expect(h.org.status).toBe('active');
    expect(h.audits).toEqual([]);
    expect(h.emitted).toEqual([]);
  });
});
