import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { DeliveryMethod, PaymentMethod } from '../../helpers/package-entities.js';

/**
 * A new method whose channel assignment fails is taken back — **also when the
 * module that guards an ordinary delete is switched off**.
 *
 * The method's row is written by a Command and its channel memberships by the
 * sales-channel bridge, on two transactions. When the second fails for a method
 * created in the same request, the creation has to be undone: a row with no
 * membership is offered on every channel, the widest possible outcome of a
 * request that asked for one.
 *
 * The first version of the take-back ran the operator's delete Command, and
 * that Command asks a neighbour whether anything references the method —
 * `shipments` for a delivery method, `payments` for a payment method — refusing
 * with 409 when the neighbour is off, because then nobody can answer. So with
 * the neighbour off the take-back was refused too: the caller got its 500, the
 * new row stayed active with no membership and was listed on every channel, and
 * the audit trail showed a create and nothing after it.
 *
 * A row created in this request cannot be referenced by anything, so the
 * take-back asks nobody. This file holds that over the composed HTTP surface,
 * in exactly the configuration that failed: the neighbour off, the bridge
 * failing at the assignment. The bridge is made to fail by replacing one method
 * on the composed membership service for the duration of the request — a
 * failure no request can be made to produce on demand.
 *
 * (The last resort — the removal itself failing, and the row being left
 * inactive — needs a second injected fault and is held by each module's
 * `routes.channel-assignment.test.ts`.)
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

const KINDS = [
  {
    name: 'delivery',
    neighbour: 'shipments',
    adminPath: '/api/v1/admin/delivery-methods',
    publicPath: '/api/v1/delivery-methods',
    objectType: 'delivery_method',
    body: (code: string, channelId: string): Record<string, unknown> => ({
      code,
      name: { 'en-US': code },
      cost: 1,
      currency: 'PLN',
      adapter: 'manual_courier',
      salesChannelIds: [channelId],
    }),
    countByCode: (h: BackendServerHandle, code: string): Promise<number> =>
      h.em().count(DeliveryMethod, { code }),
  },
  {
    name: 'payment',
    neighbour: 'payments',
    adminPath: '/api/v1/admin/payment-methods',
    publicPath: '/api/v1/payment-methods',
    objectType: 'payment_method',
    body: (code: string, channelId: string): Record<string, unknown> => ({
      name: { 'en-US': code },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      salesChannelIds: [channelId],
    }),
    countByCode: (h: BackendServerHandle, code: string): Promise<number> =>
      h.em().count(PaymentMethod, { code }),
  },
] as const;

describe.each(KINDS)(
  'a new $name method whose channel assignment fails, with `$neighbour` switched off',
  (kind) => {
    let h: BackendServerHandle;
    let channelId: string;

    beforeAll(async () => {
      h = await setupBackendServer();
      channelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;
    });

    afterAll(async () => {
      await teardownBackendServer(h);
    });

    /** Runs `body` with the bridge refusing to replace a membership set. */
    async function withFailingBridge<T>(body: () => Promise<T>): Promise<T> {
      const membership = h.salesChannels.membershipService;
      const original = membership.replaceChannelsForEntity;
      membership.replaceChannelsForEntity = async () => {
        throw new Error('injected: the sales-channel bridge is unavailable');
      };
      try {
        return await body();
      } finally {
        membership.replaceChannelsForEntity = original;
      }
    }

    it('is taken back: no method is left, nothing is listed, and the audit shows the create and its removal', async () => {
      const code = `failed_assignment_${kind.name}`;

      const res = await withModuleOff(kind.neighbour, 'deactivated', () =>
        withFailingBridge(() =>
          h.app.inject({
            method: 'PUT',
            url: `${kind.adminPath}/${code}`,
            cookies: ADMIN,
            payload: kind.body(code, channelId),
          }),
        ),
      );

      // The caller is told the save failed — with the bridge's failure, not
      // with a refusal from a guard the take-back has no business consulting.
      expect(res.statusCode).toBe(500);

      // No row: not active-and-unbound, not anything.
      h.em().clear();
      expect(await kind.countByCode(h, code)).toBe(0);

      // And so nothing a buyer can be offered, on any channel.
      const listed = await h.app.inject({ method: 'GET', url: kind.publicPath });
      expect(listed.statusCode).toBe(200);
      expect(
        (listed.json() as { data: Array<{ code: string }> }).data.map((m) => m.code),
      ).not.toContain(code);

      // The trail reads create, then delete — by the administrator who asked.
      const trail = (await h.em().find(AuditLogEntry, { objectType: kind.objectType }))
        .filter((entry) => {
          const state = (entry.stateAfter ?? entry.stateBefore) as { code?: string } | null;
          return state?.code === code;
        })
        .map((entry) => entry.action)
        .sort();
      expect(trail).toEqual([`${kind.objectType}.create`, `${kind.objectType}.delete`]);
    });

    it('the same request with the bridge working creates the method, bound to the channel', async () => {
      // The control: with the neighbour still off and nothing injected, the
      // create goes through — so the case above is about the failed assignment
      // and not about a create that `$neighbour` being off refuses anyway.
      const code = `working_assignment_${kind.name}`;

      const res = await withModuleOff(kind.neighbour, 'deactivated', () =>
        h.app.inject({
          method: 'PUT',
          url: `${kind.adminPath}/${code}`,
          cookies: ADMIN,
          payload: kind.body(code, channelId),
        }),
      );

      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { salesChannelIds: string[] } }).data.salesChannelIds).toEqual([
        channelId,
      ]);
    });
  },
);
