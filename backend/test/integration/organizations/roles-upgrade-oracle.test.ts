import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  Address,
  Cart,
  CartItem,
  CustomerAccount,
  Order,
  OrderItem,
  Organization,
  QuoteRequest,
  QuoteRequestItem,
  ShoppingList,
} from '../../helpers/package-entities.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';
import {
  ORACLE_KEY_OF_ID,
  ORACLE_POPULATION as POPULATION,
  ORACLE_REQUESTS,
  PRE_UPGRADE_OUTCOMES,
  oracleMember,
  oracleOrganization,
  type OracleChannelCode,
  type OracleMemberKey,
  type OracleOutcome,
  type OracleRequest,
} from '../../fixtures/organization-roles/pre-upgrade-outcomes.js';

/**
 * The pre-upgrade roles oracle — `specs/170-organization-roles/`, WP-00 (R-27,
 * `contracts/migration-and-replay.md` §5).
 *
 * Seeds `ORACLE_POPULATION` through today's entities and operator routes, sends
 * every `ORACLE_REQUESTS` entry in order as the member it names, and asserts each
 * `{ status, code }` equals the recorded `PRE_UPGRADE_OUTCOMES` row. It is written
 * on `master`, before any 170 code exists, so the table is today's behaviour and
 * not anybody's belief about it; WP-13's replay asserts the same table against the
 * migrated schema, with the `oneClickInApprovalOrg` rows as the one permitted
 * difference (#653).
 *
 * **Seeding, and what is not an entity.** Organizations, accounts, addresses,
 * carts, orders, quote requests and shopping lists are created through the classes
 * the ORM registered. Three tables have no class this harness names — invitations,
 * shopping-list items and one-click defaults — and are inserted with plain SQL in
 * the columns their entities declare, which is what WP-13 does for every table.
 * Blocking and deleting a member go through the operator routes, which also revoke
 * the member's sessions: the blocked and the deleted member therefore send the
 * cookie of a session that resolves to nobody, as production's request would after
 * the withdrawal.
 *
 * **Every member authenticates with a real session** (`SessionService`), never a
 * stub cookie, so the actor each request carries is the one the session resolves.
 */

const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';
const OPERATOR = { b2b_session: 'stub-admin-session' };

