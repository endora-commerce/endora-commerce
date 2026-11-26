import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT,
  type MergeDisposition,
  type RecordMergeRecord,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { seedAnalyticsOpportunity } from '../../helpers/seed-crm-analytics.js';
import { insertCompanyOrganization, mergeSql, seedRows } from '../../helpers/organization-merge-conformance.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
// The class the ORM registered from the package's `entities` array, not a second copy from source.
import { Address } from '../../helpers/package-entities.js';

/**
 * `specs/192-organization-merge/` T072 — an Organization merge end to end, over
 * the full composition: every participant's rows seeded for the loser (and the
 * survivor's twins where a disposition meets them), the merge previewed and
 * started through the admin routes and driven by the platform's runner, then:
 *
 *  - **SC-001** — a zero-reference query over every Organization column the
 *    composed manifests declare (the column list is derived from the merge
 *    declarations and the ORM's metadata, never written here);
 *  - **SC-003** — a failure injected into the `orders` step: the earlier steps
 *    stay done, the merge stops in `needs_attention` naming the step, and a
 *    resume completes it to the state an uninterrupted merge of the same seed
 *    reaches (no duplicate union row, no double sum);
 *  - **SC-004** — every audit entry the merge wrote carries its id, and the
 *    survivor's history holds one start entry;
 *  - **US4 / SC-007** — `crm` switched off for the whole merge: its step is
 *    deferred, nothing of it is written, and switched back on the catch-up
 *    runs it under the original merge id;
 *  - **US3** — the archived loser read by id answers its survivor, is in no
 *    list, refuses a write naming it with `ORGANIZATION_MERGED`; one
 *    `organization.merged.v1`.
 *
 * Rows are seeded with foreign-key triggers off (`seedRows`), as each
 * participant's own conformance test seeds them; the merge itself runs with
 * every trigger on.
 */

interface Pair {
  readonly survivorId: string;
  readonly loserId: string;
}

/** One declared Organization reference, resolved to its table and column. */
interface DerivedColumn {
  readonly label: string;
  readonly moduleId: string;
  readonly disposition: MergeDisposition;
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly discriminator: { readonly column: string; readonly value: string } | null;
}

/**
 * Exceptions to SC-001 the inventory itself makes for a moving disposition,
 * each a row filter with its reason (`participant-dispositions.md` §A):
 *
 *  - a revoked related-payer self-link cannot name the survivor on both sides
 *    (`related_payer_links` CHECK `organization_id <> payer_organization_id`),
 *    so it stays on the archived loser, revoked;
 *  - the loser's role definitions are matched by name or copied into the
 *    survivor, not moved: they stay on the archived loser, and the test proves
 *    separately that no member and no invitation still holds one.
 */
const SC001_EXCEPTIONS: Readonly<Record<string, (pair: Pair) => string>> = {
  'RelatedPayerLink.organizationId': ({ survivorId }) =>
    `not ("state" = 'revoked' and "payer_organization_id" = '${survivorId}')`,
  'RelatedPayerLink.payerOrganizationId': ({ survivorId }) =>
    `not ("state" = 'revoked' and "organization_id" = '${survivorId}')`,
  'OrganizationRole.organizationId': () => 'false',
};

