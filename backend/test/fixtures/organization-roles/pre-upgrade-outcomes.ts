import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * The pre-upgrade roles oracle — `specs/170-organization-roles/`, WP-00 (R-27,
 * `contracts/migration-and-replay.md` §5).
 *
 * Three exports, and the division between them is the whole point of the file:
 *
 *  * {@link ORACLE_POPULATION} — the Organizations, members, invitations, carts and
 *    the role-free objects the gated requests act on (addresses, orders, quote
 *    requests, shopping lists, one-click defaults), as **plain data** with fixed ids.
 *    `roles-upgrade-oracle.test.ts` seeds it through today's entities and services;
 *    WP-13's replay inserts the same rows with raw SQL in the pre-170 shape.
 *  * {@link ORACLE_REQUESTS} — one request per gated action per member, in the order
 *    they are sent. **The order is part of the oracle**: several requests change what
 *    a later one sees (a placement completes a basket, a promotion changes a role), and
 *    the replay has to send them in the same sequence to mean anything.
 *  * {@link PRE_UPGRADE_OUTCOMES} — what today's code answered, recorded by running
 *    the requests once and reviewed by hand. It is **not** written from a belief
 *    about today's behaviour (R-27, *Alternatives rejected*).
 *
 * `roleToRoleId` is the one place a request body's legacy `role` becomes the
 * `roleId` the post-170 API takes; the replay sends every body through it, so the
 * API shape changes and the outcome must not.
 */

// ── Keys ────────────────────────────────────────────────────────────────────

export type OracleOrganizationKey = 'A' | 'B' | 'P';

/** The legacy customer-side role enum, as today's `customer_accounts.role` stores it. */
export type LegacyOrganizationRole = 'organization_admin' | 'regular_user';

/** The predefined role kind a legacy role maps to after the upgrade (M2/M3). */
export type OracleRoleKind = 'administrator' | 'member';

export type OracleMemberKey =
  | 'A.admin'
  | 'A.regular'
  | 'A.blocked'
  | 'A.deleted'
  | 'B.admin'
  | 'B.regular'
  | 'B.blocked'
  | 'B.deleted'
  | 'P.owner';

/**
 * The sales channels the population uses, by code. `default` is the system-default
 * channel a header-less storefront request resolves to; `pl_retail` and
 * `pl_b2b_vip` are the harness's seeded storefronts; `oracle_extra` is created by
 * the oracle itself, only to hold a fifth basket of B's regular user (a customer
 * holds one active basket per channel).
 */
export type OracleChannelCode = 'default' | 'pl_retail' | 'pl_b2b_vip' | 'oracle_extra';

// ── Population shapes ───────────────────────────────────────────────────────

export interface OracleOrganization {
  key: OracleOrganizationKey;
  id: string;
  name: string;
  taxId: string;
  isPersonal: boolean;
  requiresCartApproval: boolean;
  /** Channels the Organization is assigned to (feature 154); the default one is always among them. */
  channels: readonly OracleChannelCode[];
}

export interface OracleMember {
  key: OracleMemberKey;
  id: string;
  organization: OracleOrganizationKey;
  email: string;
  role: LegacyOrganizationRole;
  /**
   * `blocked` and `deleted` are reached through today's operator routes, which also
   * revoke every session of the account — so their requests carry a session cookie
   * that resolves to nobody, as production's would after the withdrawal.
   */
  state: 'active' | 'blocked' | 'deleted';
}

export interface OracleInvitation {
  key: string;
  id: string;
  organization: OracleOrganizationKey;
  email: string;
  role: LegacyOrganizationRole;
  state: 'pending' | 'expired' | 'accepted';
  invitedBy: OracleMemberKey;
}

export type OracleCartApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected_by_org_admin';

export interface OracleCart {
  key: string;
  id: string;
  owner: OracleMemberKey;
  channel: OracleChannelCode;
  status: 'active' | 'rejected';
  approvalStatus: OracleCartApprovalStatus;
  /** One line of the seeded product, at this quantity. */
  quantity: number;
}

export interface OracleAddress {
  key: string;
  id: string;
  organization: OracleOrganizationKey;
  kind: 'delivery' | 'billing';
  isDefault: boolean;
}

export interface OracleOrder {
  key: string;
  id: string;
  placedBy: OracleMemberKey;
}

export interface OracleQuoteRequest {
  key: string;
  id: string;
  owner: OracleMemberKey;
}

export interface OracleShoppingList {
  key: string;
  id: string;
  owner: OracleMemberKey;
}

/** Organization-scope one-click defaults (`quick_order_default_preferences`, scope `organization`). */
export interface OracleOneClickDefaults {
  organization: OracleOrganizationKey;
  deliveryAddress: string;
  billingAddress: string;
}

export interface OraclePopulation {
  /** The one product every line, order and quote request names. */
  productId: string;
  deliveryMethodId: string;
  paymentMethodId: string;
  /** Unit price stored on seeded cart, order and quote lines. */
  unitPrice: string;
  organizations: readonly OracleOrganization[];
  members: readonly OracleMember[];
  invitations: readonly OracleInvitation[];
  carts: readonly OracleCart[];
  addresses: readonly OracleAddress[];
  orders: readonly OracleOrder[];
  quoteRequests: readonly OracleQuoteRequest[];
  shoppingLists: readonly OracleShoppingList[];
  oneClickDefaults: readonly OracleOneClickDefaults[];
  /** `quick_order.one_click_buy_enabled` is set `true` for these channels. */
  oneClickEnabledChannels: readonly OracleChannelCode[];
}

// ── Population ──────────────────────────────────────────────────────────────

/** A fixed, version-4-shaped id in a block of its own (`…-4170-8…`). */
function oracleId(n: number): string {
  return `00000000-0000-4170-8000-${n.toString(16).padStart(12, '0')}`;
}

