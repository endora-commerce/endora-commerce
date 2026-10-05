import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityWorkflowResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
} from '../../helpers/seed-crm.js';

/**
 * The workflow configuration endpoints
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §4): statuses,
 * transitions and the forward Order-status mappings, each against its schema,
 * each gated `crm:configure`, each refusal with its code.
 */
describe('crm workflow configuration (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const workflow = async () =>
    OpportunityWorkflowResponseSchema.parse((await call('GET', '/workflow')).json()).data;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    viewer = await seedCrmAdmin(h.em(), 'viewer', ['crm:read']);
  });

  afterAll(async () => {
    viewer.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('crm:configure is enforced', () => {
    it.each([
      ['POST', '/statuses', { code: 'gated', defaultName: 'Gated', kind: 'open' }],
      ['PATCH', '/statuses/qualified', { defaultName: 'Renamed' }],
      ['DELETE', '/statuses/qualified', undefined],
      ['PUT', '/transitions', { add: [{ fromStatusCode: 'new', toStatusCode: 'proposal' }] }],
      ['PUT', '/order-status-mappings', { mappings: [] }],
    ] as const)('%s %s answers 403 to a holder of crm:read only', async (method, path, payload) => {
      const response = await call(method, path, payload, viewer.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('leaves the workflow readable to that holder', async () => {
      const response = await call('GET', '/workflow', undefined, viewer.cookies);
      expect(response.statusCode, response.body).toBe(200);
    });

    it('wrote nothing through any of the refused calls', async () => {
      const current = await workflow();
      expect(current.statuses.map((status) => status.code)).not.toContain('gated');
      expect(current.statuses.find((status) => status.code === 'qualified')?.defaultName).toBe('Qualified');
      expect(current.transitions).not.toContainEqual({ fromStatusCode: 'new', toStatusCode: 'proposal' });
    });
  });

  describe('POST /statuses', () => {
    it('creates a status and answers 201 with the workflow', async () => {
      const response = await call('POST', '/statuses', {
        code: 'in_delivery',
        defaultName: 'In delivery',
        name: { en: 'In delivery', pl: 'W dostawie' },
        kind: 'open',
        weight: 50,
        color: '#0ea5e9',
      });
      expect(response.statusCode, response.body).toBe(201);
      const body = OpportunityWorkflowResponseSchema.parse(response.json());
      expect(body.data.statuses.find((status) => status.code === 'in_delivery')).toEqual({
        code: 'in_delivery',
        name: { en: 'In delivery', pl: 'W dostawie' },
        defaultName: 'In delivery',
        kind: 'open',
        isInitial: false,
        weight: 50,
        color: '#0ea5e9',
        inUseCount: 0,
      });
    });

    it('refuses a code that is taken — 409 CRM_STATUS_CODE_TAKEN', async () => {
      const response = await call('POST', '/statuses', { code: 'won', defaultName: 'Won again', kind: 'won' });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_STATUS_CODE_TAKEN');
    });

    it('refuses a body the schema does not accept', async () => {
      const response = await call('POST', '/statuses', { code: 'Not Snake', defaultName: 'x', kind: 'open' });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an initial status that is not open — 422 CRM_WORKFLOW_INVALID naming the rule', async () => {
      const response = await call('POST', '/statuses', {
        code: 'closed_start',
        defaultName: 'Closed start',
        kind: 'won',
        isInitial: true,
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'initial_must_be_open' },
      });
      expect((await workflow()).statuses.map((status) => status.code)).not.toContain('closed_start');
    });
  });

  describe('PATCH /statuses/:code', () => {
    it('updates the label, weight and colour', async () => {
      const response = await call('PATCH', '/statuses/in_delivery', {
        defaultName: 'Delivering',
        weight: 55,
        color: '#22c55e',
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = OpportunityWorkflowResponseSchema.parse(response.json());
      expect(body.data.statuses.find((status) => status.code === 'in_delivery')).toMatchObject({
        defaultName: 'Delivering',
        weight: 55,
        color: '#22c55e',
      });
    });

    it('refuses to rename the code — the schema is strict', async () => {
      const response = await call('PATCH', '/statuses/in_delivery', { code: 'renamed' });
      expect(response.statusCode, response.body).toBe(400);
    });

    it('answers 404 for a status that does not exist', async () => {
      const response = await call('PATCH', '/statuses/no_such_status', { defaultName: 'x' });
      expect(response.statusCode, response.body).toBe(404);
    });

    it('moves the initial flag, leaving exactly one initial status', async () => {
      const response = await call('PATCH', '/statuses/qualified', { isInitial: true });
      expect(response.statusCode, response.body).toBe(200);
      const initial = (await workflow()).statuses.filter((status) => status.isInitial);
      expect(initial.map((status) => status.code)).toEqual(['qualified']);

      const back = await call('PATCH', '/statuses/new', { isInitial: true });
      expect(back.statusCode, back.body).toBe(200);
    });

    it('refuses to clear the flag on the initial status — 409 CRM_STATUS_INITIAL_REQUIRED', async () => {
      const response = await call('PATCH', '/statuses/new', { isInitial: false });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_STATUS_INITIAL_REQUIRED');
    });

    it('refuses to close the only won status — 422 CRM_WORKFLOW_INVALID', async () => {
      const response = await call('PATCH', '/statuses/won', { kind: 'open' });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'won_status_required' },
      });
      expect((await workflow()).statuses.find((status) => status.code === 'won')?.kind).toBe('won');
    });
  });

  describe('PUT /transitions', () => {
    it('adds and removes edges and answers the workflow', async () => {
      const response = await call('PUT', '/transitions', {
        add: [
          { fromStatusCode: 'negotiation', toStatusCode: 'in_delivery' },
          { fromStatusCode: 'in_delivery', toStatusCode: 'won' },
        ],
        remove: [{ fromStatusCode: 'proposal', toStatusCode: 'won' }],
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = OpportunityWorkflowResponseSchema.parse(response.json());
      expect(body.data.transitions).toContainEqual({ fromStatusCode: 'negotiation', toStatusCode: 'in_delivery' });
      expect(body.data.transitions).toContainEqual({ fromStatusCode: 'in_delivery', toStatusCode: 'won' });
      expect(body.data.transitions).not.toContainEqual({ fromStatusCode: 'proposal', toStatusCode: 'won' });
    });

    it('is idempotent — adding an edge that exists changes nothing', async () => {
      const before = (await workflow()).transitions.length;
      const response = await call('PUT', '/transitions', {
        add: [{ fromStatusCode: 'negotiation', toStatusCode: 'in_delivery' }],
      });
      expect(response.statusCode, response.body).toBe(200);
      expect((await workflow()).transitions).toHaveLength(before);
    });

    it('allows an edge out of a closing status — reopening is a transition like any other', async () => {
      const response = await call('PUT', '/transitions', {
        add: [{ fromStatusCode: 'won', toStatusCode: 'negotiation' }],
      });
      expect(response.statusCode, response.body).toBe(200);
    });

    it('refuses an edge naming an unknown status — 422 CRM_WORKFLOW_INVALID', async () => {
      const response = await call('PUT', '/transitions', {
        add: [{ fromStatusCode: 'new', toStatusCode: 'no_such_status' }],
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'transition_unknown_status' },
      });
    });

    it('refuses an edge from a status to itself — the schema', async () => {
      const response = await call('PUT', '/transitions', {
        add: [{ fromStatusCode: 'new', toStatusCode: 'new' }],
      });
      expect(response.statusCode, response.body).toBe(400);
    });
  });

  describe('PUT /order-status-mappings (forward)', () => {
    it('replaces the set and answers the workflow', async () => {
      const first = await call('PUT', '/order-status-mappings', {
        mappings: [
          { direction: 'opportunity_to_order', opportunityStatusCode: 'qualified', orderStatusCode: 'paid' },
          { direction: 'opportunity_to_order', opportunityStatusCode: 'in_delivery', orderStatusCode: 'processing' },
        ],
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(OpportunityWorkflowResponseSchema.parse(first.json()).data.orderStatusMappings).toEqual([
        {
          direction: 'opportunity_to_order',
          opportunityStatusCode: 'in_delivery',
          orderStatusCode: 'processing',
          requireAllOrders: false,
          orderStatusKnown: true,
        },
        {
          direction: 'opportunity_to_order',
          opportunityStatusCode: 'qualified',
          orderStatusCode: 'paid',
          requireAllOrders: false,
          orderStatusKnown: true,
        },
      ]);

      const second = await call('PUT', '/order-status-mappings', {
        mappings: [
          { direction: 'opportunity_to_order', opportunityStatusCode: 'won', orderStatusCode: 'completed' },
        ],
      });
      expect(second.statusCode, second.body).toBe(200);
      expect(
        OpportunityWorkflowResponseSchema.parse(second.json()).data.orderStatusMappings.map(
          (mapping) => mapping.opportunityStatusCode,
        ),
      ).toEqual(['won']);
    });

    it('refuses a mapping for an Opportunity status that does not exist', async () => {
      const response = await call('PUT', '/order-status-mappings', {
        mappings: [
          { direction: 'opportunity_to_order', opportunityStatusCode: 'no_such_status', orderStatusCode: 'paid' },
        ],
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'mapping_unknown_status' },
      });
    });

    it('refuses two Order statuses for one Opportunity status', async () => {
      const response = await call('PUT', '/order-status-mappings', {
        mappings: [
          { direction: 'opportunity_to_order', opportunityStatusCode: 'qualified', orderStatusCode: 'paid' },
          { direction: 'opportunity_to_order', opportunityStatusCode: 'qualified', orderStatusCode: 'processing' },
        ],
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'mapping_duplicate' },
      });
      // The refused write replaced nothing.
      expect((await workflow()).orderStatusMappings.map((m) => m.opportunityStatusCode)).toEqual(['won']);
    });
  });

  describe('DELETE /statuses/:code', () => {
    it('refuses a status an Opportunity is in — 409 CRM_STATUS_IN_USE', async () => {
      const opportunity = await createCrmOpportunity(h);
      const moved = await call('POST', `/opportunities/${opportunity.id}/transition`, { to: 'qualified' });
      expect(moved.statusCode, moved.body).toBe(200);
      const response = await call('DELETE', '/statuses/qualified');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_STATUS_IN_USE');
      expect((await workflow()).statuses.find((s) => s.code === 'qualified')?.inUseCount).toBe(1);
    });

    it('refuses the initial status — 409 CRM_STATUS_INITIAL_REQUIRED', async () => {
      // No Opportunity is in `new` once the flag sits on an unused status.
      await call('POST', '/statuses', { code: 'fresh_start', defaultName: 'Fresh start', kind: 'open', isInitial: true });
      const response = await call('DELETE', '/statuses/fresh_start');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_STATUS_INITIAL_REQUIRED');
      const back = await call('PATCH', '/statuses/new', { isInitial: true });
      expect(back.statusCode, back.body).toBe(200);
      expect((await call('DELETE', '/statuses/fresh_start')).statusCode).toBe(204);
    });

    it('refuses to delete the only lost status — 422 CRM_WORKFLOW_INVALID', async () => {
      const response = await call('DELETE', '/statuses/lost');
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CRM_WORKFLOW_INVALID',
        details: { rule: 'lost_status_required' },
      });
    });

    it('deletes an unused status together with its transitions and mappings — 204', async () => {
      await call('PUT', '/order-status-mappings', {
        mappings: [
          { direction: 'opportunity_to_order', opportunityStatusCode: 'in_delivery', orderStatusCode: 'processing' },
        ],
      });
      const response = await call('DELETE', '/statuses/in_delivery');
      expect(response.statusCode, response.body).toBe(204);
      const current = await workflow();
      expect(current.statuses.map((status) => status.code)).not.toContain('in_delivery');
      expect(
        current.transitions.some(
          (edge) => edge.fromStatusCode === 'in_delivery' || edge.toStatusCode === 'in_delivery',
        ),
      ).toBe(false);
      expect(current.orderStatusMappings).toEqual([]);
    });

    it('answers 404 for a status that does not exist', async () => {
      const response = await call('DELETE', '/statuses/no_such_status');
      expect(response.statusCode, response.body).toBe(404);
    });
  });
});
