import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  expectModuleAbsent,
  withModuleOff,
  type OffStateAxis,
  type OffStateProbe,
} from '../../helpers/off-state.js';
import { CrmOpportunity, CrmStatusPropagation } from '../../helpers/package-entities.js';
import {
  changeOrderStatusAsOperator,
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmMappings,
} from '../../helpers/seed-crm.js';

/**
 * `crm` off-state — Constitution XVII item 6
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §6).
 *
 * The module is operator-toggleable: `crm.enabled` is its activation control,
 * and every route it owns is registered through `ctx.routes`, so the gate is
 * applied at the registration seam. This file is what turns that sentence into
 * a measurement, on both axes — deactivated while platform-available, and
 * platform-unavailable — with full restoration after each.
 *
 * **Storefront absence** is answered here rather than probed: the module has no
 * storefront route and contributes no storefront element, by design — a Sales
 * Opportunity is an internal record and nothing customer-facing reads it.
 *
 * The configuration half is driven over `crm.auto_create_from_orders`, an
 * ordinary module setting, because the activation control itself is the one
 * setting that must stay writable while the module is off.
 *
 * Each story that adds a subscriber adds its own case below, positive control
 * first: without one, a subscriber that never worked reads as a successful
 * absence.
 */
describe('crm off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/crm';
  const WORKFLOW_URL = `${API}/workflow`;
  const ID = '00000000-0000-4000-8000-00000000c0de';
  const CHILD = '00000000-0000-4000-8000-00000000c0df';

  /**
   * Every route the module owns, as registered. The gate is applied where the
   * routes are registered, so each of them is refused before its handler, its
   * permission check or its body schema is reached — which is why the ids and
   * bodies the probes carry need not name anything that exists.
   */
  const REGISTERED: ReadonlyArray<{ method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; route: string; payload?: unknown }> = [
    { method: 'GET', route: `${API}/workflow` },
    { method: 'GET', route: `${API}/board` },
    { method: 'GET', route: `${API}/analytics/handling-time` },
    { method: 'GET', route: `${API}/analytics/time-in-status` },
    { method: 'GET', route: `${API}/analytics/rep-effectiveness` },
    { method: 'GET', route: `${API}/analytics/top-opportunities` },
    { method: 'GET', route: `${API}/analytics/average-value` },
    { method: 'GET', route: `${API}/lookups/organizations` },
    { method: 'GET', route: `${API}/lookups/sales-channels` },
    { method: 'GET', route: `${API}/lookups/assignees` },
    { method: 'GET', route: `${API}/lookups/contacts` },
    { method: 'POST', route: `${API}/statuses`, payload: { code: 'off_state', defaultName: 'Off', kind: 'open' } },
    { method: 'PATCH', route: `${API}/statuses/:code`, payload: { defaultName: 'Renamed' } },
    { method: 'DELETE', route: `${API}/statuses/:code` },
    { method: 'PUT', route: `${API}/transitions`, payload: { add: [] } },
    { method: 'PUT', route: `${API}/order-status-mappings`, payload: { mappings: [] } },
    { method: 'GET', route: `${API}/opportunities` },
    { method: 'POST', route: `${API}/opportunities`, payload: { title: 'Off', organizationId: ID, currency: 'PLN' } },
    { method: 'GET', route: `${API}/opportunities/:id` },
    { method: 'PATCH', route: `${API}/opportunities/:id`, payload: { title: 'Off' } },
    { method: 'DELETE', route: `${API}/opportunities/:id` },
    { method: 'POST', route: `${API}/opportunities/:id/transition`, payload: { to: 'qualified' } },
    { method: 'POST', route: `${API}/opportunities/:id/assign`, payload: { adminUserId: null } },
    { method: 'GET', route: `${API}/opportunities/:id/attachments` },
    { method: 'POST', route: `${API}/opportunities/:id/attachments`, payload: { assetId: CHILD } },
    { method: 'DELETE', route: `${API}/opportunities/:id/attachments/:attachmentId` },
    { method: 'POST', route: `${API}/opportunities/:id/attachments/upload` },
    { method: 'GET', route: `${API}/opportunities/:id/comments` },
    { method: 'POST', route: `${API}/opportunities/:id/comments`, payload: { kind: 'note', body: 'Off' } },
    { method: 'PATCH', route: `${API}/opportunities/:id/comments/:commentId`, payload: { body: 'Off' } },
    { method: 'DELETE', route: `${API}/opportunities/:id/comments/:commentId` },
    { method: 'PUT', route: `${API}/opportunities/:id/tags`, payload: { tagIds: [] } },
    { method: 'GET', route: `${API}/tags` },
    { method: 'POST', route: `${API}/tags`, payload: { name: 'Off' } },
    { method: 'PATCH', route: `${API}/tags/:id`, payload: { name: 'Off' } },
    { method: 'DELETE', route: `${API}/tags/:id` },
    { method: 'POST', route: `${API}/opportunities/:id/links`, payload: { documentKind: 'order', documentId: CHILD } },
    { method: 'PATCH', route: `${API}/opportunities/:id/links/:linkId`, payload: { syncStatus: false } },
    { method: 'DELETE', route: `${API}/opportunities/:id/links/:linkId` },
    { method: 'POST', route: `${API}/opportunities/:id/propagations/:propagationId/retry` },
    { method: 'POST', route: `${API}/opportunities/:id/propagations/:propagationId/dismiss` },
  ];

  const ROUTES: OffStateProbe[] = REGISTERED.map(({ method, route, payload }) => ({
    method,
    url: route
      .replace(':id', ID)
      .replace(':linkId', CHILD)
      .replace(':commentId', CHILD)
      .replace(':attachmentId', CHILD)
      .replace(':propagationId', CHILD)
      .replace(':code', 'new'),
    cookies: admin,
    ...(payload === undefined ? {} : { payload }),
  }));

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers while on — the positive control', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: { statuses: Array<{ code: string }> } };
    expect(body.data.statuses.map((status) => status.code)).toContain('new');
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'crm', {
      routes: ROUTES,
      adminPresence: { cookies: admin },
      settingWrite: {
        code: 'crm.auto_create_from_orders',
        value: true,
        cookies: admin,
      },
    });
  });

  /** The command-palette entries the server advertises for this module, in id order. */
  const paletteActionIds = async (): Promise<string[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(response.statusCode, 'the palette registry must answer').toBe(200);
    const body = response.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    return body.data.data
      .filter((action) => action.moduleId === 'crm')
      .map((action) => action.actionId)
      .sort();
  };

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'advertises its palette actions while on and none while %s',
    async (axis) => {
      // The palette's Actions group is resolved by the server, from the
      // manifests, against the effective enabled-set — no admin-side test can
      // see it. Positive control first: a registry answering nothing to anybody
      // would otherwise pass.
      const declared = ['new-opportunity', 'open-crm-analytics', 'open-opportunities', 'open-opportunity-board'];
      expect(await paletteActionIds()).toEqual(declared);
      await withModuleOff('crm', axis, async () => {
        expect(await paletteActionIds()).toEqual([]);
      });
      expect(await paletteActionIds()).toEqual(declared);
    },
  );

  it('answers again once restored', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    const list = await h.app.inject({ method: 'GET', url: `${API}/opportunities`, cookies: admin });
    expect(list.statusCode, list.body).toBe(200);
  });

  describe('the reverse-mapping subscriber (order.status_changed.v1)', () => {
    const statusOf = async (opportunityId: string) =>
      (await h.em().findOneOrFail(CrmOpportunity, { id: opportunityId }, { filters: false })).statusCode;

    const linkedPair = async () => {
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      return { opportunityId: opportunity.id, orderId: order.id };
    };

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      const mapped = await setCrmMappings(h, [
        { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
      ]);
      expect(mapped.statusCode, mapped.body).toBe(200);
    });

    afterAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
    });

    it('moves the Opportunity while on — the positive control', async () => {
      const { opportunityId, orderId } = await linkedPair();
      await changeOrderStatusAsOperator(h, orderId, 'paid');
      expect(await statusOf(opportunityId)).toBe('qualified');
    });

    it('moves nothing and records nothing while deactivated, and moves again once reactivated', async () => {
      const whileOff = await linkedPair();
      await withModuleOff('crm', 'deactivated', async () => {
        await changeOrderStatusAsOperator(h, whileOff.orderId, 'paid');
        expect(await statusOf(whileOff.opportunityId)).toBe('new');
        expect(
          await h.em().count(CrmStatusPropagation, { opportunityId: whileOff.opportunityId }, { filters: false }),
        ).toBe(0);
      });
      // Nothing is replayed: the change made while off stays unanswered.
      expect(await statusOf(whileOff.opportunityId)).toBe('new');

      const after = await linkedPair();
      await changeOrderStatusAsOperator(h, after.orderId, 'paid');
      expect(await statusOf(after.opportunityId)).toBe('qualified');
    });

    it('moves nothing while platform-unavailable', async () => {
      const pair = await linkedPair();
      await withModuleOff('crm', 'platform-unavailable', async () => {
        await changeOrderStatusAsOperator(h, pair.orderId, 'paid');
        expect(await statusOf(pair.opportunityId)).toBe('new');
      });
    });
  });

  it('probes routes that exist — a refused path the module never registered would prove nothing', () => {
    // The positive control for the whole list, without running a single write:
    // every probed method and path is one the composed application routes.
    for (const { method, route } of REGISTERED) {
      expect(h.app.hasRoute({ method, url: route }), `${method} ${route}`).toBe(true);
    }
  });
});
