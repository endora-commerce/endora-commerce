import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { OptimisticLockError } from '@mikro-orm/core';
import type { CustomerAccountReadPort, EmailMailerPort } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import type { Organization, OrganizationStatus } from '../entities/organization.entity.js';
import {
  OrganizationNotFoundError,
  OrganizationStatusGuardError,
  OrganizationVersionMismatchError,
} from '../services/organization-moderation-errors.js';
import { OrganizationModerationService } from '../services/organization-moderation-service.js';
import { makeApproveOrganizationCommand } from './approve-organization.command.js';

/**
 * `organization.approved` (`specs/186-aggregate-ports/` T021/T026). The
 * transition used to commit, then audit by hand, then emit — an audit write
 * that failed left an approval nobody had recorded. As a Command it runs
 * through the real {@link CommandBus} here, over a fake ORM whose transaction
 * holds the audit entries until it commits, so what is checked is what a
 * commit or a rollback leaves behind.
 */

const ORG = '00000000-0000-4000-8000-000000186101';
const ADMIN = '00000000-0000-4000-8000-000000186102';
const ADMIN_ROLE = '00000000-0000-4000-8000-000000186103';

function organization(status: OrganizationStatus): Organization {
  return {
    id: ORG,
    name: 'S186-NAME',
    status,
    version: 3,
    approvedAt: null,
    approvedByAdminUserId: null,
    blockedAt: null,
    blockedReason: null,
    rejectedAt: null,
    rejectedReason: null,
    deletedAt: null,
  } as unknown as Organization;
}

interface HarnessOptions {
  status?: OrganizationStatus;
  /** The flush answers an optimistic-lock failure: another write moved the row. */
  lockFailure?: boolean;
  /** The commit itself fails, after the Command's `run` succeeded. */
  failCommit?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const org = organization(options.status ?? 'pending_verification');
  const committed: Array<Record<string, unknown>> = [];
  let pending: Array<Record<string, unknown>> = [];
  const outOfTransaction: Array<Record<string, unknown>> = [];
  const em = {
    async findOne(_entity: unknown, where: { id?: string; organizationId?: string }) {
      if (where.organizationId === ORG) return { id: ADMIN_ROLE };
      return where.id === ORG ? org : null;
    },
    async flush() {
      if (options.lockFailure) throw new OptimisticLockError('the row moved');
      org.version += 1;
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      pending = [];
      const result = await cb(em as unknown as EntityManager);
      if (options.failCommit) {
        pending = [];
        throw new Error('commit failed');
      }
      committed.push(...pending);
      pending = [];
      return result;
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      pending.push(input);
      return {} as never;
    },
    async record(input: Record<string, unknown>) {
      outOfTransaction.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const events = new EventBus<Record<string, EventBase>>();
  const emitted: Array<Record<string, unknown>> = [];
  events.on('organization.status_changed.v1', (payload) => {
    emitted.push(payload as unknown as Record<string, unknown>);
  });
  const bus = new CommandBus(orm, audit, events);
  const sent: string[] = [];
  const order: string[] = [];
  events.on('organization.status_changed.v1', () => {
    order.push('event');
  });
  const mailer = {
    async send(input: { to: string }) {
      sent.push(input.to);
      order.push('notice');
      return { status: 'sent' };
    },
  } as unknown as EmailMailerPort;
  const accounts = {
    async listByOrganization() {
      return [{ email: 'buyer@example.test', organizationRoleId: ADMIN_ROLE }];
    },
  } as unknown as CustomerAccountReadPort;
  const service = new OrganizationModerationService(
    () => em as unknown as EntityManager,
    bus,
    mailer,
    accounts,
    async () => 'auto',
  );
  return { org, committed, outOfTransaction, emitted, bus, service, sent, order };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('organizations unit test: approve', fn);
const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN, 'organizations unit test: approve', fn);

describe('organization.approved (186 T026)', () => {
  it('activates a pending Organization and stamps the ambient administrator', async () => {
    const h = harness();
    await asAdmin(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 })));

    expect(h.org.status).toBe('active');
    expect(h.org.approvedAt).toBeInstanceOf(Date);
    expect(h.org.approvedByAdminUserId).toBe(ADMIN);
    expect(h.committed).toHaveLength(1);
    expect(h.committed[0]).toMatchObject({
      action: 'organization.approved',
      objectType: 'organization',
      objectId: ORG,
      actorAdminUserId: ADMIN,
      stateBefore: { status: 'pending_verification', approvedByAdminUserId: null, version: 3 },
      stateAfter: { status: 'active', approvedByAdminUserId: ADMIN, version: 4 },
    });
    expect(JSON.stringify(h.committed[0])).not.toMatch(/S186/);
  });

