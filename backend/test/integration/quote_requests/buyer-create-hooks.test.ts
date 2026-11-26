import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  QUOTE_REQUEST_HOOKABLE_ACTIONS as QR,
  defineModuleErrorCodes,
  type QuoteRequestCreateHookData,
  type QuoteRequestResubmitHookData,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal, type Command } from '@endora-commerce/platform/commands';
import { AuditLogEntry, type AuditPort } from '@endora-commerce/platform/kernel';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  retireNotificationOrganization,
  seedNotificationOrganization,
  type NotificationOrganization,
} from '../../helpers/rfq-notification-organization.js';
import { manifest } from '../../../../packages/modules/quote_requests/src/manifest.js';

/**
 * Issue #1906 — a module sets the assignee of a quote request a buyer submits
 * on the storefront, **inside the submit write**, through a `beforeCommit`
 * command hook on `QUOTE_REQUEST_HOOKABLE_ACTIONS.create` — not through the
 * admin endpoint, and not by a second write after the "new quote request"
 * notification has already been fixed for nobody.
 *
 * The hook module (`acme_routing`, as a deployment's overlay would be) is
 * registered on a sealed hook registry, and the composed `RfqService` writes
 * through a Command Bus built over it, on this server's ORM, audit log and event
 * bus. Everything else is the platform's: the storefront route, the
 * Organization, its representatives and the recipient rule.
 *
 * The Organization (`seedNotificationOrganization`) has one assigned
 * representative holding `rfqs:handle` (`rep`) and one without it
 * (`noHandle`), so without a hook the operator side of a submission is `rep`
 * alone; the hook assigns the platform administrator, who then is told too.
 */

const HOOK_MODULE = 'acme_routing';
/** The hook module's own veto code, as a deployment's module would declare it. */
const ACME = defineModuleErrorCodes(['ACME_ROUTING_REFUSED']);
const REFUSED = ACME.ACME_ROUTING_REFUSED;
/** The administrator of `stub-restricted-admin-session`: active, `orders:read` only. */
const RESTRICTED_ADMIN_ID = '00000000-0000-4000-8000-0000000000b2';

interface RfqServiceInternals {
  deps: { commandBus: Pick<CommandBus, 'run'> };
}

