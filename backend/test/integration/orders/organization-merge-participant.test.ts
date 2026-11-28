import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { recordMergeScopeReason } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { OrderMergeParticipant } from '../../../../packages/modules/orders/src/backend/merge/organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T058 — the `orders` participant of an
 * Organization merge over a real database: every reference of
 * `contracts/participant-dispositions.md` §A re-pointed through
 * `order.merge_reassign`, held to `expectMergeParticipant`; and the in-flight
 * refusal of R-20 (`RECORD_MERGE_BUSY`, retryable) for an unsettled placement
 * intent and for a gateway payment still at the provider.
 */
describe('Organization merge — the orders participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> =>
    h.em().fork().getConnection().execute(statement, params) as Promise<T>;

  const build = (commandBus: Pick<CommandBus, 'run'>) => new OrderMergeParticipant({ emFactory: () => h.em(), commandBus });

  async function order(
    organizationId: string,
    options: { payerOrganizationId?: string | null; gateway?: boolean; paymentStatus?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    const [channel] = await sql<Array<{ id: string }>>(`select "id" from "sales_channels" order by "created_at" limit 1`);
    await sql(
      `insert into "orders" ("id","business_id","organization_id","payer_organization_id","placed_by_customer_account_id",
         "sales_channel_id","status","payment_status","delivery_address","billing_address","delivery_method_id",
         "delivery_method_snapshot","payment_method_id","payment_method_snapshot","subtotal","tax_total","discount_total",
         "delivery_total","total","currency","placed_at","created_at","updated_at","custom_field_values")
       values (?,?,?,?,?,?,'new',?,'{}','{}',?,'{}',?,?::jsonb,'10.00','0.00','0.00','0.00','10.00','PLN',now(),now(),now(),'{}')`,
      [
        id,
        `MRG-${id.slice(0, 8)}`,
        organizationId,
        options.payerOrganizationId ?? null,
        randomUUID(),
        channel!.id,
        options.paymentStatus ?? 'paid',
        randomUUID(),
        randomUUID(),
        JSON.stringify({ code: 'm', name: 'M', kind: options.gateway ? 'gateway' : 'bank_transfer' }),
      ],
    );
    return id;
  }

  async function apiKey(): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "api_keys" ("id","name","key_hash","last_four","created_at","updated_at") values (?, 'merge test', ?, 'abcd', now(), now())`,
      [id, randomUUID().replace(/-/g, '')],
    );
    return id;
  }

  async function intent(organizationId: string, status: 'pending' | 'succeeded' | 'failed'): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "order_placement_intents" ("id","api_key_id","organization_id","idempotency_key","payload_fingerprint","status","created_at","updated_at")
       values (?,?,?,?,?,?,now(),now())`,
      [id, await apiKey(), organizationId, randomUUID(), 'f'.repeat(64), status],
    );
    return id;
  }

  it('re-points every order reference of the loser, idempotently and audited (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'orders',
      key: 'organization-records',
      ids,
      build,
      seed: async ({ survivorId, loserId }) => {
        const a = await order(loserId);
        const b = await order(loserId, { payerOrganizationId: loserId });
        await order(survivorId, { payerOrganizationId: loserId });
        await order(survivorId);
        await sql(
          `insert into "order_external_references" ("id","organization_id","order_id","system","state") values (?,?,?,'erp','synced')`,
          [randomUUID(), loserId, a],
        );
        await sql(
          `insert into "order_transition_effects" ("id","organization_id","order_id","effect","reason","origin") values (?,?,?,'stock.release','order_cancelled','transition')`,
          [randomUUID(), loserId, b],
        );
        await intent(loserId, 'succeeded');
        await intent(loserId, 'failed');
      },
      snapshot: async ({ survivorId, loserId }) => ({
        orders: await sql(
          `select "id","organization_id","payer_organization_id" from "orders" where ? in ("organization_id","payer_organization_id") or ? in ("organization_id","payer_organization_id") order by "id"`,
          [survivorId, loserId],
        ),
        references: await sql(`select "id","organization_id" from "order_external_references" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
        effects: await sql(`select "id","organization_id" from "order_transition_effects" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
        intents: await sql(`select "id","organization_id" from "order_placement_intents" where "organization_id" in (?, ?) order by "id"`, [survivorId, loserId]),
      }),
    });
    // 2 orders as buyer + 2 as payer + 1 reference + 1 effect + 2 settled intents.
    expect(outcome.moved).toBe(8);
    const left = await sql<Array<{ n: number }>>(
      `select (select count(*) from "orders" where ? in ("organization_id","payer_organization_id"))::int
            + (select count(*) from "order_external_references" where "organization_id" = ?)::int
            + (select count(*) from "order_transition_effects" where "organization_id" = ?)::int
            + (select count(*) from "order_placement_intents" where "organization_id" = ?)::int as "n"`,
      [ids.loserId, ids.loserId, ids.loserId, ids.loserId],
    );
    expect(left[0]!.n).toBe(0);
    const audit = await sql<Array<{ action: string; object_type: string; object_id: string }>>(
      `select "action","object_type","object_id" from "audit_log_entries" where "state_after" ->> 'mergeId' = ?`,
      [outcome.mergeId],
    );
    expect(audit.length).toBeGreaterThan(0);
    for (const entry of audit) {
      expect(entry).toEqual({ action: 'order.merge_reassign', object_type: 'organization', object_id: ids.survivorId });
    }
  });

  it('refuses the start while a placement intent of the loser is unsettled (R-20)', async () => {
    const { survivorId, loserId } = await insertOrganizationPair(h);
    await intent(loserId, 'pending');
    const preview = await build({ run: () => Promise.reject(new Error('no write in a preview')) }).preview({
      hostType: 'organization',
      survivorId,
      loserId,
      hostContext: {},
    });
    expect(preview.refusals).toEqual([
      { code: 'RECORD_MERGE_BUSY', retryable: true, details: { reason: 'placement_intent', count: 1 } },
    ]);
  });

  it('refuses the start while a gateway payment of the loser is at the provider, and not for a bank transfer awaiting payment (R-20)', async () => {
    const { survivorId, loserId } = await insertOrganizationPair(h);
    await order(loserId, { gateway: false, paymentStatus: 'awaiting_payment' });
    const participant = build({ run: () => Promise.reject(new Error('no write in a preview')) });
    const input = { hostType: 'organization' as const, survivorId, loserId, hostContext: {} };
    expect((await participant.preview(input)).refusals).toEqual([]);

    await order(survivorId, { payerOrganizationId: loserId, gateway: true, paymentStatus: 'awaiting_payment' });
    expect((await participant.preview(input)).refusals).toEqual([
      { code: 'RECORD_MERGE_BUSY', retryable: true, details: { reason: 'pending_payment', count: 1 } },
    ]);
  });

  it('moves everything else and then stops with RECORD_MERGE_BUSY when an unsettled intent appeared after the start', async () => {
    const { survivorId, loserId } = await insertOrganizationPair(h);
    const settled = await order(loserId);
    await intent(loserId, 'pending');
    const participant = new OrderMergeParticipant({
      emFactory: () => h.em(),
      commandBus: (h.container.cradle as unknown as { commandBus: CommandBus }).commandBus,
    });
    const mergeId = randomUUID();
    const input = { mergeId, hostType: 'organization' as const, survivorId, loserId, hostContext: {}, batchSize: 50 };
    const scoped = <T>(run: () => Promise<T>) => withSystemScope(recordMergeScopeReason(mergeId), run);
    expect(await scoped(() => participant.applyBatch(input))).toEqual({ moved: 1 });
    await expect(scoped(() => participant.applyBatch(input))).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECORD_MERGE_BUSY',
    });
    const [row] = await sql<Array<{ organization_id: string }>>(`select "organization_id" from "orders" where "id" = ?`, [settled]);
    expect(row!.organization_id).toBe(survivorId);
  });
});
