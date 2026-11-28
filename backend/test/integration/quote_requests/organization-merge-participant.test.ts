import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { QuoteRequestMergeParticipant } from '../../../../packages/modules/quote_requests/src/backend/merge/organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T060 — the `quote_requests` participants of
 * an Organization merge over a real database, held to `expectMergeParticipant`:
 * the negotiation policy (survivor wins, fill gaps, `configuration` phase) and
 * the quote requests with their notification rows (re-point, `records` phase),
 * through `quote_request.merge_reassign`.
 */
describe('Organization merge — the quote_requests participants', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> =>
    h.em().fork().getConnection().execute(statement, params) as Promise<T>;

  async function quoteRequest(organizationId: string): Promise<string> {
    const id = randomUUID();
    const [channel] = await sql<Array<{ id: string }>>(`select "id" from "sales_channels" order by "created_at" limit 1`);
    await sql(
      `insert into "quote_requests" ("id","business_id","organization_id","customer_account_id","status","submitted_at","sales_channel_id","created_at","updated_at")
       values (?, ?, ?, ?, 'Pending', now(), ?, now(), now())`,
      [id, `QR-MRG-${id.slice(0, 8)}`, organizationId, randomUUID(), channel!.id],
    );
    return id;
  }

  async function notification(organizationId: string, quoteRequestId: string): Promise<void> {
    const eventId = randomUUID();
    await sql(
      `insert into "quote_request_events" ("id","quote_request_id","event_type","payload","created_at") values (?, ?, 'submitted', '{"type":"submitted"}'::jsonb, now())`,
      [eventId, quoteRequestId],
    );
    await sql(
      `insert into "quote_request_notifications" ("id","organization_id","quote_request_id","source_event_id","change","recipient_kind","recipient_id","channel","source_occurred_at")
       values (?, ?, ?, ?, 'submitted', 'customer', ?, 'customer_email', now())`,
      [randomUUID(), organizationId, quoteRequestId, eventId, randomUUID()],
    );
  }

  const policy = (organizationId: string, allowed: boolean) =>
    sql(
      `insert into "quote_request_org_policies" ("organization_id","price_proposals_allowed","created_at","updated_at") values (?, ?, now(), now())`,
      [organizationId, allowed],
    );

  const policies = (ids: { survivorId: string; loserId: string }) =>
    sql(
      `select "organization_id","price_proposals_allowed" from "quote_request_org_policies" where "organization_id" in (?, ?) order by "organization_id"`,
      [ids.survivorId, ids.loserId],
    );

  const build = (part: 'policy' | 'records') => (commandBus: Pick<CommandBus, 'run'>) =>
    new QuoteRequestMergeParticipant(part, { emFactory: () => h.em(), commandBus });

  it('re-points the loser’s quote requests and their notification rows (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'quote_requests',
      key: 'organization-records',
      ids,
      build: build('records'),
      seed: async ({ survivorId, loserId }) => {
        const a = await quoteRequest(loserId);
        await quoteRequest(loserId);
        await notification(loserId, a);
        await quoteRequest(survivorId);
      },
      snapshot: async ({ survivorId, loserId }) => ({
        requests: await sql(`select "id","organization_id" from "quote_requests" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
        notifications: await sql(`select "id","organization_id" from "quote_request_notifications" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
      }),
    });
    expect(outcome.moved).toBe(3);
  });

  it('fills the survivor’s missing negotiation policy from the loser’s (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'quote_requests',
      key: 'organization-policy',
      ids,
      build: build('policy'),
      seed: async ({ loserId }) => {
        await policy(loserId, false);
      },
      snapshot: policies,
    });
    expect(outcome.moved).toBe(1);
    expect(await policies(ids)).toEqual([{ organization_id: ids.survivorId, price_proposals_allowed: false }]);
  });

  it('keeps the survivor’s own policy and leaves the loser’s on the archived loser, counting nothing to move', async () => {
    const ids = await insertOrganizationPair(h);
    await policy(ids.survivorId, true);
    await policy(ids.loserId, false);
    const participant = build('policy')({ run: () => Promise.reject(new Error('no write expected')) });
    const preview = await participant.preview({ hostType: 'organization', ...ids, hostContext: {} });
    expect(preview.counts).toEqual({ 'QuoteRequestOrgPolicy.organizationId': 0 });
  });
});
