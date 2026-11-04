import type { OracleOutcome } from './pre-upgrade-outcomes.js';

/**
 * The expected differences of the roles upgrade — `specs/170-organization-roles/`
 * T125 (WP-13a; research R-38; `contracts/migration-and-replay.md` §6.1; owner
 * rulings PR-3, PR-5, PR-6, PR-7; FR-072).
 *
 * §6.1's table, verbatim, keyed by oracle request id: the 26 rows whose outcome
 * the design changes, each with the outcome the frozen oracle recorded
 * (`before`, equal to `PRE_UPGRADE_OUTCOMES[id]`) and the outcome the upgraded
 * platform must answer (`after`), both in the oracle's `{ status, code }` shape.
 * The other 293 rows of `ORACLE_REQUESTS` are expected unchanged.
 *
 * **It moves only with an owner ruling**, like the oracle it is a statement
 * about: a replay row outside it that differs is a defect in the owning module,
 * and a row in it that does not reach its `after` is a question for the owner,
 * never an edit here. `landedBy` is the one exception — it is an allocation
 * (which work package's merge moves the row), not behaviour, and the architect
 * corrects it in the merge request that finds it wrong (R-38).
 *
 * `roles-expected-differences.test.ts` (no services) holds the table against
 * the oracle fixture and against §6.1's *Lands in* column.
 */

/** §6.1 *Families*. */
export type ExpectedDifferenceFamily = 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

export interface ExpectedDifference {
  /**
   * F1 — a personal Organization's member is *Administrator*; F2 —
   * organization-cart refusals carry the permission code; F3 — the self-submit
   * code; F4 — one-click in an approval-requiring Organization (#653); F5 —
   * expired invitations unlisted.
   */
  family: ExpectedDifferenceFamily;
  /** The owner ruling the row rests on (`plan.md` *Oracle rulings*). */
  ruling: 'PR-3' | 'PR-5' | 'PR-6' | 'PR-7';
  /** The work package whose merge moves the row (§6.1 *Lands in*, §6.2). */
  landedBy: 'WP-03' | 'WP-04' | 'WP-06';
  before: OracleOutcome;
  after: OracleOutcome;
}

const FORBIDDEN: OracleOutcome = { status: 403, code: 'FORBIDDEN' };
const PERMISSION_REQUIRED: OracleOutcome = { status: 403, code: 'ORGANIZATION_PERMISSION_REQUIRED' };

export const EXPECTED_DIFFERENCES: Readonly<Record<string, ExpectedDifference>> = {
  // ── F1 · PR-3 — the personal Organization's member holds Administrator ───
  // 1 — an administrator lists members; P has one
  'members.list:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 200, code: 'visible:P.owner' },
  },
  // 2 — an administrator lists invitations; P has none
  'invitations.list:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 200, code: 'visible:' },
  },
  // 3 — Administrator holds `carts.approve`
  'orgCarts.list:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-04',
    before: FORBIDDEN,
    after: { status: 200, code: 'visible:P.cart.owner' },
  },
  // 4 — as row 3
  'orgCarts.read:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-04',
    before: FORBIDDEN,
    after: { status: 200 },
  },
  // 5 — the target is P's own cart, already placed; the state is checked before self-approval (R-36)
  'orgCarts.approve:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-04',
    before: FORBIDDEN,
    after: { status: 422, code: 'CART_APPROVAL_NOT_PENDING' },
  },
  // 6 — as row 5
  'orgCarts.reject:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-04',
    before: FORBIDDEN,
    after: { status: 422, code: 'CART_APPROVAL_NOT_PENDING' },
  },
  // 7 — FR-012 is reserved to Administrator; same values as seeded, so no later row moves
  'oneClick.setOrganizationDefaults:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-06',
    before: FORBIDDEN,
    after: { status: 200 },
  },
  // 8 — FR-011, reserved to Administrator; `enforceTotp: false` changes nothing later
  'mfa.setPolicy:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 200 },
  },
  // 9 — the personal-Organization refusal (feature 051), checked before the role is resolved
  'invitation.createMember:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 422, code: 'VALIDATION_FAILED' },
  },
  // 10 — as row 9
  'invitation.createAdministrator:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 422, code: 'VALIDATION_FAILED' },
  },
  // 11 — the target is A's invitation; the lookup is scoped to P
  'invitation.revoke:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 404, code: 'NOT_FOUND' },
  },
  // 12 — the target is P.owner, P's only administrator
  'member.remove:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 409, code: 'CANNOT_REMOVE_LAST_ADMIN' },
  },
  // 13 — Administrator → Administrator: no change, nothing audited (FR-065)
  'member.changeRole:P.owner': {
    family: 'F1',
    ruling: 'PR-3',
    landedBy: 'WP-03',
    before: FORBIDDEN,
    after: { status: 200 },
  },

  // ── F2 · PR-5 — organization-cart refusals carry the permission code ─────
  // 14–21 — the route is `P(carts.approve)`, no longer administrator-only
  'orgCarts.list:A.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.list:B.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.read:A.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.read:B.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.approve:A.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.approve:B.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.reject:A.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },
  'orgCarts.reject:B.regular': { family: 'F2', ruling: 'PR-5', landedBy: 'WP-04', before: FORBIDDEN, after: PERMISSION_REQUIRED },

  // ── F3 · PR-5 — the self-submit code ─────────────────────────────────────
  // 22 — a holder of `carts.order_without_approval` is refused as not required (`storefront-api.md` §5)
  'cart.submitForApproval:B.admin': {
    family: 'F3',
    ruling: 'PR-5',
    landedBy: 'WP-04',
    before: { status: 422, code: 'CART_APPROVAL_SELF_SUBMIT' },
    after: { status: 422, code: 'CART_APPROVAL_NOT_REQUIRED' },
  },

  // ── F4 · PR-6 — one-click in an approval-requiring Organization (#653) ───
  // 23 — B's Member lacks both codes (FR-071); `quick_order.one_click` is judged first (FR-050, R-6)
  'oneClick.eligibility:B.regular': {
    family: 'F4',
    ruling: 'PR-6',
    landedBy: 'WP-06',
    before: { status: 200, code: 'eligibility:enabled' },
    after: { status: 200, code: 'eligibility:permission_required' },
  },
  // 24 — #653 closed; refused before any basket write, naming `quick_order.one_click`
  'oneClick.place:B.regular': {
    family: 'F4',
    ruling: 'PR-6',
    landedBy: 'WP-06',
    before: { status: 201 },
    after: PERMISSION_REQUIRED,
  },

  // ── F5 · PR-7 — expired invitations are not listed (FR-010a) ─────────────
  // 25
  'invitations.list:A.admin': {
    family: 'F5',
    ruling: 'PR-7',
    landedBy: 'WP-03',
    before: {
      status: 200,
      code: 'visible:A.invitation.admin.expired,A.invitation.admin.pending,A.invitation.regular.expired,A.invitation.regular.pending',
    },
    after: { status: 200, code: 'visible:A.invitation.admin.pending,A.invitation.regular.pending' },
  },
  // 26 — as row 25
  'invitations.list:B.admin': {
    family: 'F5',
    ruling: 'PR-7',
    landedBy: 'WP-03',
    before: {
      status: 200,
      code: 'visible:B.invitation.admin.expired,B.invitation.admin.pending,B.invitation.regular.expired,B.invitation.regular.pending',
    },
    after: { status: 200, code: 'visible:B.invitation.admin.pending,B.invitation.regular.pending' },
  },
};
