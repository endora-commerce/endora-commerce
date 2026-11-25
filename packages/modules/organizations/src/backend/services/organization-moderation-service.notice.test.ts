import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, EmailMailerPort } from '@endora-commerce/contracts';
import { OrganizationModerationService, type ModerationStatusChange } from './organization-moderation-service.js';

/**
 * `specs/186-aggregate-ports/` research R-16.4 — the customer moderation notice
 * is sent by this module's subscriber of `organization.status_changed.v1`, by
 * the event alone: an approval out of `pending_verification`, and a rejection
 * the caller did not silence (`notifyCustomer`). Block, unblock and a silenced
 * rejection send nothing, and a failure to send never reaches the transition.
 */

const ORG = '00000000-0000-4000-8000-000000186401';
const ADMIN_ROLE = '00000000-0000-4000-8000-000000186402';

function harness(options: { mailerFails?: boolean } = {}) {
  const org = { id: ORG, name: 'Notice Co', version: 4 };
  const reads: Array<Record<string, unknown> | undefined> = [];
  const em = {
    async findOne(entity: { name?: string }, _where: unknown, findOptions?: Record<string, unknown>) {
      if (entity?.name === 'OrganizationRole') return { id: ADMIN_ROLE };
      reads.push(findOptions);
      return org;
    },
  } as unknown as EntityManager;
  const sent: Array<{ messageId: string; subject: string; text: string }> = [];
  const mailer = {
    async send(input: { messageId: string; subject: string; text: string }) {
      if (options.mailerFails) throw new Error('smtp down');
      sent.push(input);
      return { status: 'sent' };
    },
  } as unknown as EmailMailerPort;
  const accounts = {
    async listByOrganization() {
      return [{ email: 'buyer@example.test', organizationRoleId: ADMIN_ROLE }];
    },
  } as unknown as CustomerAccountReadPort;
  const service = new OrganizationModerationService(
    () => em,
    { run: async () => { throw new Error('not used'); } },
    mailer,
    accounts,
    async () => 'manual',
  );
  return { service, sent, reads };
}

const change = (over: Partial<ModerationStatusChange>): ModerationStatusChange => ({
  organizationId: ORG,
  newStatus: 'active',
  previousStatus: 'pending_verification',
  reason: null,
  notifyCustomer: true,
  ...over,
});

describe('OrganizationModerationService.notifyStatusChanged (186 R-16.4)', () => {
  it('sends the approval notice, naming the version the transition left, read fresh', async () => {
    const h = harness();
    await h.service.notifyStatusChanged(change({}));
    expect(h.sent).toEqual([
      expect.objectContaining({ messageId: `organization.approved.${ORG}.4`, subject: 'Your organization has been verified' }),
    ]);
    expect(h.reads).toEqual([{ refresh: true }]);
  });

  it('sends the rejection notice with the reason the event carries', async () => {
    const h = harness();
    await h.service.notifyStatusChanged(change({ newStatus: 'rejected', reason: 'Missing documents' }));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toContain('Missing documents');
  });

  it('sends nothing for a silenced rejection, a block, or an unblock', async () => {
    const h = harness();
    await h.service.notifyStatusChanged(change({ newStatus: 'rejected', reason: 'x', notifyCustomer: false }));
    await h.service.notifyStatusChanged(change({ newStatus: 'blocked', previousStatus: 'active', notifyCustomer: false }));
    await h.service.notifyStatusChanged(change({ newStatus: 'active', previousStatus: 'blocked', notifyCustomer: false }));
    // Even an event that asked for it: unblocking is not an approval.
    await h.service.notifyStatusChanged(change({ newStatus: 'active', previousStatus: 'blocked' }));
    expect(h.sent).toEqual([]);
  });

  it('swallows and logs a failure to send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ mailerFails: true });
    await expect(h.service.notifyStatusChanged(change({}))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
