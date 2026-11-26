import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogEntry, SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { makeSetSalesChannelsCommand } from '../../../../packages/modules/organizations/src/backend/commands/set-sales-channels.command.js';

/**
 * `organization.sales_channels.set` rolls back as one unit
 * (`specs/186-aggregate-ports/` T028, research R-16.1; issue #1821 US1b). Run as
 * the child of a parent Command that throws after the writer has run, nothing
 * of the replacement survives: no bridge row, no `sales_channel.membership.changed`
 * entry, no `organization.sales_channels.set` entry, and the access cache is not
 * dropped. The same parent without the throw writes all of them, so the
 * assertions cannot pass for a write that never happened.
 */
describe('organization.sales_channels.set inside a parent that fails (#1821)', () => {
  let h: BackendServerHandle;
  let membership: SalesChannelMembershipPort;
  let commandBus: CommandBus;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);

  const resolve = <T>(name: string): T => (h.container as unknown as { resolve<V>(n: string): V }).resolve<T>(name);

  beforeAll(async () => {
    h = await setupBackendServer();
    membership = resolve<SalesChannelMembershipPort>('salesChannelMembershipPort');
    commandBus = resolve<CommandBus>('commandBus');
    const em = h.em().fork();
    const sales = em.create(SalesChannel, {
      code: `sc-rollback-${stamp}`,
      name: { en: 'rollback' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A parent that runs the replacement as its child, then optionally vetoes. */
  const parent = (organizationId: string, veto: boolean): Command<void> => ({
    action: 'test.sales_channels_parent',
    objectType: 'test',
    objectId: randomUUID(),
    run: async (ctx) => {
      if (!ctx.run) throw new Error('the bus always passes run');
      await ctx.run(makeSetSalesChannelsCommand({ membership }, { organizationId, salesChannelIds: [channel] }));
      if (veto) throw new Error('parent veto after the writer');
      return { result: undefined, skipAudit: true };
    },
  });

  async function observe(organizationId: string, veto: boolean) {
    const before = (await membership.listChannelsForEntity('organization', organizationId)).map((c) => c.id).sort();
    const drop = vi.spyOn(h.salesChannels.accessCache, 'invalidateAfterWrite');
    let error: unknown;
    let drops = 0;
    try {
      await withSystemScopeActingFor(TEST_ADMIN_ID, 'test: sales channels rollback', () =>
        commandBus.run(parent(organizationId, veto)),
      );
    } catch (err) {
      error = err;
    } finally {
      // Counted before the restore, which clears the recorded calls.
      drops = drop.mock.calls.filter(([id]) => id === organizationId).length;
      drop.mockRestore();
    }
    const em = h.em().fork();
    return {
      error,
      before,
      after: (await membership.listChannelsForEntity('organization', organizationId)).map((c) => c.id).sort(),
      membershipEntries: await em.count(AuditLogEntry, {
        action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
        objectType: 'sales_channel_membership',
        objectId: { $like: `%:organization:${organizationId}` },
      }),
      commandEntries: await em.count(AuditLogEntry, {
        action: 'organization.sales_channels.set',
        objectType: 'organization',
        objectId: organizationId,
      }),
      drops,
    };
  }

  it('leaves no bridge row, no entry and no cache drop when the parent throws after the writer', async () => {
    const org = await seedAdHocOrganization(h.em().fork(), `Rollback ${stamp} a`);
    const outcome = await observe(org.id, true);
    expect((outcome.error as Error | undefined)?.message).toBe('parent veto after the writer');
    expect(outcome.before).not.toEqual([channel]);
    expect(outcome.after).toEqual(outcome.before);
    expect(outcome.membershipEntries).toBe(0);
    expect(outcome.commandEntries).toBe(0);
    expect(outcome.drops).toBe(0);
  });

  it('writes all of them when the same parent commits (the control)', async () => {
    const org = await seedAdHocOrganization(h.em().fork(), `Rollback ${stamp} b`);
    const outcome = await observe(org.id, false);
    expect(outcome.error).toBeUndefined();
    expect(outcome.after).toEqual([channel]);
    expect(outcome.membershipEntries).toBeGreaterThan(0);
    expect(outcome.commandEntries).toBe(1);
    expect(outcome.drops).toBe(1);
  });
});