describe('Organization merge — end to end (T072)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let columns: DerivedColumn[];
  const admin: TenantContext = { mode: 'all', actor: { kind: 'admin', id: TEST_ADMIN_ID } };
  const cookies = { b2b_session: 'stub-admin-session' };
  const merged: unknown[] = [];

  const sql = <T = unknown>(statement: string, params: unknown[] = []): Promise<T> => mergeSql<T>(h, statement, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    const [channel] = await sql<Array<{ id: string }>>(`select "id" from "sales_channels" where "system_default" = true limit 1`);
    channelId = channel!.id;
    columns = await deriveColumns();
    h.eventBus.on('organization.merged.v1' as never, (payload: unknown) => {
      merged.push(payload);
    });
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * Every Organization reference the composed registry holds, with its table,
   * column and column type from the ORM's metadata and the catalogue.
   */
  async function deriveColumns(): Promise<DerivedColumn[]> {
    const metas = [...new Set(h.orm.getMetadata().getAll().values())] as Array<{
      className: string;
      tableName: string;
      properties: Record<string, { fieldNames?: string[] }>;
    }>;
    const field = (entity: string, property: string): { table: string; column: string } => {
      const found = metas.filter((meta) => meta.className === entity);
      if (found.length !== 1) throw new Error(`expected one entity ${entity}, found ${found.length}`);
      const column = found[0]!.properties[property]?.fieldNames?.[0];
      if (!column) throw new Error(`${entity}.${property} has no column`);
      return { table: found[0]!.tableName, column };
    };
    const out: DerivedColumn[] = [];
    for (const participation of h.recordMergeRuntime.registry.allDeclarations()) {
      if (participation.host !== 'organization') continue;
      for (const reference of participation.references) {
        const { table, column } = field(reference.entity, reference.property);
        const [info] = await sql<Array<{ udt_name: string }>>(
          `select "udt_name" from information_schema.columns where "table_schema" = 'public' and "table_name" = ? and "column_name" = ?`,
          [table, column],
        );
        if (!info) throw new Error(`${table}.${column} is not in the database`);
        out.push({
          label: `${reference.entity}.${reference.property}`,
          moduleId: participation.moduleId,
          disposition: reference.disposition,
          table,
          column,
          type: info.udt_name,
          discriminator: reference.polymorphic
            ? { column: field(reference.entity, reference.polymorphic.discriminator).column, value: reference.polymorphic.value }
            : null,
        });
      }
    }
    return out;
  }

  /** The rows of one derived column naming `organizationId` (an id column, a JSON array of ids, or a key suffix). */
  async function referencing(col: DerivedColumn, organizationId: string, extra?: string): Promise<number> {
    let where: string;
    let params: unknown[];
    if (col.type === 'jsonb') {
      where = `"${col.column}" @> ?::jsonb`;
      params = [JSON.stringify([organizationId])];
    } else if (col.type === '_uuid') {
      where = `?::uuid = any("${col.column}")`;
      params = [organizationId];
    } else if (col.type === 'uuid') {
      where = `"${col.column}" = ?`;
      params = [organizationId];
    } else {
      // A text key carrying the id (`PromotionUsageCounter.scopeKey`: `<promotion>:<organization>`).
      where = `("${col.column}"::text = ? or "${col.column}"::text like ?)`;
      params = [organizationId, `%:${organizationId}`];
    }
    if (col.discriminator) where += ` and "${col.discriminator.column}" = '${col.discriminator.value}'`;
    if (extra) where += ` and ${extra}`;
    const [row] = await sql<Array<{ n: number }>>(`select count(*)::int as "n" from "${col.table}" where ${where}`, params);
    return row!.n;
  }

  // --- the seed -------------------------------------------------------------------------------

  async function predefinedRoles(organizationId: string): Promise<{ administrator: string; member: string }> {
    const rows = await sql<Array<{ id: string; kind: string }>>(
      `select "id","kind" from "organization_roles" where "organization_id" = ? and "kind" in ('administrator','member')`,
      [organizationId],
    );
    return {
      administrator: rows.find((row) => row.kind === 'administrator')!.id,
      member: rows.find((row) => row.kind === 'member')!.id,
    };
  }

  /**
   * One row or more for every participant's references on the loser, and the
   * survivor's twins a union, a sum or a survivor-wins disposition meets.
   */
  async function seedEveryParticipant({ survivorId, loserId }: Pair): Promise<{ loserMembers: string[] }> {
    const id = (): string => randomUUID();
    const loserRoles = await predefinedRoles(loserId);
    const survivorRoles = await predefinedRoles(survivorId);
    const loserAdmin = id();
    const loserMember = id();
    const survivorAdmin = id();
    const account = (accountId: string, organizationId: string, roleId: string) =>
      [
        `insert into "customer_accounts" ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","created_at","updated_at")
         values (?, ?, ?, 'x', 'Merge', 'Member', ?, now(), now())`,
        [accountId, organizationId, `e2e-${accountId}@example.test`, roleId],
      ] as const;
    const thirdParty = id();
    const otherPayer = id();
    const promotionId = id();
    const sharedList = id();
    const loserList = id();
    const sharedProject = id();
    const loserProject = id();
    const survivorLimit = id();
    const loserLimit = id();
    const order = (orderId: string, organizationId: string, payerOrganizationId: string | null) =>
      [
        `insert into "orders" ("id","business_id","organization_id","payer_organization_id","placed_by_customer_account_id",
           "sales_channel_id","status","payment_status","delivery_address","billing_address","delivery_method_id",
           "delivery_method_snapshot","payment_method_id","payment_method_snapshot","subtotal","tax_total","discount_total",
           "delivery_total","total","currency","placed_at","created_at","updated_at","custom_field_values")
         values (?,?,?,?,?,?,'new','paid','{}','{}',?,'{}',?,'{"code":"m","name":"M","kind":"bank_transfer"}'::jsonb,
                 '10.00','0.00','0.00','0.00','10.00','PLN',now(),now(),now(),'{}')`,
        [orderId, `E2E-${orderId.slice(0, 8)}`, organizationId, payerOrganizationId, loserAdmin, channelId, id(), id()],
      ] as const;
    const loserOrder = id();
    const apiKeyId = id();
    const quoteRequestId = id();
    const quoteEventId = id();
    const returnCases = [id(), id()];

    await seedRows(h, [
      // customer_accounts (members)
      account(loserAdmin, loserId, loserRoles.administrator),
      account(loserMember, loserId, loserRoles.member),
      account(survivorAdmin, survivorId, survivorRoles.administrator),
      // organizations (host structure): an invitation to the loser
      [
        `insert into "organization_invitations" ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
         values (?, ?, 'e2e-invitee@example.test', ?, ?, now() + interval '7 days', now(), now())`,
        [id(), loserId, loserRoles.member, id()],
      ],
      // organizations (host structure): the same sales representative on both (union)
      ...[survivorId, loserId].map(
        (organizationId) =>
          [
            `insert into "organization_sales_rep_assignments" ("id","organization_id","admin_user_id","created_at") values (?, ?, ?, now())`,
            [id(), organizationId, TEST_ADMIN_ID],
          ] as const,
      ),
      // organizations (kept on the loser: survivor wins)
      [`insert into "organization_payment_methods" ("organization_id","payment_method_id") values (?, ?)`, [loserId, id()]],
      // addresses
      ...[loserId, loserId, survivorId].map(
        (organizationId, index) =>
          [
            `insert into "addresses" ("id","organization_id","kind","recipient_name","street","city","postal_code","country","is_default","created_at","updated_at")
             values (?, ?, 'delivery', 'E2E Recipient', 'ul. Długa 1', 'Kraków', '30-001', 'PL', ?, now(), now())`,
            [id(), organizationId, index !== 1],
          ] as const,
      ),
      // admin_users (kept)
      [
        `insert into "admin_impersonation_reasons" ("id","customer_account_id","organization_id","actor_admin_user_id","reason") values (?, ?, ?, ?, 'e2e support')`,
        [id(), loserAdmin, loserId, TEST_ADMIN_ID],
      ],
      // analytics (trailing)
      ...[1, 2].map(
        () =>
          [
            `insert into "analytics_events" ("id","type","occurred_at","recorded_at","organization_id","customer_account_id") values (?, 'page_view', now(), now(), ?, ?)`,
            [id(), loserId, loserAdmin],
          ] as const,
      ),
      // api_keys (a key bound to the loser)
      [
        `insert into "api_keys" ("id","name","key_hash","last_four","organization_id","sales_channel_id","customer_account_id","created_at","updated_at")
         values (?, 'e2e bound', ?, 'abcd', ?, ?, ?, now(), now())`,
        [apiKeyId, id().replace(/-/g, ''), loserId, channelId, loserAdmin],
      ],
      // carts: the loser's own, and the survivor's cart buying for the loser
      [
        `insert into "carts" ("id","organization_id","customer_account_id","status","approval_status","last_activity_at","version","created_at","updated_at")
         values (?, ?, ?, 'active', 'not_required', now(), 1, now(), now())`,
        [id(), loserId, loserAdmin],
      ],
      [
        `insert into "carts" ("id","organization_id","status","approval_status","buying_for_organization_id","buying_for_terms","last_activity_at","version","created_at","updated_at")
         values (?, ?, 'active', 'not_required', ?, 'payer', now(), 1, now(), now())`,
        [id(), survivorId, loserId],
      ],
      // catalog: allow-lists naming both (union) and the loser alone
      ...[[loserId, survivorId], [loserId]].map((allowed) => {
        const productId = id();
        return [
          `insert into "products" ("id","sku","slug","type","status","name","visibility","allowed_organization_ids","attribute_values","created_at","updated_at")
           values (?, ?, ?, 'simple', 'active', 'E2E product', 'organization_restricted', ?::jsonb, '{}'::jsonb, now(), now())`,
          [productId, `E2E-${productId.slice(0, 8)}`, `e2e-${productId}`, JSON.stringify(allowed)],
        ] as const;
      }),
      [
        `insert into "product_channel_scopes" ("product_id","sales_channel_id","visibility","allowed_organization_ids") values (?, ?, 'organization_restricted', ?::jsonb)`,
        [id(), channelId, JSON.stringify([loserId])],
      ],
      // comparisons
      [
        `insert into "comparisons" ("id","share_token","customer_account_id","sales_channel_id","organization_id") values (?, ?, ?, ?, ?)`,
        [id(), id().replace(/-/g, ''), loserAdmin, channelId, loserId],
      ],
      // credit_limits: both hold a limit (survivor wins); exposure on the loser's moves
      [`insert into "credit_limits" ("id","organization_id","granted_amount","currency","created_at","updated_at") values (?, ?, 1000, 'PLN', now(), now())`, [survivorLimit, survivorId]],
      [`insert into "credit_limits" ("id","organization_id","granted_amount","currency","created_at","updated_at") values (?, ?, 500, 'PLN', now(), now())`, [loserLimit, loserId]],
      [
        `insert into "credit_limit_reservations" ("id","credit_limit_id","order_id","reserving_organization_id","amount","currency","status","created_at","updated_at")
         values (?, ?, ?, ?, 40, 'PLN', 'active', now(), now())`,
        [id(), loserLimit, loserOrder, loserId],
      ],
      [
        `insert into "credit_limit_return_topups" ("id","return_case_id","organization_id","amount","currency","applied_at") values (?, ?, ?, 5, 'PLN', now())`,
        [id(), returnCases[0], loserId],
      ],
      // customer_notifications
      [
        `insert into "customer_notifications" ("id","organization_id","customer_account_id","source_module","source_key","kind","title","title_message")
         values (?, ?, ?, 'orders', ?, 'order_status', 'E2E', '{"key":"e2e"}'::jsonb)`,
        [id(), loserId, loserAdmin, id()],
      ],
      // forms
      [
        `insert into "form_entries" ("form_id","form_version_id","form_version_number","sales_channel_id","language","customer_account_id","organization_id")
         values (?, ?, 1, ?, 'pl', ?, ?)`,
        [id(), id(), channelId, loserAdmin, loserId],
      ],
      // inventory
      [
        `insert into "availability_notifications" ("id","customer_account_id","product_id","requested_at","organization_id") values (?, ?, ?, now(), ?)`,
        [id(), loserAdmin, id(), loserId],
      ],
      // invoice_ledger: the survivor's mapping wins over the loser's on the same key, the
      // loser's other one fills a gap; document maps move; deliveries are kept
      ...[
        [survivorId, 'default'],
        [loserId, 'default'],
        [loserId, 'second'],
      ].map(
        ([organizationId, credential]) =>
          [
            `insert into "invoice_ledger_client_maps" ("id","adapter_id","organization_id","nip_used","remote_client_id","credential_code","environment","updated_at")
             values (?, 'e2e-ledger', ?, '0000000000', ?, ?, 'production', now())`,
            [id(), organizationId, `remote-${id().slice(0, 8)}`, credential],
          ] as const,
      ),
      [
        `insert into "invoice_ledger_document_maps" ("id","adapter_id","invoice_id","organization_id","environment","credential_code","created_at")
         values (?, 'e2e-ledger', ?, ?, 'production', 'default', now())`,
        [id(), id(), loserId],
      ],
      [
        `insert into "invoice_ledger_deliveries" ("id","adapter_id","invoice_id","organization_id","kind","credential_code","environment",
           "numbering_mode","ksef_routing","status","idempotency_key","attempt_count","attempts","ksef_delegated","created_at","updated_at")
         values (?, 'e2e-ledger', ?, ?, 'invoice', 'default', 'production', 'endora', 'native', 'succeeded', ?, 0, '[]'::jsonb, false, now(), now())`,
        [id(), id(), loserId, id()],
      ],
      // invoices
      [
        `insert into "invoices" ("id","kind","number","issued_at","currency","total","order_id","organization_id","created_at","updated_at")
         values (?, 'invoice', ?, now(), 'PLN', 123.45, ?, ?, now(), now())`,
        [id(), `E2E/${id().slice(0, 12)}`, loserOrder, loserId],
      ],
      // mfa: the loser enforces, the survivor does not (stricter)
      [`insert into "mfa_organization_policies" ("id","organization_id","enforce_totp","created_at","updated_at") values (?, ?, true, now(), now())`, [id(), loserId]],
      [`insert into "mfa_organization_policies" ("id","organization_id","enforce_totp","created_at","updated_at") values (?, ?, false, now(), now())`, [id(), survivorId]],
      // newsletter
      [
        `insert into "newsletter_subscribers" ("id","email","customer_account_id","organization_id","created_at","updated_at") values (?, ?, ?, ?, now(), now())`,
        [id(), `e2e-news-${id()}@example.test`, loserAdmin, loserId],
      ],
      // orders: the loser's order, and the survivor's order the loser paid; a
      // reference, an effect and a settled placement intent
      order(loserOrder, loserId, null),
      order(id(), survivorId, loserId),
      [
        `insert into "order_external_references" ("id","organization_id","order_id","system","state") values (?,?,?,'erp','synced')`,
        [id(), loserId, loserOrder],
      ],
      [
        `insert into "order_transition_effects" ("id","organization_id","order_id","effect","reason","origin") values (?,?,?,'stock.release','order_cancelled','transition')`,
        [id(), loserId, loserOrder],
      ],
      [
        `insert into "order_placement_intents" ("id","api_key_id","organization_id","idempotency_key","payload_fingerprint","status","created_at","updated_at")
         values (?,?,?,?,?,'succeeded',now(),now())`,
        [id(), apiKeyId, loserId, id(), 'f'.repeat(64)],
      ],
      // price_lists: one book holds both (union), one only the loser; the loser's display override fills a gap
      ...[sharedList, loserList].map(
        (listId) =>
          [
            `insert into "price_lists" ("id","name","currency_code","audience_kind","status","created_at","updated_at") values (?, 'E2E book', 'PLN', 'organizations', 'active', now(), now())`,
            [listId],
          ] as const,
      ),
      ...[
        [sharedList, survivorId],
        [sharedList, loserId],
        [loserList, loserId],
      ].map(
        ([listId, organizationId]) =>
          [`insert into "price_list_audience_members" ("id","price_list_id","organization_id") values (?, ?, ?)`, [id(), listId, organizationId]] as const,
      ),
      [`insert into "price_display_mode_overrides" ("scope","target_id","mode","created_at","updated_at") values ('organization', ?, 'net_only', now(), now())`, [loserId]],
      // projects: one project with both (union), one with the loser alone, and a link
      ...[sharedProject, loserProject].map(
        (projectId) =>
          [
            `insert into "projects" ("id","number","title","visibility","created_by_admin_user_id") values (?, ?, 'E2E', 'everyone', ?)`,
            [projectId, `PRJ-E${projectId.slice(0, 8)}`, TEST_ADMIN_ID],
          ] as const,
      ),
      ...[
        [sharedProject, survivorId],
        [sharedProject, loserId],
        [loserProject, loserId],
      ].map(([projectId, organizationId]) => [`insert into "project_organizations" ("project_id","organization_id") values (?, ?)`, [projectId, organizationId]] as const),
      [
        `insert into "project_links" ("id","project_id","record_kind","record_id","organization_id") values (?, ?, 'order', ?, ?)`,
        [id(), loserProject, loserOrder, loserId],
      ],
      // promotions: the loser's promotion and usage; per-Organization counters on both (sum)
      [`insert into "promotions" ("id","name","organization_id","created_at","updated_at") values (?, 'E2E promo', ?, now(), now())`, [promotionId, loserId]],
      [
        `insert into "promotion_usages" ("id","promotion_id","order_id","organization_id","sales_channel_id","discount_amount","currency","created_at")
         values (?, ?, ?, ?, ?, 10, 'PLN', now())`,
        [id(), promotionId, loserOrder, loserId, channelId],
      ],
      [`insert into "promotion_usage_counters" ("id","scope_type","scope_key","count") values (?, 'organization', ?, 3)`, [id(), `${promotionId}:${loserId}`]],
      [`insert into "promotion_usage_counters" ("id","scope_type","scope_key","count") values (?, 'organization', ?, 2)`, [id(), `${promotionId}:${survivorId}`]],
      // pwa
      [
        `insert into "push_subscriptions" ("id","sales_channel_id","customer_account_id","endpoint","p256dh","auth","organization_id","created_at","last_seen_at")
         values (?, ?, ?, ?, 'k', 'a', ?, now(), now())`,
        [id(), channelId, loserAdmin, `https://push.example.test/${id()}`, loserId],
      ],
      [`insert into "push_notification_preferences" ("id","customer_account_id","organization_id") values (?, ?, ?)`, [id(), loserAdmin, loserId]],
      // quick_order: the loser's default fills the survivor's gap
      [
        `insert into "quick_order_default_preferences" ("id","scope","scope_id","default_payment_method_id","created_at","updated_at") values (?, 'organization', ?, ?, now(), now())`,
        [id(), loserId, id()],
      ],
      // quote_requests: both hold a policy (survivor wins); a request and its notification
      [`insert into "quote_request_org_policies" ("organization_id","price_proposals_allowed","created_at","updated_at") values (?, true, now(), now())`, [survivorId]],
      [`insert into "quote_request_org_policies" ("organization_id","price_proposals_allowed","created_at","updated_at") values (?, false, now(), now())`, [loserId]],
      [
        `insert into "quote_requests" ("id","business_id","organization_id","customer_account_id","status","submitted_at","sales_channel_id","created_at","updated_at")
         values (?, ?, ?, ?, 'Pending', now(), ?, now(), now())`,
        [quoteRequestId, `QR-E2E-${quoteRequestId.slice(0, 8)}`, loserId, loserAdmin, channelId],
      ],
      [
        `insert into "quote_request_events" ("id","quote_request_id","event_type","payload","created_at") values (?, ?, 'submitted', '{"type":"submitted"}'::jsonb, now())`,
        [quoteEventId, quoteRequestId],
      ],
      [
        `insert into "quote_request_notifications" ("id","organization_id","quote_request_id","source_event_id","change","recipient_kind","recipient_id","channel","source_occurred_at")
         values (?, ?, ?, ?, 'submitted', 'customer', ?, 'customer_email', now())`,
        [id(), loserId, quoteRequestId, quoteEventId, loserAdmin],
      ],
      // related_payers: the loser pays for a third party, a third party pays for the loser, a
      // link between the two (a self-link after the merge), and requests both ways
      ...[
        [loserId, otherPayer],
        [thirdParty, loserId],
        [loserId, survivorId],
      ].map(
        ([organizationId, payerOrganizationId]) =>
          [
            `insert into "related_payer_links" ("id","organization_id","payer_organization_id","state","origin","created_at","updated_at") values (?, ?, ?, 'active', 'operator', now(), now())`,
            [id(), organizationId, payerOrganizationId],
          ] as const,
      ),
      ...[
        [loserId, otherPayer],
        [thirdParty, loserId],
      ].map(
        ([organizationId, counterpartyOrganizationId]) =>
          [
            `insert into "related_payer_requests" ("id","organization_id","direction","sender_customer_account_id","tax_id_normalized","contact_email",
               "counterparty_organization_id","routing","approval_mode","unregistered_mode","state","sales_channel_id","language","expires_at","created_at","updated_at")
             values (?, ?, 'buyer_request', ?, 'PL0000000000', 'payer@example.test', ?, 'counterparty', 'counterparty', 'reject', 'pending', ?, 'pl',
                     now() + interval '7 days', now(), now())`,
            [id(), organizationId, loserAdmin, counterpartyOrganizationId, channelId],
          ] as const,
      ),
      // returns
      ...returnCases.map(
        (caseId) =>
          [
            `insert into "return_cases" ("id","kind","sales_channel_id","status_code","currency","submitted_at","order_id","customer_account_id","organization_id","rma_number","created_at","updated_at")
             values (?, 'return', ?, 'submitted', 'PLN', now(), ?, ?, ?, ?, now(), now())`,
            [caseId, channelId, loserOrder, loserAdmin, loserId, `RMA-E2E-${caseId.slice(0, 8)}`],
          ] as const,
      ),
      [
        `insert into "return_case_attachments" ("id","return_case_id","organization_id","storage_locator","created_at") values (?, ?, ?, ?, now())`,
        [id(), returnCases[0], loserId, `returns/${loserId}/e2e.pdf`],
      ],
      [
        `insert into "return_withdrawal_statements"
           ("id","return_case_id","order_id","organization_id","channel","submission_id","submitted_at","order_number","scope","lines","within_statutory_period","created_at")
         values (?, ?, ?, ?, 'storefront', ?, now(), 'ORD-E2E-1', 'whole_order', '[]'::jsonb, true, now())`,
        [id(), returnCases[1], loserOrder, loserId, id()],
      ],
      // shopping_lists
      [
        `insert into "shopping_lists" ("id","organization_id","customer_account_id","name","created_at","updated_at") values (?, ?, ?, 'E2E list', now(), now())`,
        [id(), loserId, loserAdmin],
      ],
      // webhooks
      [
        `insert into "webhooks" ("id","name","url","secret","organization_id","created_at","updated_at") values (?, 'e2e', 'https://hooks.example.test/e2e', 's', ?, now(), now())`,
        [id(), loserId],
      ],
    ]);
    // crm, through the module's own seed helper (status history included)
    for (let n = 0; n < 2; n += 1) {
      await seedAnalyticsOpportunity(h.em().fork(), { organizationId: loserId, statuses: [['new', new Date().toISOString()]] });
    }
    return { loserMembers: [loserAdmin, loserMember] };
  }

  /** A pair of live company Organizations, both reached by the test administrator. */
  async function pair(name: string): Promise<Pair> {
    return {
      survivorId: await insertCompanyOrganization(h, `${name} survivor`),
      loserId: await insertCompanyOrganization(h, `${name} loser`),
    };
  }

  /** What the merge leaves: per derived column, the rows naming each side, plus the sums and policies it decides. */
  async function outcome({ survivorId, loserId }: Pair): Promise<Record<string, unknown>> {
    const picture: Record<string, unknown> = {};
    for (const col of columns) {
      const key = `${col.moduleId}:${col.label}${col.discriminator ? `[${col.discriminator.value}]` : ''}`;
      picture[key] = { survivor: await referencing(col, survivorId), loser: await referencing(col, loserId) };
    }
    const [counter] = await sql<Array<{ count: number }>>(
      `select sum("count")::int as "count" from "promotion_usage_counters" where "scope_type" = 'organization' and "scope_key" like ?`,
      [`%:${survivorId}`],
    );
    const [limit] = await sql<Array<{ granted_amount: string }>>(`select "granted_amount" from "credit_limits" where "organization_id" = ?`, [survivorId]);
    const [exposure] = await sql<Array<{ amount: string }>>(
      `select coalesce(sum(r."amount"), 0)::text as "amount" from "credit_limit_reservations" r join "credit_limits" l on l."id" = r."credit_limit_id" where l."organization_id" = ?`,
      [survivorId],
    );
    const [mfa] = await sql<Array<{ enforce_totp: boolean }>>(`select "enforce_totp" from "mfa_organization_policies" where "organization_id" = ?`, [survivorId]);
    const [policy] = await sql<Array<{ price_proposals_allowed: boolean }>>(
      `select "price_proposals_allowed" from "quote_request_org_policies" where "organization_id" = ?`,
      [survivorId],
    );
    const roles = await sql<Array<{ kind: string }>>(
      `select r."kind" from "customer_accounts" a join "organization_roles" r on r."id" = a."organization_role_id" where a."organization_id" = ? order by 1`,
      [survivorId],
    );
    const roleOwners = await sql<Array<{ n: number }>>(
      `select count(*)::int as "n" from "customer_accounts" a join "organization_roles" r on r."id" = a."organization_role_id"
        where a."organization_id" = ? and r."organization_id" <> a."organization_id"`,
      [survivorId],
    );
    return {
      ...picture,
      promotionCounter: counter?.count ?? null,
      creditLimit: limit?.granted_amount ?? null,
      creditExposure: exposure?.amount ?? null,
      mfaEnforced: mfa?.enforce_totp ?? null,
      quotePolicy: policy?.price_proposals_allowed ?? null,
      memberRoles: roles.map((row) => row.kind),
      membersOnForeignRoles: roleOwners[0]!.n,
    };
  }

  const preview = (survivorId: string, loserId: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/organizations/${survivorId}/merge-preview`, cookies, payload: { loserId } });

  async function start({ survivorId, loserId }: Pair): Promise<RecordMergeRecord> {
    const previewed = await preview(survivorId, loserId);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.json().data.refusals).toEqual([]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${survivorId}/merges`,
      cookies,
      payload: { loserId, acknowledgeIrreversible: true, fieldChoices: { name: 'survivor' } },
    });
    expect(res.statusCode, res.body).toBe(202);
    return res.json().data as RecordMergeRecord;
  }

  const readMerge = async (mergeId: string): Promise<RecordMergeRecord> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organization-merges/${mergeId}`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as RecordMergeRecord;
  };

  /** Run the merge as the worker would, then once more for a trailing step left behind. */
  async function drive(mergeId: string): Promise<RecordMergeRecord> {
    await h.recordMergeRuntime.run(mergeId);
    let record = await readMerge(mergeId);
    if (record.state === 'completed' && record.steps.some((step) => step.trailing && step.state !== 'done' && step.state !== 'deferred')) {
      await h.recordMergeRuntime.run(mergeId);
      record = await readMerge(mergeId);
    }
    return record;
  }

  /** Every moving column has a row on the loser — the seed reaches every participant. */
  async function expectEveryParticipantSeeded(loserId: string): Promise<void> {
    const empty: string[] = [];
    for (const col of columns) {
      if (col.disposition === 'kept' || col.disposition === 'survivor_wins') continue;
      if ((await referencing(col, loserId)) === 0) empty.push(`${col.moduleId}:${col.label}`);
    }
    expect(empty, 'a declared Organization reference has no seeded row — extend seedEveryParticipant').toEqual([]);
  }

  /** SC-001 over the derived columns. */
  async function expectNoReferenceLeft(p: Pair, keptBefore: Map<string, number>): Promise<void> {
    const left: string[] = [];
    for (const col of columns) {
      const label = `${col.moduleId}:${col.label}`;
      if (col.disposition === 'kept' || col.disposition === 'survivor_wins') {
        // Untouched: what named the loser still does.
        expect(await referencing(col, p.loserId), `${label} is kept on the loser`).toBe(keptBefore.get(label) ?? 0);
        continue;
      }
      if (col.disposition === 'survivor_wins_fill_gaps' || col.disposition === 'stricter') {
        // A loser row may stay only behind the survivor's own.
        if ((await referencing(col, p.loserId)) > 0) {
          expect(await referencing(col, p.survivorId), `${label}: a loser row stays without a survivor row`).toBeGreaterThan(0);
        }
        continue;
      }
      const exception = SC001_EXCEPTIONS[col.label]?.(p);
      const n = await referencing(col, p.loserId, exception);
      if (n > 0) left.push(`${label} (${n})`);
    }
    expect(left, 'SC-001: rows still naming the archived loser').toEqual([]);
    // The loser's role definitions stay on it (an exception above), so nothing live may hold one.
    const holders = await sql<Array<{ n: number }>>(
      `select ((select count(*) from "customer_accounts" a join "organization_roles" r on r."id" = a."organization_role_id" where r."organization_id" = ?)
             + (select count(*) from "organization_invitations" i join "organization_roles" r on r."id" = i."organization_role_id" where r."organization_id" = ?))::int as "n"`,
      [p.loserId, p.loserId],
    );
    expect(holders[0]!.n, 'a member or an invitation still holds a role of the archived loser').toBe(0);
  }

  async function keptCounts(loserId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const col of columns) {
      if (col.disposition !== 'kept' && col.disposition !== 'survivor_wins') continue;
      counts.set(`${col.moduleId}:${col.label}`, await referencing(col, loserId));
    }
    return counts;
  }

  it('derives a column for every declared Organization reference of every participant', () => {
    const modules = new Set(columns.map((col) => col.moduleId));
    for (const moduleId of h.recordMergeRuntime.registry.participantsOf('organization').map((p) => p.moduleId)) {
      expect(modules.has(moduleId), moduleId).toBe(true);
    }
    expect(columns.length).toBeGreaterThan(40);
  });

  // MikroORM 7 returns the metadata as a `Map`, which `Object.values` reads as empty: the
  // runtime twin then saw no population and every module passed as covered.
  it('reads the composed population into the runtime coverage, and finds every reference covered', () => {
    const coverage = h.recordMergeRuntime.coverage();
    expect(coverage.sites).toBeGreaterThan(40);
    expect(coverage.uncoveredModules).toEqual([]);
  });

  describe('an uninterrupted merge (the control of SC-003)', () => {
    let control: Pair;
    let finalState: Record<string, unknown>;

    it('seeds every participant, merges through the routes and the runner, and leaves no reference (SC-001)', async () => {
      control = await pair('E2E control');
      await seedEveryParticipant(control);
      await expectEveryParticipantSeeded(control.loserId);
      const kept = await keptCounts(control.loserId);
      const merge = await start(control);
      const record = await drive(merge.id);
      expect(record.state).toBe('completed');
      expect(record.steps.filter((step) => step.state !== 'done')).toEqual([]);
      await expectNoReferenceLeft(control, kept);
      finalState = await outcome(control);
      expect(finalState).toMatchObject({
        promotionCounter: 5,
        creditLimit: '1000.00',
        creditExposure: '40.00',
        mfaEnforced: true,
        quotePolicy: true,
        membersOnForeignRoles: 0,
      });
    }, 180_000);

    describe('a merge interrupted in one step, with crm off throughout (SC-003, US4)', () => {
      let p: Pair;
      let merge: RecordMergeRecord;
      let kept: Map<string, number>;
      let loserMembers: string[];
      let crmBefore: Array<{ id: string; organization_id: string; updated_at: Date }>;
      let since: Date;
      const membersAnnounced: Array<{ mode: string; mergeId: string | null }> = [];
      const trigger = 'e2e_merge_fail_orders';

      beforeAll(async () => {
        p = await pair('E2E interrupted');
        ({ loserMembers } = await seedEveryParticipant(p));
        await expectEveryParticipantSeeded(p.loserId);
        kept = await keptCounts(p.loserId);
        crmBefore = await sql(`select "id","organization_id","updated_at" from "crm_opportunities" where "organization_id" = ? order by "id"`, [p.loserId]);
        h.eventBus.on(CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT, (payload) => {
          membersAnnounced.push(payload as never);
        });
        await sql(
          `create or replace function "e2e_merge_injected_failure"() returns trigger language plpgsql as $$
             begin raise exception 'injected merge step failure'; end $$`,
        );
        await sql(
          `create trigger "${trigger}" before update on "orders" for each row
             when (OLD."organization_id" = '${p.loserId}' or OLD."payer_organization_id" = '${p.loserId}')
             execute function "e2e_merge_injected_failure"()`,
        );
      }, 120_000);

      afterAll(async () => {
        await sql(`drop trigger if exists "${trigger}" on "orders"`);
      });

      it('stops in needs_attention naming the failed step, with the earlier steps done and crm deferred', async () => {
        const [clock] = await sql<Array<{ now: Date }>>('select clock_timestamp() as "now"');
        since = clock!.now;
        await withModulesDeactivated(['crm'], async () => {
          merge = await start(p);
          expect(merge.steps.find((step) => step.moduleId === 'crm')).toBeDefined();
          await h.recordMergeRuntime.run(merge.id);
        });
        const record = await readMerge(merge.id);
        expect(record.state).toBe('needs_attention');
        const step = (moduleId: string) => record.steps.find((s) => s.moduleId === moduleId)!;
        expect(step('orders')).toMatchObject({ state: 'failed' });
        expect(step('orders').lastErrorCode).not.toBeNull();
        // Earlier phases finished before the records phase failed.
        for (const moduleId of ['organizations', 'customer_accounts', 'addresses', 'catalog', 'price_lists']) {
          expect(step(moduleId).state, moduleId).toBe('done');
        }
        expect(step('crm')).toMatchObject({ state: 'deferred', deferredReason: 'module_off' });
        // The failed step rolled back whole: the loser's orders still name it.
        expect(await sql<unknown[]>(`select 1 from "orders" where "organization_id" = ?`, [p.loserId])).toHaveLength(1);
        // Frozen, not archived, while it waits.
        const [loser] = await sql<Array<{ deleted_at: Date | null }>>(`select "deleted_at" from "organizations" where "id" = ?`, [p.loserId]);
        expect(loser!.deleted_at).toBeNull();
        expect(merged.filter((event) => (event as { mergeId: string }).mergeId === merge.id)).toEqual([]);
      }, 180_000);

      it('resumes once the cause is gone and completes, with crm still deferred and untouched (US4)', async () => {
        await sql(`drop trigger if exists "${trigger}" on "orders"`);
        const current = await readMerge(merge.id);
        await withModulesDeactivated(['crm'], async () => {
          const resume = await h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/organization-merges/${merge.id}/resume`,
            cookies,
            payload: { expectedVersion: current.version },
          });
          expect(resume.statusCode, resume.body).toBe(200);
          const record = await drive(merge.id);
          expect(record.state).toBe('completed');
          expect(record.steps.filter((step) => step.state !== 'done').map((step) => `${step.moduleId}:${step.state}`)).toEqual(['crm:deferred']);
        });
        const crmNow = await sql(`select "id","organization_id","updated_at" from "crm_opportunities" where "organization_id" = ? order by "id"`, [p.loserId]);
        expect(crmNow).toEqual(crmBefore);
      }, 180_000);

      it('catches crm up when it is switched back on, under the original merge id (US4, SC-007)', async () => {
        expect(await h.recordMergeRuntime.catchUp()).toContain(merge.id);
        await h.recordMergeRuntime.run(merge.id);
        const record = await readMerge(merge.id);
        expect(record.steps.find((step) => step.moduleId === 'crm')).toMatchObject({ state: 'done' });
        expect(await sql<unknown[]>(`select 1 from "crm_opportunities" where "organization_id" = ?`, [p.loserId])).toEqual([]);
        const crmAudit = await sql<Array<{ merge_id: string }>>(
          `select "state_after" ->> 'mergeId' as "merge_id" from "audit_log_entries" where "action" = 'crm.opportunity.merge_reassign' and "object_id" = ?`,
          [p.survivorId],
        );
        expect(crmAudit.length).toBeGreaterThan(0);
        expect(crmAudit.every((entry) => entry.merge_id === merge.id)).toBe(true);
      }, 120_000);

      it('leaves no reference to the loser in any declared column (SC-001)', async () => {
        await expectNoReferenceLeft(p, kept);
      });

      it('reaches the state the uninterrupted merge reached: no duplicate union row, no double sum (SC-003)', async () => {
        expect(await outcome(p)).toEqual(finalState);
      });

      it('moved every member with the merge mode and its mapped role (US1, membership-merge-mode §2)', async () => {
        const rows = await sql<Array<{ organization_id: string }>>(
          `select "organization_id" from "customer_accounts" where "id" = any(?::uuid[])`,
          [`{${loserMembers.join(',')}}`],
        );
        expect(rows.map((row) => row.organization_id)).toEqual([p.survivorId, p.survivorId]);
        const ours = membersAnnounced.filter((event) => event.mergeId === merge.id);
        expect(ours).toHaveLength(2);
        expect(ours.every((event) => event.mode === 'merge')).toBe(true);
      });

      it('writes the merge id into every audit entry it wrote, and one merge entry in the survivor’s history (SC-004)', async () => {
        const entries = await sql<Array<{ action: string; merge_id: string | null }>>(
          `select "action", "state_after" ->> 'mergeId' as "merge_id" from "audit_log_entries" where "acted_at" >= ? order by "acted_at"`,
          [since],
        );
        expect(entries.length).toBeGreaterThan(10);
        expect(entries.filter((entry) => entry.merge_id !== merge.id).map((entry) => entry.action)).toEqual([]);
        const history = await sql<unknown[]>(
          `select 1 from "audit_log_entries" where "object_type" = 'organization' and "object_id" = ? and "action" = 'organization.merge.start'`,
          [p.survivorId],
        );
        expect(history).toHaveLength(1);
      });

      it('publishes organization.merged.v1 once for this merge (FR-054)', () => {
        const ours = merged.filter((event) => (event as { mergeId: string }).mergeId === merge.id);
        expect(ours).toEqual([expect.objectContaining({ organizationId: p.survivorId, mergedOrganizationId: p.loserId, mergeId: merge.id })]);
      });

      it('answers the archived loser with its survivor, lists it nowhere, and refuses a write naming it (US3)', async () => {
        const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${p.loserId}`, cookies });
        expect(read.statusCode, read.body).toBe(200);
        expect(read.json().data).toMatchObject({ mergedIntoOrganizationId: p.survivorId, mergeId: merge.id });

        const [loser] = await sql<Array<{ name: string }>>(`select "name" from "organizations" where "id" = ?`, [p.loserId]);
        const list = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations?q=${encodeURIComponent(loser!.name)}`, cookies });
        expect(list.statusCode, list.body).toBe(200);
        expect(list.json().data.map((row: { id: string }) => row.id)).not.toContain(p.loserId);

        // A participant's write naming the loser, through the tenant write guard.
        await expect(
          runWithTenantContext(admin, async () => {
            const em = h.em().fork();
            em.persist(
              em.create(Address, {
                organizationId: p.loserId,
                kind: 'delivery',
                recipientName: 'Too late',
                street: 'ul. Krótka 2',
                city: 'Kraków',
                postalCode: '30-002',
                country: 'PL',
              } as never),
            );
            await em.flush();
          }),
        ).rejects.toMatchObject({ statusCode: 409, code: 'ORGANIZATION_MERGED', details: { survivorId: p.survivorId } });
      });
    });
  });
});