  it('records no approving administrator under the system actor', async () => {
    const h = harness();
    await asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG })));
    expect(h.org.approvedByAdminUserId).toBeNull();
    expect(h.committed[0]).toMatchObject({ actorAdminUserId: null, stateAfter: { approvedByAdminUserId: null } });
  });

  it('records its entry inside the transaction, never through the post-commit writer', async () => {
    const h = harness();
    await asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 })));
    expect(h.outOfTransaction).toEqual([]);
  });

  it('refuses another status with the status guard, and writes nothing', async () => {
    for (const status of ['active', 'rejected', 'blocked'] as const) {
      const h = harness({ status });
      await expect(
        asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 }))),
      ).rejects.toBeInstanceOf(OrganizationStatusGuardError);
      expect(h.org.status).toBe(status);
      expect(h.committed).toEqual([]);
      expect(h.emitted).toEqual([]);
    }
  });

  it('refuses a stale expected version, and writes nothing', async () => {
    const h = harness();
    const refused = asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 2 })));
    await expect(refused).rejects.toBeInstanceOf(OrganizationVersionMismatchError);
    await expect(refused).rejects.toMatchObject({ expectedVersion: 2, currentVersion: 3 });
    expect(h.org.status).toBe('pending_verification');
    expect(h.committed).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  it('answers a row that moved before the flush as a version conflict', async () => {
    const h = harness({ lockFailure: true });
    await expect(
      asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 }))),
    ).rejects.toMatchObject({ name: 'OrganizationVersionMismatchError', currentVersion: -1 });
    expect(h.committed).toEqual([]);
  });

  it('answers an unknown or malformed id as not found', async () => {
    const h = harness();
    for (const organizationId of ['00000000-0000-4000-8000-0000001861ff', 'not-a-uuid']) {
      await expect(asSystem(() => h.bus.run(makeApproveOrganizationCommand({ organizationId })))).rejects.toBeInstanceOf(
        OrganizationNotFoundError,
      );
    }
  });

  it('emits organization.status_changed.v1 once on commit, and nothing when the commit fails', async () => {
    const ok = harness();
    await asSystem(() => ok.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 })));
    expect(ok.emitted).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        newStatus: 'active',
        previousStatus: 'pending_verification',
        reason: null,
      }),
    ]);

    const failed = harness({ failCommit: true });
    await expect(
      asSystem(() => failed.bus.run(makeApproveOrganizationCommand({ organizationId: ORG, expectedVersion: 3 }))),
    ).rejects.toThrow('commit failed');
    expect(failed.emitted).toEqual([]);
    expect(failed.committed).toEqual([]);
  });

  it('sends the customer notice after the commit, and none when the transition fails', async () => {
    const ok = harness();
    await asSystem(() => ok.service.approve(ORG, { expectedVersion: 3 }));
    expect(ok.sent).toEqual(['buyer@example.test']);
    expect(ok.order).toEqual(['event', 'notice']);

    const failed = harness({ failCommit: true });
    await expect(asSystem(() => failed.service.approve(ORG, { expectedVersion: 3 }))).rejects.toThrow('commit failed');
    expect(failed.sent).toEqual([]);
  });

  it('approves a newly registered Organization in auto mode as the system, with no ambient scope', async () => {
    const h = harness();
    await h.service.handleNewlyRegistered(ORG);
    expect(h.org.status).toBe('active');
    expect(h.committed).toEqual([
      expect.objectContaining({ action: 'organization.approved', actorAdminUserId: null }),
    ]);
  });
});