describe('organization roles — the pre-upgrade oracle (170 WP-00)', () => {
  let h: BackendServerHandle;
  const channelIdOf = new Map<OracleChannelCode, string>();
  const channelCodeOf = new Map<OracleChannelCode, string>();
  const cookieOf = new Map<OracleMemberKey, string>();
  /** The stock this file draws on, put back in `afterAll`: the database is shared by the run. */
  let savedStock: Array<{ id: string; on_hand: number; reserved: number }> = [];

  const memberId = (key: OracleMemberKey): string => oracleMember(key).id;
  const addressIdOf = (key: string): string => POPULATION.addresses.find((a) => a.key === key)!.id;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const connection = em.getConnection();

    // ── Channels ─────────────────────────────────────────────────────────────
    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    channelIdOf.set('default', systemDefault.id);
    channelCodeOf.set('default', systemDefault.code);
    const extra = em.create(SalesChannel, {
      code: 'oracle_extra',
      name: { 'pl-PL': 'Oracle 170', 'en-US': 'Oracle 170' },
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
    });
    await em.persistAndFlush(extra);
    for (const code of ['pl_retail', 'pl_b2b_vip', 'oracle_extra'] as const) {
      const channel = await em.findOneOrFail(SalesChannel, { code });
      channelIdOf.set(code, channel.id);
      channelCodeOf.set(code, code);
    }

    // ── Organizations ────────────────────────────────────────────────────────
    for (const org of POPULATION.organizations) {
      em.create(Organization, {
        id: org.id,
        name: org.name,
        taxId: org.taxId,
        status: 'active',
        vatStatus: org.isPersonal ? 'vat_exempt' : 'vat_payer',
        isPersonal: org.isPersonal,
        requiresCartApproval: org.requiresCartApproval,
        registeredAddress: { street: 'ul. Wyroczni 170', city: 'Warszawa', postalCode: '00-170', country: 'PL' },
      });
    }
    await em.flush();
    for (const org of POPULATION.organizations) {
      await assignOrganizationChannels(
        h,
        org.id,
        org.channels.map((c) => channelCodeOf.get(c)!),
      );
    }

    // ── Members, each with a real session ────────────────────────────────────
    const passwordHash = await hashPassword('oracle-170-password-not-used');
    for (const member of POPULATION.members) {
      em.create(CustomerAccount, {
        id: member.id,
        organizationId: oracleOrganization(member.organization).id,
        email: member.email,
        passwordHash,
        firstName: 'Oracle',
        lastName: member.key,
        role: member.role,
        emailVerifiedAt: new Date(),
      });
    }
    await em.flush();
    for (const member of POPULATION.members) {
      const session = await h.sessionService.createSession({ kind: 'customer', customerAccountId: member.id });
      cookieOf.set(member.key, session.cookieValue);
    }

    // ── Addresses ────────────────────────────────────────────────────────────
    for (const address of POPULATION.addresses) {
      em.create(Address, {
        id: address.id,
        organizationId: oracleOrganization(address.organization).id,
        kind: address.kind,
        recipientName: `Oracle 170 ${address.key}`,
        street: 'ul. Wyroczni 170',
        city: 'Warszawa',
        postalCode: '00-170',
        country: 'PL',
        isDefault: address.isDefault,
      });
    }
    await em.flush();

    // ── Invitations (no harness entity class; the entity's columns) ──────────
    const day = 24 * 60 * 60 * 1000;
    for (const invitation of POPULATION.invitations) {
      const now = Date.now();
      await connection.execute(
        `insert into "organization_invitations"
           ("id", "organization_id", "invited_by_customer_account_id", "email", "role", "token_hash",
            "expires_at", "consumed_at", "revoked_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)`,
        [
          invitation.id,
          oracleOrganization(invitation.organization).id,
          memberId(invitation.invitedBy),
          invitation.email,
          invitation.role,
          createHash('sha256').update(randomBytes(32)).digest('hex'),
          new Date(invitation.state === 'expired' ? now - day : now + 7 * day),
          invitation.state === 'accepted' ? new Date(now - day / 2) : null,
          new Date(now - 2 * day),
          new Date(now - 2 * day),
        ],
      );
    }

    // ── Carts ────────────────────────────────────────────────────────────────
    for (const cart of POPULATION.carts) {
      const owner = oracleMember(cart.owner);
      const submitted = cart.approvalStatus !== 'not_required' ? new Date() : null;
      em.create(Cart, {
        id: cart.id,
        customerAccountId: owner.id,
        organizationId: oracleOrganization(owner.organization).id,
        salesChannelId: channelIdOf.get(cart.channel)!,
        status: cart.status,
        approvalStatus: cart.approvalStatus,
        submittedForApprovalAt: submitted,
        ...(cart.approvalStatus === 'approved'
          ? { approvedAt: new Date(), approvedByCustomerAccountId: memberId(`${owner.organization}.admin` as OracleMemberKey) }
          : {}),
        ...(cart.approvalStatus === 'rejected_by_org_admin'
          ? {
              rejectedAt: new Date(),
              rejectedByActor: `org_admin:${memberId(`${owner.organization}.admin` as OracleMemberKey)}`,
              rejectedReason: 'Oracle 170: seeded rejection',
            }
          : {}),
      });
    }
    await em.flush();
    for (const cart of POPULATION.carts) {
      em.create(CartItem, {
        cartId: cart.id,
        productId: POPULATION.productId,
        quantity: cart.quantity,
        unitPrice: POPULATION.unitPrice,
        currency: 'PLN',
      });
    }
    await em.flush();

    // ── Orders ───────────────────────────────────────────────────────────────
    const snapshotAddress = { recipientName: 'Oracle 170', street: 'ul. Wyroczni 170', city: 'Warszawa', postalCode: '00-170', country: 'PL' };
    for (const order of POPULATION.orders) {
      const placer = oracleMember(order.placedBy);
      em.create(Order, {
        id: order.id,
        businessId: `ORACLE-170-${order.key}`,
        organizationId: oracleOrganization(placer.organization).id,
        placedByCustomerAccountId: placer.id,
        salesChannelId: channelIdOf.get('default')!,
        status: 'completed',
        deliveryAddress: snapshotAddress,
        billingAddress: snapshotAddress,
        deliveryMethodId: POPULATION.deliveryMethodId,
        deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
        paymentMethodId: POPULATION.paymentMethodId,
        paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
        subtotal: POPULATION.unitPrice,
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: POPULATION.unitPrice,
        currency: 'PLN',
        placedAt: new Date(),
      });
    }
    await em.flush();
    for (const order of POPULATION.orders) {
      em.create(OrderItem, {
        orderId: order.id,
        productId: POPULATION.productId,
        productSnapshot: { sku: 'EXAMPLE-SIMPLE-001', name: 'Oracle 170 product', primaryAssetUrl: null },
        quantity: 1,
        unitPrice: POPULATION.unitPrice,
        taxRate: '0.0000',
        lineTotal: POPULATION.unitPrice,
      });
    }
    await em.flush();

    // ── Quote requests ───────────────────────────────────────────────────────
    for (const rfq of POPULATION.quoteRequests) {
      const owner = oracleMember(rfq.owner);
      em.create(QuoteRequest, {
        id: rfq.id,
        businessId: `QR-ORACLE-170-${rfq.key}`,
        organizationId: oracleOrganization(owner.organization).id,
        customerAccountId: owner.id,
        status: 'Pending',
        submittedAt: new Date(),
        salesChannelId: channelIdOf.get('default')!,
      });
    }
    await em.flush();
    for (const rfq of POPULATION.quoteRequests) {
      em.create(QuoteRequestItem, {
        quoteRequestId: rfq.id,
        productId: POPULATION.productId,
        productName: 'Oracle 170 product',
        quantity: 1,
        lineCurrency: 'PLN',
      });
    }
    await em.flush();

    // ── Shopping lists (items: no harness entity class) ──────────────────────
    for (const list of POPULATION.shoppingLists) {
      const owner = oracleMember(list.owner);
      em.create(ShoppingList, {
        id: list.id,
        organizationId: oracleOrganization(owner.organization).id,
        customerAccountId: owner.id,
        name: `Oracle 170 ${list.key}`,
      });
    }
    await em.flush();
    for (const list of POPULATION.shoppingLists) {
      await connection.execute(
        `insert into "shopping_list_items" ("id", "shopping_list_id", "product_id", "quantity", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 1, now(), now())`,
        [list.id, POPULATION.productId],
      );
    }

    // ── One-click: the Organizations' defaults and the channel setting ───────
    for (const defaults of POPULATION.oneClickDefaults) {
      await connection.execute(
        `insert into "quick_order_default_preferences"
           ("id", "scope", "scope_id", "default_payment_method_id", "default_delivery_method_id",
            "default_billing_address_id", "default_shipping_address_id", "created_at", "updated_at")
         values (gen_random_uuid(), 'organization', ?, ?, ?, ?, ?, now(), now())`,
        [
          oracleOrganization(defaults.organization).id,
          POPULATION.paymentMethodId,
          POPULATION.deliveryMethodId,
          addressIdOf(defaults.billingAddress),
          addressIdOf(defaults.deliveryAddress),
        ],
      );
    }
    await h.settings.adminService.setValueForSubset(
      ONE_CLICK_ENABLED,
      POPULATION.oneClickEnabledChannels.map((c) => channelCodeOf.get(c)!),
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);

    // ── Withdrawn members, through the operator's routes ─────────────────────
    for (const member of POPULATION.members) {
      if (member.state === 'active') continue;
      const res =
        member.state === 'blocked'
          ? await h.app.inject({
              method: 'POST',
              url: `/api/v1/admin/customers/${member.id}/block`,
              cookies: OPERATOR,
              payload: { reason: 'Oracle 170' },
            })
          : await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${member.id}`, cookies: OPERATOR });
      expect(res.statusCode, `${member.state} ${member.key}: ${res.body}`).toBe(200);
    }

    // ── Stock for the placements ─────────────────────────────────────────────
    savedStock = await connection.execute(
      `select "id", "on_hand", "reserved" from "stock_levels" where "product_id" = ?`,
      [POPULATION.productId],
    );
    await connection.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      POPULATION.productId,
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!h) return;
    const connection = h.em().getConnection();
    for (const row of savedStock) {
      await connection.execute(`update "stock_levels" set "on_hand" = ?, "reserved" = ? where "id" = ?`, [
        row.on_hand,
        row.reserved,
        row.id,
      ]);
    }
    await teardownBackendServer(h);
  });

  async function send(request: OracleRequest): Promise<OracleOutcome> {
    const res = await h.app.inject({
      method: request.method,
      url: request.path,
      cookies: { b2b_session: cookieOf.get(request.actor)! },
      headers: {
        'accept-language': 'en',
        ...(request.channel ? { 'x-sales-channel': channelCodeOf.get(request.channel)! } : {}),
        ...(request.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(request.body ? { payload: request.body as Record<string, unknown> } : {}),
    });
    return observe(request, res.statusCode, res.body);
  }

  it('declares every request once, with a stable id', () => {
    const ids = ORACLE_REQUESTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('answers every gated request exactly as recorded before the upgrade', async () => {
    const observed: Record<string, OracleOutcome> = {};
    for (const request of ORACLE_REQUESTS) {
      observed[request.id] = await send(request);
    }

    const unrecorded = ORACLE_REQUESTS.map((r) => r.id).filter((id) => !(id in PRE_UPGRADE_OUTCOMES));
    const stale = Object.keys(PRE_UPGRADE_OUTCOMES).filter((id) => !(id in observed));
    expect(
      { unrecorded, stale },
      `every request needs a recorded outcome and every recorded outcome a request; observed:\n${renderTable(observed)}`,
    ).toEqual({ unrecorded: [], stale: [] });

    const differing = ORACLE_REQUESTS.filter(
      (r) => JSON.stringify(observed[r.id]) !== JSON.stringify(PRE_UPGRADE_OUTCOMES[r.id]),
    ).map((r) => ({ id: r.id, recorded: PRE_UPGRADE_OUTCOMES[r.id], observed: observed[r.id] }));
    expect(differing).toEqual([]);
  }, 300_000);
});

/** The outcome a request is recorded as — see `OracleObservation`. */
function observe(request: OracleRequest, status: number, raw: string): OracleOutcome {
  let body: unknown = null;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const error = (body as { error?: { code?: string; details?: { code?: unknown } } } | null)?.error;
  if (status >= 400 || error) {
    if (!error?.code) return { status };
    const detail = typeof error.details?.code === 'string' ? `/${error.details.code}` : '';
    return { status, code: `${error.code}${detail}` };
  }
  const data = (body as { data?: unknown } | null)?.data;
  switch (request.observe ?? 'error') {
    case 'visible': {
      const rows = Array.isArray(data) ? (data as Array<{ id?: string }>) : [];
      const known = rows.map((r) => ORACLE_KEY_OF_ID.get(r.id ?? '')).filter((k): k is string => k !== undefined);
      const other = rows.length - known.length;
      return { status, code: `visible:${[...known.sort(), ...(other > 0 ? [`+${other}`] : [])].join(',')}` };
    }
    case 'primaryCta':
      return { status, code: `primaryCta:${String((data as { primaryCta?: unknown } | null)?.primaryCta)}` };
    case 'eligibility': {
      const e = data as { enabled?: boolean; reason?: string | null } | null;
      return { status, code: `eligibility:${e?.enabled ? 'enabled' : String(e?.reason)}` };
    }
    default:
      return { status };
  }
}

/** The observed table in the fixture's own syntax, for recording and for a reviewer. */
function renderTable(observed: Record<string, OracleOutcome>): string {
  return ORACLE_REQUESTS.map((r) => {
    const o = observed[r.id]!;
    return `  '${r.id}': { status: ${o.status}${o.code !== undefined ? `, code: '${o.code}'` : ''} },`;
  }).join('\n');
}
