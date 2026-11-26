import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, EmailMailerPort } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { describe, expect, it } from 'vitest';

import type { Organization, OrganizationStatus } from '../entities/organization.entity.js';
import { OrganizationModerationService } from './organization-moderation-service.js';
import type { OrganizationEvents } from './registration-service.js';

/**
 * Issue #1620 — `organization.status_changed.v1` said only where an
 * Organization went. A subscriber reacting to a rejection or a block could not
 * read why, nor which status the Organization left: the reason reached the
 * audit log and the customer e-mail, and the previous status reached nothing.
 * The payload now carries both, additively, on every moderation transition.
 */

type StatusChanged = OrganizationEvents['organization.status_changed.v1'];

const ORG_ID = '11111111-1111-1111-1111-111111111111';

function harness(status: OrganizationStatus): {
  service: OrganizationModerationService;
  emitted: StatusChanged[];
} {
  const organization = {
    id: ORG_ID,
    name: 'Acme Sp. z o.o.',
    version: 3,
    status,
    blockedAt: null,
    blockedReason: null,
    rejectedAt: null,
    rejectedReason: null,
  } as unknown as Organization;
  const em = {
    async transactional<T>(cb: (tem: unknown) => Promise<T>): Promise<T> {
      return cb(em);
    },
    findOne: async () => organization,
    async flush(): Promise<void> {},
  };
  const emitted: StatusChanged[] = [];
  // The event is the moderation Command's (186 T026), dispatched by the bus on commit.
  const events = new EventBus<Record<string, EventBase>>();
  events.on('organization.status_changed.v1', (payload) => {
    emitted.push(payload as unknown as StatusChanged);
  });
  const bus = new CommandBus(
    { em: { fork: () => em } } as unknown as MikroORM,
    { recordWithin: () => ({}) } as unknown as AuditPort,
    events,
  );
  const service = new OrganizationModerationService(
    () => em as unknown as EntityManager,
    { run: (command) => withSystemScope('organizations unit test: status event', () => bus.run(command)) },
    { async send() { return { status: 'sent' }; } } as unknown as EmailMailerPort,
    { async listByOrganization() { return []; } } as unknown as CustomerAccountReadPort,
    async () => 'manual',
  );
  return { service, emitted };
}

describe('organization.status_changed.v1 — reason and previous status (issue #1620)', () => {
  it('a rejection carries the operator\'s reason and the status it left', async () => {
    const h = harness('pending_verification');
    await h.service.reject(ORG_ID, { expectedVersion: 3, reason: 'No tax ID.' });

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      organizationId: ORG_ID,
      newStatus: 'rejected',
      previousStatus: 'pending_verification',
      reason: 'No tax ID.',
    });
  });

  it('a block carries its reason, and a block without one carries null', async () => {
    const withReason = harness('active');
    await withReason.service.block(ORG_ID, { expectedVersion: 3, reason: 'Unpaid invoices.' });
    expect(withReason.emitted[0]).toMatchObject({
      newStatus: 'blocked',
      previousStatus: 'active',
      reason: 'Unpaid invoices.',
    });

    const withoutReason = harness('active');
    await withoutReason.service.block(ORG_ID, { expectedVersion: 3 });
    expect(withoutReason.emitted[0]).toMatchObject({ previousStatus: 'active', reason: null });
  });

  it('an approval and an unblock carry the status they left and no reason', async () => {
    const approved = harness('pending_verification');
    await approved.service.approve(ORG_ID, { expectedVersion: 3 });
    expect(approved.emitted[0]).toMatchObject({
      newStatus: 'active',
      previousStatus: 'pending_verification',
      reason: null,
    });

    const unblocked = harness('blocked');
    await unblocked.service.unblock(ORG_ID, { expectedVersion: 3 });
    expect(unblocked.emitted[0]).toMatchObject({
      newStatus: 'active',
      previousStatus: 'blocked',
      reason: null,
    });
  });
});