describe('the buyer’s quote request create is hookable: assignee routing inside the write (#1906)', () => {
  let h: BackendServerHandle;
  let org: NotificationOrganization;
  let originalBus: Pick<CommandBus, 'run'>;
  const announced: string[] = [];
  let stopListening: () => void = () => undefined;

  /** What the hook does on the next submission, and whether its module is on. */
  let behaviour: (data: QuoteRequestCreateHookData) => Promise<void> = async () => undefined;
  let hookModulePresent = true;
  const seen: Array<Omit<QuoteRequestCreateHookData, 'assign'>> = [];
  /** What the hook does on the next *Submit again*, and what it was handed. */
  let resubmitBehaviour: (data: QuoteRequestResubmitHookData) => Promise<void> = async () => undefined;
  const resubmitted: Array<Omit<QuoteRequestResubmitHookData, 'assign'>> = [];

  const rfqService = (): RfqServiceInternals =>
    (h.container.resolve('quoteRequests') as { handle(): { rfqService: RfqServiceInternals } }).handle().rfqService;

  const sql = <T>(query: string, params: unknown[] = []) => h.em().fork().getConnection().execute<T[]>(query, params);

  async function submit(marker: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: org.requester.cookies,
      headers: { 'accept-language': 'en' },
      payload: { headerNote: marker, items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
    });
  }

  async function resubmit(sourceId: string, marker: string) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${sourceId}/resubmit`,
      cookies: org.requester.cookies,
      headers: { 'accept-language': 'en' },
      payload: { headerNote: marker },
    });
  }

  /** A request of the requester's to submit again, raised with no hook acting. */
  async function source(): Promise<string> {
    const res = await submit(`1906-source-${randomUUID()}`);
    expect(res.statusCode, res.body).toBe(201);
    seen.length = 0;
    return (res.json() as { data: { id: string } }).data.id;
  }

  const requestsMarked = async (marker: string) =>
    Number((await sql<{ n: string }>(`select count(*) as "n" from "quote_requests" where "header_note" = ?`, [marker]))[0]!.n);

  const operatorRecipients = async (rfqId: string) =>
    (
      await sql<{ recipient_id: string; channel: string }>(
        `select "recipient_id", "channel" from "quote_request_notifications"
          where "quote_request_id" = ? and "recipient_kind" = 'admin' order by "channel", "recipient_id"`,
        [rfqId],
      )
    ).map((row) => `${row.channel}:${row.recipient_id}`);

  const auditOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .find(AuditLogEntry, { objectType: 'quote_request', objectId: rfqId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedNotificationOrganization(h, '1906');
    const registry = sealedCommandHookRegistry({
      hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'quote_requests', ...declaration })),
      moduleDependencies: { [HOOK_MODULE]: ['quote_requests'] },
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            {
              id: 'route-to-representative',
              on: QR.create,
              phase: 'beforeCommit',
              handler: async ({ data }) => {
                const { assign: _assign, ...ids } = data;
                seen.push(ids);
                await behaviour(data);
              },
            },
            {
              id: 'route-resubmitted-to-representative',
              on: QR.resubmit,
              phase: 'beforeCommit',
              handler: async ({ data }) => {
                const { assign: _assign, ...ids } = data;
                resubmitted.push(ids);
                await resubmitBehaviour(data);
              },
            },
          ],
        },
      ],
      isPresent: (moduleId) => moduleId !== HOOK_MODULE || hookModulePresent,
    });
    const bus = new CommandBus(h.orm, h.container.resolve('auditLogService') as AuditPort, h.eventBus, { hooks: registry });
    originalBus = rfqService().deps.commandBus;
    rfqService().deps.commandBus = { run: <T>(command: Command<T>) => bus.run(command) };
    stopListening = (h.eventBus as unknown as { on(name: string, fn: (payload: { rfqId: string }) => Promise<void>): () => void }).on(
      'rfq.created.v1',
      async (payload) => {
        announced.push(payload.rfqId);
      },
    );
  });

  afterAll(async () => {
    stopListening();
    if (originalBus) rfqService().deps.commandBus = originalBus;
    if (org) await retireNotificationOrganization(h, org);
    await teardownBackendServer(h);
  });

  beforeEach(() => {
    behaviour = async () => undefined;
    resubmitBehaviour = async () => undefined;
    hookModulePresent = true;
    seen.length = 0;
    resubmitted.length = 0;
  });

  it('a hook assigns inside the write: stored, audited once, and the operators’ notification goes to the assignee', async () => {
    behaviour = (data) => data.assign(TEST_ADMIN_ID);
    const res = await submit(`1906-assign-${randomUUID()}`);
    expect(res.statusCode, res.body).toBe(201);
    const rfq = (res.json() as { data: { id: string; status: string } }).data;
    expect(rfq.status).toBe('Pending');

    // The hook was handed the write's ids, before anybody was assigned.
    expect(seen).toEqual([
      {
        quoteRequestId: rfq.id,
        organizationId: org.organizationId,
        customerAccountId: org.requester.id,
        salesChannelId: expect.any(String),
        assignedAdminUserId: null,
        itemCount: 1,
      },
    ]);

    const [stored] = await sql<{ assigned_admin_user_id: string | null }>(
      `select "assigned_admin_user_id" from "quote_requests" where "id" = ?`,
      [rfq.id],
    );
    expect(stored!.assigned_admin_user_id).toBe(TEST_ADMIN_ID);

    const entries = await auditOf(rfq.id);
    expect(entries.map((entry) => [entry.action, entry.stateBefore ?? null, entry.stateAfter])).toEqual([
      ['quote_request.assign', { assignedAdminUserId: null }, { assignedAdminUserId: TEST_ADMIN_ID, source: HOOK_MODULE }],
      ['quote_request.create', null, { status: 'Pending', itemCount: 1, salesChannelId: seen[0]!.salesChannelId }],
    ]);
    // The buyer is the actor of both: the hook acted inside their write.
    for (const entry of entries) {
      expect(entry.actorCustomerAccountId).toBe(org.requester.id);
      expect(entry.actorAdminUserId ?? null).toBeNull();
    }

    // The operator side read after the hook: the assignee first, then the representative.
    expect(await operatorRecipients(rfq.id)).toEqual(
      [
        `admin_email:${org.rep.id}`,
        `admin_email:${TEST_ADMIN_ID}`,
        `admin_in_app:${org.rep.id}`,
        `admin_in_app:${TEST_ADMIN_ID}`,
      ].sort(),
    );
    expect(announced.filter((id) => id === rfq.id)).toHaveLength(1);
  });

  it('without an assignment the operator side is the representative alone, as before', async () => {
    const res = await submit(`1906-none-${randomUUID()}`);
    expect(res.statusCode, res.body).toBe(201);
    const rfq = (res.json() as { data: { id: string } }).data;
    expect(seen).toHaveLength(1);
    expect(await operatorRecipients(rfq.id)).toEqual([`admin_email:${org.rep.id}`, `admin_in_app:${org.rep.id}`]);
    // The entry the hand audit recorded, byte for byte, with the buyer as its actor.
    const entries = await auditOf(rfq.id);
    expect(entries.map((entry) => [entry.action, entry.stateBefore ?? null, entry.stateAfter])).toEqual([
      ['quote_request.create', null, { status: 'Pending', itemCount: 1, salesChannelId: seen[0]!.salesChannelId }],
    ]);
    expect(entries[0]!.actorCustomerAccountId).toBe(org.requester.id);
    expect(announced.filter((id) => id === rfq.id)).toHaveLength(1);
  });

  it('an assignee who may not handle quote requests aborts the write, with nothing left behind', async () => {
    behaviour = (data) => data.assign(org.noHandle.id);
    const marker = `1906-ineligible-${randomUUID()}`;
    const res = await submit(marker);
    expect(res.statusCode, res.body).toBe(422);
    const error = (res.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe(ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE);
    // Worded for the buyer whose submission it stopped.
    expect(error.message).toContain('could not be routed to a sales representative');
    expect(await requestsMarked(marker)).toBe(0);
    expect(seen).toHaveLength(1);
    const rolledBack = seen[0]!.quoteRequestId;
    expect(await auditOf(rolledBack)).toEqual([]);
    expect(announced).not.toContain(rolledBack);
  });

  it('so does an administrator who holds no rfqs:handle at all, and a hook may fall back to its next candidate', async () => {
    behaviour = async (data) => {
      for (const candidate of [RESTRICTED_ADMIN_ID, TEST_ADMIN_ID]) {
        try {
          await data.assign(candidate);
          return;
        } catch (error) {
          if ((error as { code?: string }).code !== ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE) throw error;
        }
      }
    };
    const res = await submit(`1906-fallback-${randomUUID()}`);
    expect(res.statusCode, res.body).toBe(201);
    const rfq = (res.json() as { data: { id: string } }).data;
    const entries = await auditOf(rfq.id);
    expect(entries.map((entry) => [entry.action, entry.stateAfter?.['assignedAdminUserId'] ?? null])).toEqual([
      ['quote_request.assign', TEST_ADMIN_ID],
      ['quote_request.create', null],
    ]);
  });

  it('a veto aborts the write: no request, no entry, no notification, no event', async () => {
    behaviour = async (data) => {
      await data.assign(TEST_ADMIN_ID);
      throw new CommandHookRefusal(409, REFUSED, 'The routing module refused this request.');
    };
    const marker = `1906-veto-${randomUUID()}`;
    const res = await submit(marker);
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(REFUSED);
    expect(await requestsMarked(marker)).toBe(0);
    const rolledBack = seen[0]!.quoteRequestId;
    expect(await auditOf(rolledBack)).toEqual([]);
    expect(
      Number((await sql<{ n: string }>(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [rolledBack]))[0]!.n),
    ).toBe(0);
    expect(announced).not.toContain(rolledBack);
  });

  it('with the hook module switched off, the write behaves as if it were not installed', async () => {
    hookModulePresent = false;
    behaviour = (data) => data.assign(TEST_ADMIN_ID);
    const res = await submit(`1906-off-${randomUUID()}`);
    expect(res.statusCode, res.body).toBe(201);
    const rfq = (res.json() as { data: { id: string } }).data;
    expect(seen).toEqual([]);
    expect(await operatorRecipients(rfq.id)).toEqual([`admin_email:${org.rep.id}`, `admin_in_app:${org.rep.id}`]);
    expect((await auditOf(rfq.id)).map((entry) => entry.action)).toEqual(['quote_request.create']);
  });

  describe('Submit again (quote_request.resubmit)', () => {
    it('a hook assigns the new request inside the write: audited once, the operators told of the resubmission', async () => {
      const sourceId = await source();
      resubmitBehaviour = (data) => data.assign(TEST_ADMIN_ID);
      const res = await resubmit(sourceId, `1906-resubmit-${randomUUID()}`);
      expect(res.statusCode, res.body).toBe(201);
      const rfq = (res.json() as { data: { id: string; status: string } }).data;
      expect(rfq.id).not.toBe(sourceId);
      expect(seen).toEqual([]);
      expect(resubmitted).toEqual([
        expect.objectContaining({
          quoteRequestId: rfq.id,
          sourceQuoteRequestId: sourceId,
          organizationId: org.organizationId,
          customerAccountId: org.requester.id,
          assignedAdminUserId: null,
          itemCount: 1,
        }),
      ]);
      const entries = await auditOf(rfq.id);
      expect(entries.map((entry) => [entry.action, entry.stateBefore ?? null, entry.stateAfter])).toEqual([
        ['quote_request.assign', { assignedAdminUserId: null }, { assignedAdminUserId: TEST_ADMIN_ID, source: HOOK_MODULE }],
        ['quote_request.resubmit', null, { status: 'Pending', itemCount: 1, salesChannelId: resubmitted[0]!.salesChannelId }],
      ]);
      for (const entry of entries) expect(entry.actorCustomerAccountId).toBe(org.requester.id);
      expect(await operatorRecipients(rfq.id)).toEqual(
        [
          `admin_email:${org.rep.id}`,
          `admin_email:${TEST_ADMIN_ID}`,
          `admin_in_app:${org.rep.id}`,
          `admin_in_app:${TEST_ADMIN_ID}`,
        ].sort(),
      );
      const changes = await sql<{ change: string }>(
        `select distinct "change" from "quote_request_notifications" where "quote_request_id" = ?`,
        [rfq.id],
      );
      expect(changes.map((row) => row.change)).toEqual(['resubmitted']);
      // Submitting again announces no domain event, as before.
      expect(announced).not.toContain(rfq.id);
      // The source request is not written.
      expect((await auditOf(sourceId)).map((entry) => entry.action)).toEqual(['quote_request.create']);
    });

    it('without a hook acting, the entry is the one the hand audit recorded and the representative alone is told', async () => {
      const sourceId = await source();
      const res = await resubmit(sourceId, `1906-resubmit-plain-${randomUUID()}`);
      expect(res.statusCode, res.body).toBe(201);
      const rfq = (res.json() as { data: { id: string } }).data;
      expect((await auditOf(rfq.id)).map((entry) => [entry.action, entry.stateBefore ?? null, entry.stateAfter])).toEqual([
        ['quote_request.resubmit', null, { status: 'Pending', itemCount: 1, salesChannelId: resubmitted[0]!.salesChannelId }],
      ]);
      expect(await operatorRecipients(rfq.id)).toEqual([`admin_email:${org.rep.id}`, `admin_in_app:${org.rep.id}`]);
    });

    it('an ineligible assignee and a veto abort the resubmit, with nothing left behind', async () => {
      const sourceId = await source();
      resubmitBehaviour = (data) => data.assign(RESTRICTED_ADMIN_ID);
      const ineligible = `1906-resubmit-ineligible-${randomUUID()}`;
      const refused = await resubmit(sourceId, ineligible);
      expect(refused.statusCode, refused.body).toBe(422);
      expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE);
      expect(await requestsMarked(ineligible)).toBe(0);

      resubmitBehaviour = async () => {
        throw new CommandHookRefusal(409, REFUSED, 'The routing module refused this request.');
      };
      const vetoed = `1906-resubmit-veto-${randomUUID()}`;
      const veto = await resubmit(sourceId, vetoed);
      expect(veto.statusCode, veto.body).toBe(409);
      expect(await requestsMarked(vetoed)).toBe(0);
      for (const { quoteRequestId } of resubmitted) expect(await auditOf(quoteRequestId)).toEqual([]);
    });
  });
});