const ORGANIZATIONS: readonly OracleOrganization[] = [
  {
    key: 'A',
    id: oracleId(0xa0),
    name: 'Oracle 170 Organization A',
    taxId: 'PL1700000001',
    isPersonal: false,
    requiresCartApproval: false,
    channels: ['default', 'pl_retail', 'pl_b2b_vip'],
  },
  {
    key: 'B',
    id: oracleId(0xb0),
    name: 'Oracle 170 Organization B',
    taxId: 'PL1700000002',
    isPersonal: false,
    requiresCartApproval: true,
    channels: ['default', 'pl_retail', 'pl_b2b_vip', 'oracle_extra'],
  },
  {
    key: 'P',
    id: oracleId(0xc0),
    name: 'Oracle 170 Personal',
    taxId: 'PERSONAL-170-ORACLE',
    isPersonal: true,
    requiresCartApproval: false,
    channels: ['default', 'pl_retail', 'pl_b2b_vip'],
  },
];

const MEMBERS: readonly OracleMember[] = [
  { key: 'A.admin', id: oracleId(0xa1), organization: 'A', email: 'oracle170-a-admin@example.com', role: 'organization_admin', state: 'active' },
  { key: 'A.regular', id: oracleId(0xa2), organization: 'A', email: 'oracle170-a-regular@example.com', role: 'regular_user', state: 'active' },
  { key: 'A.blocked', id: oracleId(0xa3), organization: 'A', email: 'oracle170-a-blocked@example.com', role: 'regular_user', state: 'blocked' },
  { key: 'A.deleted', id: oracleId(0xa4), organization: 'A', email: 'oracle170-a-deleted@example.com', role: 'regular_user', state: 'deleted' },
  { key: 'B.admin', id: oracleId(0xb1), organization: 'B', email: 'oracle170-b-admin@example.com', role: 'organization_admin', state: 'active' },
  { key: 'B.regular', id: oracleId(0xb2), organization: 'B', email: 'oracle170-b-regular@example.com', role: 'regular_user', state: 'active' },
  { key: 'B.blocked', id: oracleId(0xb3), organization: 'B', email: 'oracle170-b-blocked@example.com', role: 'regular_user', state: 'blocked' },
  { key: 'B.deleted', id: oracleId(0xb4), organization: 'B', email: 'oracle170-b-deleted@example.com', role: 'regular_user', state: 'deleted' },
  // Today's personal Organization holds its individual as `regular_user`: neither
  // `createStandalone` nor the federated sign-in names a role, and the entity's
  // default is `regular_user`. The oracle records that as it is.
  { key: 'P.owner', id: oracleId(0xc1), organization: 'P', email: 'oracle170-p-owner@example.com', role: 'regular_user', state: 'active' },
];

/** One pending, one expired and one accepted invitation of each kind, per company Organization. */
const INVITATIONS: readonly OracleInvitation[] = (['A', 'B'] as const).flatMap((org, o) =>
  (['regular_user', 'organization_admin'] as const).flatMap((role, r) =>
    (['pending', 'expired', 'accepted'] as const).map((state, s) => ({
      key: `${org}.invitation.${role === 'regular_user' ? 'regular' : 'admin'}.${state}`,
      id: oracleId(0x1000 + o * 0x100 + r * 0x10 + s),
      organization: org,
      email: `oracle170-${org.toLowerCase()}-invitee-${role === 'regular_user' ? 'regular' : 'admin'}-${state}@example.com`,
      role,
      state,
      invitedBy: `${org}.admin` as OracleMemberKey,
    })),
  ),
);

const CARTS: readonly OracleCart[] = [
  // Every active member's own basket on the default channel, not requiring approval —
  // B's regular user excepted, whose default basket is the approved one below.
  { key: 'A.cart.admin', id: oracleId(0x2a1), owner: 'A.admin', channel: 'default', status: 'active', approvalStatus: 'not_required', quantity: 1 },
  { key: 'A.cart.regular', id: oracleId(0x2a2), owner: 'A.regular', channel: 'default', status: 'active', approvalStatus: 'not_required', quantity: 1 },
  { key: 'B.cart.admin', id: oracleId(0x2b1), owner: 'B.admin', channel: 'default', status: 'active', approvalStatus: 'not_required', quantity: 1 },
  { key: 'P.cart.owner', id: oracleId(0x2c1), owner: 'P.owner', channel: 'default', status: 'active', approvalStatus: 'not_required', quantity: 1 },
  // B's regular user: one cart per approval state, one active basket per channel.
  { key: 'B.cart.approved', id: oracleId(0x2b2), owner: 'B.regular', channel: 'default', status: 'active', approvalStatus: 'approved', quantity: 1 },
  { key: 'B.cart.pending', id: oracleId(0x2b3), owner: 'B.regular', channel: 'pl_retail', status: 'active', approvalStatus: 'pending', quantity: 1 },
  { key: 'B.cart.notRequired', id: oracleId(0x2b4), owner: 'B.regular', channel: 'pl_b2b_vip', status: 'active', approvalStatus: 'not_required', quantity: 1 },
  { key: 'B.cart.rejected', id: oracleId(0x2b5), owner: 'B.regular', channel: 'pl_retail', status: 'rejected', approvalStatus: 'rejected_by_org_admin', quantity: 1 },
  // A second pending cart, so the reject family has a target the approve family does not consume.
  { key: 'B.cart.pendingForReject', id: oracleId(0x2b6), owner: 'B.regular', channel: 'oracle_extra', status: 'active', approvalStatus: 'pending', quantity: 1 },
];

/** Each Organization's default delivery and billing address, plus one spare per active member. */
const ADDRESSES: readonly OracleAddress[] = [
  ...(['A', 'B', 'P'] as const).flatMap((org, o) => [
    { key: `${org}.address.delivery`, id: oracleId(0x3000 + o * 0x10), organization: org, kind: 'delivery' as const, isDefault: true },
    { key: `${org}.address.billing`, id: oracleId(0x3001 + o * 0x10), organization: org, kind: 'billing' as const, isDefault: true },
  ]),
  ...MEMBERS.filter((m) => m.state === 'active').map((m, i) => ({
    key: `${m.key}.address.spare`,
    id: oracleId(0x3100 + i),
    organization: m.organization,
    kind: 'delivery' as const,
    isDefault: false,
  })),
];

const ACTIVE_MEMBERS = MEMBERS.filter((m) => m.state === 'active');

/** One order, one quote request and one shopping list per active member. */
const ORDERS: readonly OracleOrder[] = ACTIVE_MEMBERS.map((m, i) => ({
  key: `${m.key}.order`,
  id: oracleId(0x4000 + i),
  placedBy: m.key,
}));

const QUOTE_REQUESTS: readonly OracleQuoteRequest[] = ACTIVE_MEMBERS.map((m, i) => ({
  key: `${m.key}.quoteRequest`,
  id: oracleId(0x5000 + i),
  owner: m.key,
}));

const SHOPPING_LISTS: readonly OracleShoppingList[] = ACTIVE_MEMBERS.map((m, i) => ({
  key: `${m.key}.shoppingList`,
  id: oracleId(0x6000 + i),
  owner: m.key,
}));

export const ORACLE_POPULATION: OraclePopulation = {
  productId: SEED_PRODUCT_101_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
  unitPrice: '19.99',
  organizations: ORGANIZATIONS,
  members: MEMBERS,
  invitations: INVITATIONS,
  carts: CARTS,
  addresses: ADDRESSES,
  orders: ORDERS,
  quoteRequests: QUOTE_REQUESTS,
  shoppingLists: SHOPPING_LISTS,
  oneClickDefaults: (['A', 'B', 'P'] as const).map((org) => ({
    organization: org,
    deliveryAddress: `${org}.address.delivery`,
    billingAddress: `${org}.address.billing`,
  })),
  oneClickEnabledChannels: ['default'],
};

// ── Lookups ─────────────────────────────────────────────────────────────────

function byKey<T extends { key: string }>(rows: readonly T[], key: string): T {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`oracle population: no row "${key}"`);
  return row;
}

export const oracleOrganization = (key: OracleOrganizationKey): OracleOrganization => byKey(ORGANIZATIONS, key);
export const oracleMember = (key: OracleMemberKey): OracleMember => byKey(MEMBERS, key);

/** Every population id → its key, so a list answer can be stated as which seeded rows it showed. */
export const ORACLE_KEY_OF_ID: ReadonlyMap<string, string> = new Map(
  [
    ...ORGANIZATIONS,
    ...MEMBERS,
    ...INVITATIONS,
    ...CARTS,
    ...ADDRESSES,
    ...ORDERS,
    ...QUOTE_REQUESTS,
    ...SHOPPING_LISTS,
  ].map((row) => [row.id, row.key]),
);

// ── Requests ────────────────────────────────────────────────────────────────

/**
 * What a request's outcome records beyond its status, so a `200` that shows a
 * different set of rows, or a basket answering a different primary action, is a
 * different outcome:
 *
 *  * `error` (default) — the error envelope's `code`, and its `details.code` when
 *    there is one, as `CODE/detail`; nothing on a success.
 *  * `visible` — on a success, the population keys of the rows in `data` (sorted,
 *    comma-joined; `+N` for rows the population does not name).
 *  * `primaryCta` — on a success, the basket's `primaryCta`.
 *  * `eligibility` — on a success, `enabled` or the refusal `reason`.
 */
export type OracleObservation = 'error' | 'visible' | 'primaryCta' | 'eligibility';

export interface OracleRequest {
  /** `<family>:<member>[@<channel>]` — stable across runs and across the upgrade. */
  id: string;
  family: string;
  actor: OracleMemberKey;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: Readonly<Record<string, unknown>>;
  /** The storefront the request is made on (`X-Sales-Channel`); absent = the system default. */
  channel?: Exclude<OracleChannelCode, 'default'>;
  observe?: OracleObservation;
  /**
   * #653 — one-click in an approval-requiring Organization by a member who is not
   * its administrator. The one outcome the upgrade is meant to change: after it,
   * *Member* in B lacks `carts.order_without_approval` and `quick_order.one_click`
   * (FR-071), so these rows answer `403 ORGANIZATION_PERMISSION_REQUIRED` /
   * eligibility `cart_approval_required` in the replay. B's administrator holds
   * every permission and B's blocked and deleted members are refused before any
   * permission is read, so their one-click rows are not tagged.
   */
  tags?: readonly 'oneClickInApprovalOrg'[];
}

export interface OracleOutcome {
  status: number;
  code?: string;
}

/**
 * The actors of every family, in the order each family sends them: within an
 * Organization the members who are refused go first, so the one request that
 * succeeds on a shared target (the administrator's) runs after them.
 */
const ACTORS: readonly OracleMemberKey[] = [
  'A.regular',
  'A.blocked',
  'A.deleted',
  'A.admin',
  'B.regular',
  'B.blocked',
  'B.deleted',
  'B.admin',
  'P.owner',
];

const orgOf = (actor: OracleMemberKey): OracleOrganizationKey => oracleMember(actor).organization;
const idOf = (rows: readonly { key: string; id: string }[], key: string): string => byKey(rows, key).id;

/** The colleague whose objects a member acts on: the administrator for everyone else, a regular user for the administrator, oneself in a personal Organization. */
function colleagueOf(actor: OracleMemberKey): OracleMemberKey {
  const org = orgOf(actor);
  if (org === 'P') return 'P.owner';
  return actor === `${org}.admin` ? (`${org}.regular` as OracleMemberKey) : (`${org}.admin` as OracleMemberKey);
}

/** A member's own seeded object, or — for a blocked or deleted member, who has none — the regular user's. */
function ownerFor(actor: OracleMemberKey): OracleMemberKey {
  return oracleMember(actor).state === 'active' ? actor : (`${orgOf(actor)}.regular` as OracleMemberKey);
}

function addressId(org: OracleOrganizationKey, kind: 'delivery' | 'billing'): string {
  return idOf(ADDRESSES, `${org}.address.${kind}`);
}

/** The basket an Organization's administrator would look at: the regular user's (B: the pending one). */
function orgCartTarget(actor: OracleMemberKey, purpose: 'read' | 'approve' | 'reject'): string {
  const org = orgOf(actor);
  if (org === 'A') return idOf(CARTS, 'A.cart.regular');
  if (org === 'P') return idOf(CARTS, 'P.cart.owner');
  return idOf(CARTS, purpose === 'reject' ? 'B.cart.pendingForReject' : 'B.cart.pending');
}

function placementBody(actor: OracleMemberKey): Record<string, unknown> {
  const org = orgOf(actor);
  return {
    deliveryAddressId: addressId(org, 'delivery'),
    billingAddressId: addressId(org, 'billing'),
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
  };
}

const ADDRESS_BODY = {
  kind: 'delivery',
  recipientName: 'Oracle 170',
  street: 'ul. Wyroczni 170',
  city: 'Warszawa',
  postalCode: '00-170',
  country: 'PL',
} as const;

const LINE = { productId: SEED_PRODUCT_101_ID, quantity: 1 } as const;

type RequestSpec = Omit<OracleRequest, 'id' | 'family' | 'actor'>;

function family(name: string, spec: (actor: OracleMemberKey) => RequestSpec | readonly RequestSpec[]): OracleRequest[] {
  return ACTORS.flatMap((actor) => {
    const specs = spec(actor);
    return (Array.isArray(specs) ? specs : [specs]).map((s: RequestSpec) => ({
      id: `${name}:${actor}${s.channel ? `@${s.channel}` : ''}`,
      family: name,
      actor,
      ...s,
    }));
  });
}

const isBRegular = (actor: OracleMemberKey): boolean => actor === 'B.regular';

/**
 * Every gated request family of `contracts/migration-and-replay.md` §5, grouped in
 * the phases they are sent in: reads first, so they see the population as seeded;
 * then the placements that consume baskets, the cart writes, the approvals, one-click,
 * quote requests and shopping lists, orders, addresses, the Organization settings,
 * and last the membership writes, whose successes change later members' roles.
 *
 * Deliberately absent: `PATCH /api/v1/organization/policies/cart-approval`, which
 * 170 removes rather than re-gates (OR-3; `contracts/storefront-api.md` §5), so it
 * has no post-upgrade outcome to compare.
 */
export const ORACLE_REQUESTS: readonly OracleRequest[] = [
  // ── Reads ────────────────────────────────────────────────────────────────
  ...family('members.list', () => ({ method: 'GET', path: '/api/v1/organizations/mine/members', observe: 'visible' })),
  ...family('invitations.list', () => ({ method: 'GET', path: '/api/v1/organizations/mine/invitations', observe: 'visible' })),
  ...family('orgCarts.list', () => ({ method: 'GET', path: '/api/v1/organization/carts', observe: 'visible' })),
  ...family('orgCarts.read', (a) => ({ method: 'GET', path: `/api/v1/organization/carts/${orgCartTarget(a, 'read')}` })),
  ...family('cart.read', (a) =>
    isBRegular(a)
      ? [
          { method: 'GET', path: '/api/v1/cart', observe: 'primaryCta' },
          { method: 'GET', path: '/api/v1/cart', observe: 'primaryCta', channel: 'pl_retail' },
          { method: 'GET', path: '/api/v1/cart', observe: 'primaryCta', channel: 'pl_b2b_vip' },
        ]
      : { method: 'GET', path: '/api/v1/cart', observe: 'primaryCta' },
  ),
  ...family('oneClick.eligibility', (a) => ({
    method: 'GET',
    path: '/api/v1/quick-order/one-click/eligibility',
    observe: 'eligibility',
    ...(isBRegular(a) ? { tags: ['oneClickInApprovalOrg'] as const } : {}),
  })),
  ...family('quoteRequests.list', () => ({ method: 'GET', path: '/api/v1/quote-requests', observe: 'visible' })),
  ...family('orders.list', () => ({ method: 'GET', path: '/api/v1/orders', observe: 'visible' })),

  // ── Placement from each basket state ─────────────────────────────────────
  // B's regular user: approved (default channel), pending (pl_retail), not
  // required (pl_b2b_vip). A rejected cart is not a basket — it left `active` —
  // so no placement can address it; its state shows in `orgCarts.list`.
  ...family('order.place', (a) =>
    isBRegular(a)
      ? [
          { method: 'POST', path: '/api/v1/orders', body: placementBody(a) },
          { method: 'POST', path: '/api/v1/orders', body: placementBody(a), channel: 'pl_retail' },
          { method: 'POST', path: '/api/v1/orders', body: placementBody(a), channel: 'pl_b2b_vip' },
        ]
      : { method: 'POST', path: '/api/v1/orders', body: placementBody(a) },
  ),

  // ── Cart writes (the default basket, fresh after the placement) ──────────
  ...family('cart.addItem', () => ({ method: 'POST', path: '/api/v1/cart/items', body: LINE })),
  ...family('cart.submitForApproval', () => ({ method: 'POST', path: '/api/v1/cart/submit-for-approval' })),

  // ── Approvals ────────────────────────────────────────────────────────────
  ...family('orgCarts.approve', (a) => ({
    method: 'POST',
    path: `/api/v1/organization/carts/${orgCartTarget(a, 'approve')}/approve`,
    body: {},
  })),
  ...family('orgCarts.reject', (a) => ({
    method: 'POST',
    path: `/api/v1/organization/carts/${orgCartTarget(a, 'reject')}/reject`,
    body: { reason: 'Oracle 170: over budget' },
  })),

  // ── One-click ────────────────────────────────────────────────────────────
  ...family('oneClick.place', (a) => ({
    method: 'POST',
    path: '/api/v1/quick-order/one-click',
    body: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    ...(isBRegular(a) ? { tags: ['oneClickInApprovalOrg'] as const } : {}),
  })),

  // ── Quote requests and shopping lists ────────────────────────────────────
  ...family('quoteRequest.create', () => ({
    method: 'POST',
    path: '/api/v1/quote-requests',
    body: { headerNote: 'Oracle 170', items: [LINE] },
  })),
  ...family('quoteRequest.fromCart', () => ({ method: 'POST', path: '/api/v1/cart/convert-to-quote-request', body: {} })),
  ...family('quoteRequest.fromShoppingList', (a) => ({
    method: 'POST',
    path: `/api/v1/shopping-lists/${idOf(SHOPPING_LISTS, `${ownerFor(a)}.shoppingList`)}/convert-to-rfq`,
    body: {},
  })),
  ...family('quoteRequest.resubmitOwn', (a) => ({
    method: 'POST',
    path: `/api/v1/quote-requests/${idOf(QUOTE_REQUESTS, `${ownerFor(a)}.quoteRequest`)}/resubmit`,
    body: {},
  })),
  ...family('quoteRequest.resubmitColleagues', (a) => ({
    method: 'POST',
    path: `/api/v1/quote-requests/${idOf(QUOTE_REQUESTS, `${colleagueOf(a)}.quoteRequest`)}/resubmit`,
    body: {},
  })),
  ...family('shoppingList.create', (a) => ({
    method: 'POST',
    path: '/api/v1/shopping-lists',
    body: { name: `Oracle 170 ${a}` },
  })),
  ...family('shoppingList.convertToCart', (a) => ({
    method: 'POST',
    path: `/api/v1/shopping-lists/${idOf(SHOPPING_LISTS, `${ownerFor(a)}.shoppingList`)}/convert-to-cart`,
    body: {},
  })),
  ...family('quickOrder.buildCart', () => ({
    method: 'POST',
    path: '/api/v1/quick-order/build',
    body: { target: 'cart', items: [LINE] },
  })),
  ...family('quickOrder.buildQuote', () => ({
    method: 'POST',
    path: '/api/v1/quick-order/build',
    body: { target: 'quote_request', items: [LINE] },
  })),

  // ── A colleague's orders ─────────────────────────────────────────────────
  ...family('order.reorderColleagues', (a) => ({
    method: 'POST',
    path: `/api/v1/orders/${idOf(ORDERS, `${colleagueOf(a)}.order`)}/reorder`,
  })),
  ...family('order.cloneColleaguesToQuote', (a) => ({
    method: 'POST',
    path: `/api/v1/orders/${idOf(ORDERS, `${colleagueOf(a)}.order`)}/clone-to-quote`,
  })),

  // ── Organization addresses ───────────────────────────────────────────────
  ...family('address.create', () => ({ method: 'POST', path: '/api/v1/organizations/mine/addresses', body: ADDRESS_BODY })),
  ...family('address.update', (a) => ({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/addresses/${idOf(ADDRESSES, `${ownerFor(a)}.address.spare`)}`,
    body: { city: 'Kraków' },
  })),
  ...family('address.delete', (a) => ({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/addresses/${idOf(ADDRESSES, `${ownerFor(a)}.address.spare`)}`,
  })),

  // ── Organization settings ────────────────────────────────────────────────
  ...family('oneClick.setOrganizationDefaults', (a) => ({
    method: 'PUT',
    path: '/api/v1/quick-order/preferences',
    body: {
      scope: 'organization',
      scopeId: oracleOrganization(orgOf(a)).id,
      defaultPaymentMethodId: SEED_PAYMENT_METHOD_ID,
      defaultDeliveryMethodId: SEED_DELIVERY_METHOD_ID,
      defaultBillingAddressId: addressId(orgOf(a), 'billing'),
      defaultShippingAddressId: addressId(orgOf(a), 'delivery'),
    },
  })),
  // `false`, so a success enforces nothing on the requests that follow.
  ...family('mfa.setPolicy', () => ({
    method: 'PUT',
    path: '/api/v1/account/organization/mfa-policy',
    body: { enforceTotp: false },
  })),

  // ── Membership writes (last: a success changes who is what) ──────────────
  ...family('invitation.createMember', (a) => ({
    method: 'POST',
    path: '/api/v1/organizations/mine/invitations',
    body: { email: `oracle170-new-member-${a.replace('.', '-').toLowerCase()}@example.com`, role: 'regular_user' },
  })),
  ...family('invitation.createAdministrator', (a) => ({
    method: 'POST',
    path: '/api/v1/organizations/mine/invitations',
    body: { email: `oracle170-new-admin-${a.replace('.', '-').toLowerCase()}@example.com`, role: 'organization_admin' },
  })),
  // A personal Organization has no invitation of its own; its owner is aimed at A's.
  ...family('invitation.revoke', (a) => ({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/invitations/${idOf(
      INVITATIONS,
      `${orgOf(a) === 'P' ? 'A' : orgOf(a)}.invitation.regular.pending`,
    )}`,
  })),
  // The target is the Organization's blocked member — whose own requests are all
  // refused anyway — and, in a personal Organization, the owner themself.
  ...family('member.remove', (a) => ({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/members/${oracleMember(orgOf(a) === 'P' ? 'P.owner' : (`${orgOf(a)}.blocked` as OracleMemberKey)).id}`,
  })),
  // Promote the Organization's regular user — the very last family, so the
  // promotion changes no other row.
  ...family('member.changeRole', (a) => ({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/members/${oracleMember(orgOf(a) === 'P' ? 'P.owner' : (`${orgOf(a)}.regular` as OracleMemberKey)).id}/role`,
    body: { role: 'organization_admin' },
  })),
];

// ── The WP-13 body mapping ──────────────────────────────────────────────────

/** The predefined role kind a legacy enum value is migrated to (M2/M3: `organization_admin` → administrator, else member). */
export function legacyRoleKind(role: LegacyOrganizationRole): OracleRoleKind {
  return role === 'organization_admin' ? 'administrator' : 'member';
}

/**
 * The single mapping from today's request bodies to the post-170 shape: a body's
 * `role` becomes the `roleId` of the actor's Organization's predefined role of the
 * matching kind; every other key is kept. Today's oracle sends bodies as they are
 * and never calls this; WP-13's replay sends every body through it, with a resolver
 * that reads the migrated `organization_roles` rows.
 */
export function roleToRoleId(
  request: Pick<OracleRequest, 'actor' | 'body'>,
  resolveRoleId: (organizationId: string, kind: OracleRoleKind) => string,
): Readonly<Record<string, unknown>> | undefined {
  const body = request.body;
  if (!body || !('role' in body)) return body;
  const { role, ...rest } = body as { role: LegacyOrganizationRole } & Record<string, unknown>;
  const organizationId = oracleOrganization(orgOf(request.actor)).id;
  return { ...rest, roleId: resolveRoleId(organizationId, legacyRoleKind(role)) };
}

// ── The recorded table ──────────────────────────────────────────────────────

/**
 * What today's code answered to each of {@link ORACLE_REQUESTS}, recorded by
 * `roles-upgrade-oracle.test.ts` on `master` and reviewed row by row. Rows that are
 * today's behaviour but may not survive the plan as written are recorded as they
 * are — they are questions, not edits:
 *
 *  * `cart.read` / `cart.addItem` for the blocked and deleted members answer `200`:
 *    their session resolves to nobody, so they are anonymous visitors with a guest
 *    basket. The plan gates `POST /api/v1/cart/items` with a guard that answers `401`
 *    to a non-customer actor.
 *  * Every `P.owner` row is a `regular_user`'s: today's personal Organization holds
 *    its individual as `regular_user` (refused the member, invitation, MFA,
 *    one-click-defaults and organization-cart routes), while the spec's *Edge Cases*
 *    say a personal Organization's member holds *Administrator*.
 *  * `orgCarts.*` refusals are `403 FORBIDDEN`; behind `carts.approve` they become
 *    `403 ORGANIZATION_PERMISSION_REQUIRED`.
 *  * `cart.submitForApproval:B.admin` is `422 CART_APPROVAL_SELF_SUBMIT`; the plan's
 *    rule refuses a holder of `carts.order_without_approval` with
 *    `CART_APPROVAL_NOT_REQUIRED`.
 *  * `invitations.list` shows expired invitations beside the pending ones
 *    (`listPending` filters on consumed and revoked only).
 */
export const PRE_UPGRADE_OUTCOMES: Readonly<Record<string, OracleOutcome>> = {
  // members.list
  'members.list:A.regular': { status: 403, code: 'FORBIDDEN' },
  'members.list:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'members.list:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'members.list:A.admin': { status: 200, code: 'visible:A.admin,A.blocked,A.regular' },
  'members.list:B.regular': { status: 403, code: 'FORBIDDEN' },
  'members.list:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'members.list:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'members.list:B.admin': { status: 200, code: 'visible:B.admin,B.blocked,B.regular' },
  'members.list:P.owner': { status: 403, code: 'FORBIDDEN' },
  // invitations.list
  'invitations.list:A.regular': { status: 403, code: 'FORBIDDEN' },
  'invitations.list:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitations.list:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitations.list:A.admin': { status: 200, code: 'visible:A.invitation.admin.expired,A.invitation.admin.pending,A.invitation.regular.expired,A.invitation.regular.pending' },
  'invitations.list:B.regular': { status: 403, code: 'FORBIDDEN' },
  'invitations.list:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitations.list:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitations.list:B.admin': { status: 200, code: 'visible:B.invitation.admin.expired,B.invitation.admin.pending,B.invitation.regular.expired,B.invitation.regular.pending' },
  'invitations.list:P.owner': { status: 403, code: 'FORBIDDEN' },
  // orgCarts.list
  'orgCarts.list:A.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.list:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.list:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.list:A.admin': { status: 200, code: 'visible:A.cart.admin,A.cart.regular' },
  'orgCarts.list:B.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.list:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.list:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.list:B.admin': { status: 200, code: 'visible:B.cart.admin,B.cart.approved,B.cart.notRequired,B.cart.pending,B.cart.pendingForReject,B.cart.rejected' },
  'orgCarts.list:P.owner': { status: 403, code: 'FORBIDDEN' },
  // orgCarts.read
  'orgCarts.read:A.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.read:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.read:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.read:A.admin': { status: 200 },
  'orgCarts.read:B.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.read:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.read:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.read:B.admin': { status: 200 },
  'orgCarts.read:P.owner': { status: 403, code: 'FORBIDDEN' },
  // cart.read
  'cart.read:A.regular': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:A.blocked': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:A.deleted': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:A.admin': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:B.regular': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:B.regular@pl_retail': { status: 200, code: 'primaryCta:awaiting_approval' },
  'cart.read:B.regular@pl_b2b_vip': { status: 200, code: 'primaryCta:submit_for_approval' },
  'cart.read:B.blocked': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:B.deleted': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:B.admin': { status: 200, code: 'primaryCta:checkout' },
  'cart.read:P.owner': { status: 200, code: 'primaryCta:checkout' },
  // oneClick.eligibility
  'oneClick.eligibility:A.regular': { status: 200, code: 'eligibility:enabled' },
  'oneClick.eligibility:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.eligibility:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.eligibility:A.admin': { status: 200, code: 'eligibility:enabled' },
  'oneClick.eligibility:B.regular': { status: 200, code: 'eligibility:enabled' },
  'oneClick.eligibility:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.eligibility:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.eligibility:B.admin': { status: 200, code: 'eligibility:enabled' },
  'oneClick.eligibility:P.owner': { status: 200, code: 'eligibility:enabled' },
  // quoteRequests.list
  'quoteRequests.list:A.regular': { status: 200, code: 'visible:A.regular.quoteRequest' },
  'quoteRequests.list:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequests.list:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequests.list:A.admin': { status: 200, code: 'visible:A.admin.quoteRequest,A.regular.quoteRequest' },
  'quoteRequests.list:B.regular': { status: 200, code: 'visible:B.regular.quoteRequest' },
  'quoteRequests.list:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequests.list:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequests.list:B.admin': { status: 200, code: 'visible:B.admin.quoteRequest,B.regular.quoteRequest' },
  'quoteRequests.list:P.owner': { status: 200, code: 'visible:P.owner.quoteRequest' },
  // orders.list
  'orders.list:A.regular': { status: 200, code: 'visible:A.regular.order' },
  'orders.list:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orders.list:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orders.list:A.admin': { status: 200, code: 'visible:A.admin.order,A.regular.order' },
  'orders.list:B.regular': { status: 200, code: 'visible:B.regular.order' },
  'orders.list:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orders.list:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orders.list:B.admin': { status: 200, code: 'visible:B.admin.order,B.regular.order' },
  'orders.list:P.owner': { status: 200, code: 'visible:P.owner.order' },
  // order.place
  'order.place:A.regular': { status: 201 },
  'order.place:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.place:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.place:A.admin': { status: 201 },
  'order.place:B.regular': { status: 201 },
  'order.place:B.regular@pl_retail': { status: 409, code: 'ORDER_CART_APPROVAL_REQUIRED/cart_approval_pending' },
  'order.place:B.regular@pl_b2b_vip': { status: 409, code: 'ORDER_CART_APPROVAL_REQUIRED/cart_approval_not_submitted' },
  'order.place:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.place:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.place:B.admin': { status: 201 },
  'order.place:P.owner': { status: 201 },
  // cart.addItem
  'cart.addItem:A.regular': { status: 200 },
  'cart.addItem:A.blocked': { status: 200 },
  'cart.addItem:A.deleted': { status: 200 },
  'cart.addItem:A.admin': { status: 200 },
  'cart.addItem:B.regular': { status: 200 },
  'cart.addItem:B.blocked': { status: 200 },
  'cart.addItem:B.deleted': { status: 200 },
  'cart.addItem:B.admin': { status: 200 },
  'cart.addItem:P.owner': { status: 200 },
  // cart.submitForApproval
  'cart.submitForApproval:A.regular': { status: 422, code: 'CART_APPROVAL_NOT_REQUIRED' },
  'cart.submitForApproval:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'cart.submitForApproval:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'cart.submitForApproval:A.admin': { status: 422, code: 'CART_APPROVAL_NOT_REQUIRED' },
  'cart.submitForApproval:B.regular': { status: 200 },
  'cart.submitForApproval:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'cart.submitForApproval:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'cart.submitForApproval:B.admin': { status: 422, code: 'CART_APPROVAL_SELF_SUBMIT' },
  'cart.submitForApproval:P.owner': { status: 422, code: 'CART_APPROVAL_NOT_REQUIRED' },
  // orgCarts.approve
  'orgCarts.approve:A.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.approve:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.approve:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.approve:A.admin': { status: 422, code: 'CART_APPROVAL_NOT_PENDING' },
  'orgCarts.approve:B.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.approve:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.approve:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.approve:B.admin': { status: 200 },
  'orgCarts.approve:P.owner': { status: 403, code: 'FORBIDDEN' },
  // orgCarts.reject
  'orgCarts.reject:A.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.reject:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.reject:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.reject:A.admin': { status: 422, code: 'CART_APPROVAL_NOT_PENDING' },
  'orgCarts.reject:B.regular': { status: 403, code: 'FORBIDDEN' },
  'orgCarts.reject:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.reject:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'orgCarts.reject:B.admin': { status: 200 },
  'orgCarts.reject:P.owner': { status: 403, code: 'FORBIDDEN' },
  // oneClick.place
  'oneClick.place:A.regular': { status: 201 },
  'oneClick.place:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.place:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.place:A.admin': { status: 201 },
  'oneClick.place:B.regular': { status: 201 },
  'oneClick.place:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.place:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.place:B.admin': { status: 201 },
  'oneClick.place:P.owner': { status: 201 },
  // quoteRequest.create
  'quoteRequest.create:A.regular': { status: 201 },
  'quoteRequest.create:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.create:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.create:A.admin': { status: 201 },
  'quoteRequest.create:B.regular': { status: 201 },
  'quoteRequest.create:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.create:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.create:B.admin': { status: 201 },
  'quoteRequest.create:P.owner': { status: 201 },
  // quoteRequest.fromCart
  'quoteRequest.fromCart:A.regular': { status: 200 },
  'quoteRequest.fromCart:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromCart:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromCart:A.admin': { status: 200 },
  'quoteRequest.fromCart:B.regular': { status: 200 },
  'quoteRequest.fromCart:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromCart:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromCart:B.admin': { status: 200 },
  'quoteRequest.fromCart:P.owner': { status: 200 },
  // quoteRequest.fromShoppingList
  'quoteRequest.fromShoppingList:A.regular': { status: 200 },
  'quoteRequest.fromShoppingList:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromShoppingList:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromShoppingList:A.admin': { status: 200 },
  'quoteRequest.fromShoppingList:B.regular': { status: 200 },
  'quoteRequest.fromShoppingList:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromShoppingList:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.fromShoppingList:B.admin': { status: 200 },
  'quoteRequest.fromShoppingList:P.owner': { status: 200 },
  // quoteRequest.resubmitOwn
  'quoteRequest.resubmitOwn:A.regular': { status: 201 },
  'quoteRequest.resubmitOwn:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitOwn:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitOwn:A.admin': { status: 201 },
  'quoteRequest.resubmitOwn:B.regular': { status: 201 },
  'quoteRequest.resubmitOwn:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitOwn:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitOwn:B.admin': { status: 201 },
  'quoteRequest.resubmitOwn:P.owner': { status: 201 },
  // quoteRequest.resubmitColleagues
  'quoteRequest.resubmitColleagues:A.regular': { status: 404, code: 'NOT_FOUND' },
  'quoteRequest.resubmitColleagues:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitColleagues:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitColleagues:A.admin': { status: 201 },
  'quoteRequest.resubmitColleagues:B.regular': { status: 404, code: 'NOT_FOUND' },
  'quoteRequest.resubmitColleagues:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitColleagues:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quoteRequest.resubmitColleagues:B.admin': { status: 201 },
  'quoteRequest.resubmitColleagues:P.owner': { status: 201 },
  // shoppingList.create
  'shoppingList.create:A.regular': { status: 201 },
  'shoppingList.create:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.create:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.create:A.admin': { status: 201 },
  'shoppingList.create:B.regular': { status: 201 },
  'shoppingList.create:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.create:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.create:B.admin': { status: 201 },
  'shoppingList.create:P.owner': { status: 201 },
  // shoppingList.convertToCart
  'shoppingList.convertToCart:A.regular': { status: 200 },
  'shoppingList.convertToCart:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.convertToCart:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.convertToCart:A.admin': { status: 200 },
  'shoppingList.convertToCart:B.regular': { status: 200 },
  'shoppingList.convertToCart:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.convertToCart:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'shoppingList.convertToCart:B.admin': { status: 200 },
  'shoppingList.convertToCart:P.owner': { status: 200 },
  // quickOrder.buildCart
  'quickOrder.buildCart:A.regular': { status: 200 },
  'quickOrder.buildCart:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildCart:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildCart:A.admin': { status: 200 },
  'quickOrder.buildCart:B.regular': { status: 200 },
  'quickOrder.buildCart:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildCart:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildCart:B.admin': { status: 200 },
  'quickOrder.buildCart:P.owner': { status: 200 },
  // quickOrder.buildQuote
  'quickOrder.buildQuote:A.regular': { status: 200 },
  'quickOrder.buildQuote:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildQuote:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildQuote:A.admin': { status: 200 },
  'quickOrder.buildQuote:B.regular': { status: 200 },
  'quickOrder.buildQuote:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildQuote:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'quickOrder.buildQuote:B.admin': { status: 200 },
  'quickOrder.buildQuote:P.owner': { status: 200 },
  // order.reorderColleagues
  'order.reorderColleagues:A.regular': { status: 404, code: 'ORDER_NOT_FOUND' },
  'order.reorderColleagues:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.reorderColleagues:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.reorderColleagues:A.admin': { status: 200 },
  'order.reorderColleagues:B.regular': { status: 404, code: 'ORDER_NOT_FOUND' },
  'order.reorderColleagues:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.reorderColleagues:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.reorderColleagues:B.admin': { status: 200 },
  'order.reorderColleagues:P.owner': { status: 200 },
  // order.cloneColleaguesToQuote
  'order.cloneColleaguesToQuote:A.regular': { status: 404, code: 'ORDER_NOT_FOUND' },
  'order.cloneColleaguesToQuote:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.cloneColleaguesToQuote:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.cloneColleaguesToQuote:A.admin': { status: 200 },
  'order.cloneColleaguesToQuote:B.regular': { status: 404, code: 'ORDER_NOT_FOUND' },
  'order.cloneColleaguesToQuote:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'order.cloneColleaguesToQuote:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'order.cloneColleaguesToQuote:B.admin': { status: 200 },
  'order.cloneColleaguesToQuote:P.owner': { status: 200 },
  // address.create
  'address.create:A.regular': { status: 201 },
  'address.create:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.create:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.create:A.admin': { status: 201 },
  'address.create:B.regular': { status: 201 },
  'address.create:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.create:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.create:B.admin': { status: 201 },
  'address.create:P.owner': { status: 201 },
  // address.update
  'address.update:A.regular': { status: 200 },
  'address.update:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.update:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.update:A.admin': { status: 200 },
  'address.update:B.regular': { status: 200 },
  'address.update:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.update:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.update:B.admin': { status: 200 },
  'address.update:P.owner': { status: 200 },
  // address.delete
  'address.delete:A.regular': { status: 204 },
  'address.delete:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.delete:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.delete:A.admin': { status: 204 },
  'address.delete:B.regular': { status: 204 },
  'address.delete:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'address.delete:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'address.delete:B.admin': { status: 204 },
  'address.delete:P.owner': { status: 204 },
  // oneClick.setOrganizationDefaults
  'oneClick.setOrganizationDefaults:A.regular': { status: 403, code: 'FORBIDDEN' },
  'oneClick.setOrganizationDefaults:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.setOrganizationDefaults:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.setOrganizationDefaults:A.admin': { status: 200 },
  'oneClick.setOrganizationDefaults:B.regular': { status: 403, code: 'FORBIDDEN' },
  'oneClick.setOrganizationDefaults:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.setOrganizationDefaults:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'oneClick.setOrganizationDefaults:B.admin': { status: 200 },
  'oneClick.setOrganizationDefaults:P.owner': { status: 403, code: 'FORBIDDEN' },
  // mfa.setPolicy
  'mfa.setPolicy:A.regular': { status: 403, code: 'FORBIDDEN' },
  'mfa.setPolicy:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'mfa.setPolicy:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'mfa.setPolicy:A.admin': { status: 200 },
  'mfa.setPolicy:B.regular': { status: 403, code: 'FORBIDDEN' },
  'mfa.setPolicy:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'mfa.setPolicy:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'mfa.setPolicy:B.admin': { status: 200 },
  'mfa.setPolicy:P.owner': { status: 403, code: 'FORBIDDEN' },
  // invitation.createMember
  'invitation.createMember:A.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.createMember:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createMember:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createMember:A.admin': { status: 201 },
  'invitation.createMember:B.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.createMember:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createMember:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createMember:B.admin': { status: 201 },
  'invitation.createMember:P.owner': { status: 403, code: 'FORBIDDEN' },
  // invitation.createAdministrator
  'invitation.createAdministrator:A.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.createAdministrator:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createAdministrator:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createAdministrator:A.admin': { status: 201 },
  'invitation.createAdministrator:B.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.createAdministrator:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createAdministrator:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.createAdministrator:B.admin': { status: 201 },
  'invitation.createAdministrator:P.owner': { status: 403, code: 'FORBIDDEN' },
  // invitation.revoke
  'invitation.revoke:A.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.revoke:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.revoke:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.revoke:A.admin': { status: 204 },
  'invitation.revoke:B.regular': { status: 403, code: 'FORBIDDEN' },
  'invitation.revoke:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.revoke:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'invitation.revoke:B.admin': { status: 204 },
  'invitation.revoke:P.owner': { status: 403, code: 'FORBIDDEN' },
  // member.remove
  'member.remove:A.regular': { status: 403, code: 'FORBIDDEN' },
  'member.remove:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'member.remove:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'member.remove:A.admin': { status: 204 },
  'member.remove:B.regular': { status: 403, code: 'FORBIDDEN' },
  'member.remove:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'member.remove:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'member.remove:B.admin': { status: 204 },
  'member.remove:P.owner': { status: 403, code: 'FORBIDDEN' },
  // member.changeRole
  'member.changeRole:A.regular': { status: 403, code: 'FORBIDDEN' },
  'member.changeRole:A.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'member.changeRole:A.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'member.changeRole:A.admin': { status: 200 },
  'member.changeRole:B.regular': { status: 403, code: 'FORBIDDEN' },
  'member.changeRole:B.blocked': { status: 401, code: 'UNAUTHORIZED' },
  'member.changeRole:B.deleted': { status: 401, code: 'UNAUTHORIZED' },
  'member.changeRole:B.admin': { status: 200 },
  'member.changeRole:P.owner': { status: 403, code: 'FORBIDDEN' },
};
