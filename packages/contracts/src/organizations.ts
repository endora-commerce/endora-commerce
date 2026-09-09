import { z } from 'zod';
import {
  addressSnapshotSchema,
  isoDateTimeSchema,
  organizationRoleSchema,
  uuidSchema,
} from './common.js';
import { fulfilmentStrategySchema, type FulfilmentStrategy } from './inventory.js';
import { foldDiacritics } from './text-normalization.js';

/**
 * Organizations, customer accounts, addresses, invitations — Source of truth
 * per Principle V. Drives US2 + US3.
 * See specs/001-b2b-platform-foundation/contracts/organizations.contract.md.
 */

// --- Primitives --------------------------------------------------------------

/**
 * Organization lifecycle status (feature 026 consolidation).
 *
 *  - `pending_verification` — newly registered, blocks transactions until
 *    moderator approves (manual moderation mode) or auto-activated.
 *  - `active` — may transact normally.
 *  - `blocked` — operator-blocked (replaces the legacy `suspended`); the
 *    Organization cannot place Orders or Quote Requests; reversible.
 *  - `rejected` — moderator rejected at registration; terminal.
 */
export const organizationStatusSchema = z.enum([
  'pending_verification',
  'active',
  'blocked',
  'rejected',
]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const vatStatusSchema = z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']);
export type VatStatus = z.infer<typeof vatStatusSchema>;

/**
 * Feature 056 — per-organization credit-inheritance mode. Platform-admin only.
 *
 *  - `shared_pool` — a descendant with no own credit limit draws against the
 *    nearest ancestor's pool; concurrent draws across the subtree are serialized
 *    on the owning ancestor's row (zero double-spend).
 *  - `independent_default` — the inherited amount is each descendant's own
 *    effective limit; draws are independent of siblings.
 *
 * `null` on an Organization ⇒ fall back to the Settings global default
 * (`organizations.hierarchy.credit_inheritance_mode`, factory `shared_pool`).
 */
export const creditInheritanceModeSchema = z.enum(['shared_pool', 'independent_default']);
export type CreditInheritanceMode = z.infer<typeof creditInheritanceModeSchema>;

export const addressKindSchema = z.enum(['delivery', 'billing']);
export type AddressKind = z.infer<typeof addressKindSchema>;

// --- Resources --------------------------------------------------------------

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  taxId: z.string(),
  status: organizationStatusSchema,
  vatStatus: vatStatusSchema,
  /** Feature 051 — true for a single-member personal (B2C) organization. */
  isPersonal: z.boolean().optional(),
  registeredAddress: addressSnapshotSchema.omit({ recipientName: true, phone: true }).extend({
    recipientName: z.string().optional(),
    phone: z.string().optional(),
  }),
  /**
   * Organization-level override of the warehouse-picking (fulfilment) strategy
   * used to reserve stock at order placement. `null` ⇒ inherit (sales-channel
   * setting → platform default). When the strategy is `defined_order`,
   * `fulfilmentStrategyWarehouseOrder` carries the ordered warehouse-id walk.
   */
  fulfilmentStrategy: fulfilmentStrategySchema.nullable().optional(),
  fulfilmentStrategyWarehouseOrder: z.array(uuidSchema).nullable().optional(),
  /**
   * Feature 056 — hierarchy. `parentId` is the self-referential parent FK
   * (`null` ⇒ root). `path` is the server-maintained materialized ancestor path
   * (read-only). `creditInheritanceMode` is the per-org platform-admin override
   * (`null` ⇒ global default). All three are additive; every pre-feature org is
   * a root (`parentId = null`, `path = '/<id>/'`).
   */
  parentId: uuidSchema.nullable().optional(),
  path: z.string().optional(),
  creditInheritanceMode: creditInheritanceModeSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

// --- Hierarchy (feature 056) ------------------------------------------------

/**
 * A single node in an organization subtree / ancestor chain. `depth` is the
 * node's absolute depth in the tree (root = 0). Returned pre-order (subtree) or
 * nearest-first (ancestors).
 */
export const organizationTreeNodeSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  parentId: uuidSchema.nullable(),
  depth: z.number().int().nonnegative(),
  status: organizationStatusSchema,
});
export type OrganizationTreeNode = z.infer<typeof organizationTreeNodeSchema>;

/** `GET /admin/organizations/:id/subtree` — descendants (incl. self), pre-order. */
export const organizationSubtreeResponseSchema = z.object({
  items: z.array(organizationTreeNodeSchema),
});
export type OrganizationSubtreeResponse = z.infer<typeof organizationSubtreeResponseSchema>;

/** `GET /admin/organizations/:id/ancestors` — ancestor chain, nearest-first. */
export const organizationAncestorsResponseSchema = z.object({
  items: z.array(organizationTreeNodeSchema),
});
export type OrganizationAncestorsResponse = z.infer<typeof organizationAncestorsResponseSchema>;

/**
 * `POST /admin/organizations/:id/parent` — assign / move / detach parent.
 * `parentId = null` makes `:id` a root. Path maintenance + cycle/depth checks
 * are guaranteed server-side (this is the only writable path for `parentId`).
 */
export const assignOrganizationParentRequestSchema = z.object({
  parentId: uuidSchema.nullable(),
});
export type AssignOrganizationParentRequest = z.infer<
  typeof assignOrganizationParentRequestSchema
>;

/**
 * `PUT /admin/organizations/:id/credit-inheritance-mode` — platform-admin only.
 * `mode = null` ⇒ fall back to the Settings global default.
 */
export const setCreditInheritanceModeRequestSchema = z.object({
  mode: creditInheritanceModeSchema.nullable(),
});
export type SetCreditInheritanceModeRequest = z.infer<
  typeof setCreditInheritanceModeRequestSchema
>;

export const customerAccountSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: organizationRoleSchema,
  emailVerifiedAt: isoDateTimeSchema.nullable(),
  twoFactorEnabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomerAccount = z.infer<typeof customerAccountSchema>;

export const addressSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  kind: addressKindSchema,
  recipientName: z.string(),
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string().length(2),
  phone: z.string().nullable().optional(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof addressSchema>;

// --- Requests --------------------------------------------------------------

/** Polish NIP or a generic tax-id string; exact validation lives in the backend. */
const taxIdSchema = z.string().min(8).max(32);

export const registerOrganizationRequestSchema = z.object({
  organization: z.object({
    name: z.string().min(1).max(255),
    taxId: taxIdSchema,
    registeredAddress: z.object({
      street: z.string().min(1).max(255),
      city: z.string().min(1).max(120),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2),
    }),
    vatStatus: vatStatusSchema.optional(),
  }),
  firstUser: z.object({
    email: z.string().email(),
    password: z.string().min(12).max(256),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
  }),
  acceptedTermsVersion: z.string(),
});
export type RegisterOrganizationRequest = z.infer<typeof registerOrganizationRequestSchema>;

export const emailVerificationRequestSchema = z.object({
  token: z.string().min(10),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(12).max(256),
});

export const customerLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

/**
 * Outcome of the anonymous-cart → customer-cart merge that runs inside the
 * customer-login flow (feature 037-cart-merge-on-login).
 *
 * Internal shape — split between two `noop_*` variants so the audit /
 * observability paths can distinguish "anon cart was empty" from "no anon
 * cart was supplied". The HTTP-facing shape collapses both into a single
 * `'noop'`; see `cartMergeOutcomePublicSchema` below.
 */
export const cartMergeOutcomeSchema = z.object({
  outcome: z.enum(['adopted', 'merged', 'noop_empty', 'noop_no_anon']),
  movedLineCount: z.number().int().min(0),
  summedLineCount: z.number().int().min(0),
  destinationCartId: uuidSchema,
});
export type CartMergeOutcome = z.infer<typeof cartMergeOutcomeSchema>;

/**
 * Public (HTTP) narrowing of `cartMergeOutcomeSchema`. The storefront only
 * needs three buckets to decide whether to surface the merge-confirmation
 * toast (`adopted | merged → toast`, `noop → silent`) and the destination
 * cart id for the next cart read.
 */
export const cartMergeOutcomePublicSchema = z.object({
  outcome: z.enum(['adopted', 'merged', 'noop']),
  destinationCartId: uuidSchema,
});
export type CartMergeOutcomePublic = z.infer<typeof cartMergeOutcomePublicSchema>;

/**
 * Customer login response. The `cartMerge` field is populated when the
 * login carries an anonymous-cart cookie; `null` when no anon cookie was
 * supplied; `outcome: 'noop'` when the cookie was supplied but had no
 * observable effect (no anon cart, or the anon cart was empty).
 */
export const customerLoginResponseSchema = z.object({
  data: z.object({
    customerAccount: z.object({
      id: uuidSchema,
      email: z.string().email(),
      organizationId: uuidSchema.nullable(),
      role: organizationRoleSchema,
      twoFactorEnabled: z.boolean(),
    }),
    cartMerge: cartMergeOutcomePublicSchema.nullable().optional(),
  }),
});
export type CustomerLoginResponse = z.infer<typeof customerLoginResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(12).max(256),
});

export const createAddressRequestSchema = z.object({
  kind: addressKindSchema,
  recipientName: z.string().min(1).max(160),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;

export const updateAddressRequestSchema = createAddressRequestSchema.partial();
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;

export const inviteMemberRequestSchema = z.object({
  email: z.string().email(),
  role: organizationRoleSchema.optional(),
});

export const acceptInvitationRequestSchema = z.object({
  password: z.string().min(12),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
});

export const changeMemberRoleRequestSchema = z.object({
  role: organizationRoleSchema,
});

/** Platform admin — PATCH `/admin/organizations/:id` */
export const adminPatchOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  vatStatus: vatStatusSchema.optional(),
  status: organizationStatusSchema.optional(),
  /** Feature 038 (US4) — additional emails CC'd on this org's order confirmations. */
  orderConfirmationEmails: z.array(z.string()).optional(),
  /**
   * Organization-level fulfilment-strategy override. `null` clears the
   * override (inherit channel setting → platform default). `defined_order`
   * pairs with `fulfilmentStrategyWarehouseOrder` (ordered warehouse ids).
   */
  fulfilmentStrategy: fulfilmentStrategySchema.nullable().optional(),
  fulfilmentStrategyWarehouseOrder: z.array(uuidSchema).nullable().optional(),
  /** Feature 055 — custom-field values for this organization (validated on write). */
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
  expectedUpdatedAt: z.string().optional(),
});

/** Platform admin — POST `/admin/organizations/:id/recover-admin-access` */
export const adminRecoverOrgAccessRequestSchema = z.object({
  promoteCustomerAccountId: uuidSchema,
});

/** Platform admin — POST `/admin/organizations/:id/members` (direct create) */
export const adminDirectMemberRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  password: z.string().min(12).max(256),
  role: organizationRoleSchema.optional(),
});

/** Platform admin — PATCH member role */
export const adminPatchMemberRoleRequestSchema = z.object({
  role: organizationRoleSchema,
  expectedUpdatedAt: z.string().optional(),
});

/**
 * Feature 056 (T032) — Platform admin — PATCH member roll-up capability.
 * When enabled, this customer login sees/acts across its organization's subtree.
 */
export const adminSetMemberRollupRequestSchema = z.object({
  subtreeRollupEnabled: z.boolean(),
  expectedUpdatedAt: z.string().optional(),
});
export type AdminSetMemberRollupRequest = z.infer<typeof adminSetMemberRollupRequestSchema>;

/** Platform admin — PATCH `/admin/organizations/:id/members/:customerAccountId` (profile) */
export const adminPatchMemberProfileRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .refine((b) => b.firstName !== undefined || b.lastName !== undefined || b.email !== undefined, {
    message: 'At least one of firstName, lastName, email is required',
  });

// --- Responses (convenience) ------------------------------------------------

export const registerOrganizationResponseSchema = z.object({
  organization: organizationSchema,
  customerAccount: customerAccountSchema,
  emailVerificationSent: z.boolean(),
});
export type RegisterOrganizationResponse = z.infer<typeof registerOrganizationResponseSchema>;

// --- Organization picker (feature 091, P2) ----------------------------------

/**
 * One row of the admin Organization picker.
 *
 * A **projection**, not the `GET /api/v1/admin/organizations` envelope: the
 * picker renders a label, a status pill and nothing else, and it commits the
 * `id`. `version` rides along because a caller that picks an Organization in
 * order to write to it needs the optimistic-concurrency token it already had.
 *
 * Published because `@endora-commerce/admin-kit` builds this request itself
 * (feature 091's P2 — the picker moved into the kit and rebuilt its call from
 * the published `apiClient`), so the shape crosses a package boundary and
 * Principle II puts it here. Before P2 it was declared in
 * `admin/src/modules/organizations/api/organizations-picker-client.ts`, where a
 * kit component could only reach it by importing a module's admin code.
 *
 * The status is `organizationStatusSchema` and not a picker-local enum: the four
 * members the picker filters on are exactly that schema's, so a second name
 * would be two spellings of one set with nothing keeping them equal.
 */
export const organizationPickerListItemSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  legalName: z.string().nullable(),
  status: organizationStatusSchema,
  countryCode: z.string().nullable().optional(),
  salesRepAdminUserIds: z.array(uuidSchema).optional(),
  memberCount: z.number().int().nonnegative().optional(),
  version: z.number().int().nonnegative(),
});
export type OrganizationPickerListItem = z.infer<typeof organizationPickerListItemSchema>;

/** One page of picker rows. `nextCursor` is `null` on the last page. */
export const organizationPickerPageSchema = z.object({
  items: z.array(organizationPickerListItemSchema),
  nextCursor: z.string().nullable(),
});
export type OrganizationPickerPage = z.infer<typeof organizationPickerPageSchema>;

// --- Sales-rep ↔ organization assignment (feature 008) ---------------------

export const salesRepAssignmentSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  adminUserId: uuidSchema,
  displayName: z.string(),
  email: z.string().email(),
  assignedAt: isoDateTimeSchema,
  assignedByAdminUserId: uuidSchema.nullable(),
});
export type SalesRepAssignment = z.infer<typeof salesRepAssignmentSchema>;

export const assignSalesRepRequestSchema = z.object({
  adminUserId: uuidSchema,
});
export type AssignSalesRepRequest = z.infer<typeof assignSalesRepRequestSchema>;

export const salesRepOrganizationSchema = z.object({
  organizationId: uuidSchema,
  name: z.string(),
  openRfqCount: z.number().int().nonnegative(),
  assignedAt: isoDateTimeSchema,
});
export type SalesRepOrganization = z.infer<typeof salesRepOrganizationSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `organizations` publishes to the eleven modules that
// read it (feature 075, Phase P). Plain TypeScript, not Zod: these describe
// in-process calls, not an API boundary.
// ---------------------------------------------------------------------------

export type VatValidationProvider = 'vies' | 'mf_pl' | 'format_only';

export type VatValidationOutcome = 'validated' | 'failed' | 'deferred' | 'unverified';

/** The JSONB snapshot the organisation's registered address is stored as. */
export interface OrganizationRegisteredAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

/**
 * An organisation as it crosses a module boundary — a plain shape, never the
 * ORM entity (FR-011). `nameSearch` is absent: it is a derived column the
 * entity hooks maintain, "never read or written by callers directly", and
 * publishing it would invite exactly that.
 */
export interface OrganizationRecord {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string;
  status: OrganizationStatus;
  vatStatus: VatStatus;
  isPersonal: boolean;
  customerGroupId: string | null;
  registeredAddress: OrganizationRegisteredAddress;
  orderConfirmationEmails: string[];
  vatValidatedAt: Date | null;
  vatValidationProvider: VatValidationProvider | null;
  vatValidationOutcome: VatValidationOutcome | null;
  blockedReason: string | null;
  blockedAt: Date | null;
  rejectedReason: string | null;
  rejectedAt: Date | null;
  approvedAt: Date | null;
  approvedByAdminUserId: string | null;
  requiresCartApproval: boolean;
  fulfilmentStrategy: FulfilmentStrategy | null;
  fulfilmentStrategyWarehouseOrder: string[] | null;
  parentId: string | null;
  /** Materialised ancestor chain `'/<rootId>/…/<thisId>/'`. */
  path: string;
  creditInheritanceMode: CreditInheritanceMode | null;
  customFieldValues: Record<string, unknown>;
  /** Optimistic-lock token. Pass it back on a versioned write. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Container name: `organizationDetailsPort`. Owner: `organizations`.
 *
 * The union of what eleven modules measurably ask for when they read the
 * organisation row itself: 24 of the 47 inbound sites are `em.findOne` /
 * `em.find` on the entity, and between them they touch nearly every column.
 *
 * **Why this is a second port and not a wider `OrganizationSnapshot`.** The
 * kernel's `OrganizationReadPort` (`src/kernel/ports/organizations.ts`) is the
 * *tenancy projection* — `{ id, status }` plus the two questions Principle XI
 * asks — and D-55 settled it at what its callers use. `organizationTaxProfilePort`
 * already declined to widen it, in those words, for the same reason: a tax
 * profile is one consumer's question. So is a name picker, and so is a
 * fulfilment override. Widening the snapshot to carry them would make the
 * kernel declare a domain record.
 *
 * The name search is here rather than in each caller because it is not a
 * `LIKE` on `name`: the column that answers it is the diacritic-folded
 * `nameSearch`, and two of the three existing callers query `name` instead —
 * so "a search for lodz finds Łódź" holds in one of them and not in the others.
 *
 * When `organizations` is off every method fails closed. The module is the
 * platform's one tenant concept, so in practice the gate cannot close; it is
 * registered anyway, because an exception carved into the port machinery costs
 * more than the predicate does.
 */
export interface OrganizationDetailsPort {
  findById(id: string): Promise<OrganizationRecord | null>;
  findByIds(ids: readonly string[]): Promise<OrganizationRecord[]>;
  /** How many of these ids exist — the `count === ids.length` existence check. */
  countByIds(ids: readonly string[]): Promise<number>;
  /**
   * Diacritic-insensitive name search over `nameSearch`, ordered by name.
   * An empty `query` returns the first `limit` organisations.
   */
  searchByName(query: string, limit: number): Promise<OrganizationRecord[]>;
  /** The same search, ids only — for the order list's organisation filter. */
  searchIdsByName(query: string): Promise<string[]>;
}

/**
 * Diacritic-insensitive normalisation for the organisation's `name_search`
 * column and for any query string matched against it.
 *
 * The character fold itself is `foldDiacritics` in `text-normalization.ts`,
 * shared with `admin/` and reachable from `storefront/` (issue #240): it strips
 * every Unicode combining mark through NFD decomposition and then maps the
 * handful of precomposed Latin letters NFD does not decompose (notably Polish
 * `ł`/`Ł`, Scandinavian `ø`/`Ø`, Croatian `đ`/`Đ`, Icelandic `ð`/`Ð`,
 * `þ`/`Þ`, German `ß`, ligatures `æ` and `œ`). What is specific to an
 * organisation name is the whitespace policy below, and only that: a name typed
 * with a double space must match one stored with a single one.
 *
 * Published as a **function, not a port** (FR-013): it is pure over its
 * argument, so switching `organizations` off does not change the answer, and a
 * gated port answering 503 to "fold these diacritics" would be a bug. The
 * entity's `@BeforeCreate` / `@BeforeUpdate` hooks and `orders`' list filter
 * both call it, and they must agree or the filter silently stops matching.
 *
 * That agreement is why the fold is characterised rather than merely tested:
 * `backend/test/unit/organizations/name-search-fold-characterisation.test.ts`
 * pins the output for every input this function can meet, because a change here
 * re-folds nothing already written to `name_search` and reports no error when
 * the two stop agreeing.
 *
 * Node natives only (Principle IV).
 */
export function normalizeOrganizationName(input: string): string {
  return foldDiacritics(input).replace(/\s+/g, ' ').trim();
}

/**
 * Thrown when the organisation a read names does not exist. The kernel's
 * `OrganizationReadPort` has documented it as `assertCanTransact`'s failure
 * mode since D-32 while the class itself lived in a module, which is the gap
 * this publication closes.
 */
export class OrganizationNotFoundError extends Error {
  constructor(readonly organizationId: string) {
    super(`Organization ${organizationId} not found.`);
    this.name = 'OrganizationNotFoundError';
  }
}

/**
 * Thrown when a write is attempted for an organisation whose status forbids
 * transacting. Four modules — `carts`, `orders`, `quote_requests` and the
 * external order intake — catch it by class to turn it into a 409 envelope,
 * which is why it is published here rather than being a port: an error is a
 * shape, and `DictionaryReferenceError` in `dictionary.ts` set the precedent.
 */
export class OrganizationCannotTransactError extends Error {
  constructor(
    readonly organizationId: string,
    readonly status: Exclude<OrganizationStatus, 'active'>,
  ) {
    super(`Organization ${organizationId} cannot transact in status '${status}'.`);
    this.name = 'OrganizationCannotTransactError';
  }
}

/** Where a subtree's credit limit is held, and under which mode. */
export interface OrganizationCreditOwner {
  /** Nearest ancestor-or-self holding a `CreditLimit` row, or null when none exists. */
  readonly ownerOrgId: string | null;
  /** Effective mode: the owner's per-org column, else the Settings global default. */
  readonly mode: CreditInheritanceMode;
}

/**
 * Container name: `organizationInheritancePort`. Owner: `organizations`.
 *
 * `credit_limits` is the only consumer: it asks which organisation in the
 * hierarchy actually holds the limit that applies here.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `organizations` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrganizationInheritancePort {
  creditOwner(organizationId: string): Promise<OrganizationCreditOwner>;
}

/** What a cart-approval-policy write answers with. */
export interface CartApprovalPolicyWriteResult {
  readonly organization: OrganizationRecord;
  /**
   * `false` when the row already carried the requested value, so nothing was
   * written and nothing was audited. It is part of the return type rather than
   * something the caller re-derives from a read, because the caller's cascade
   * hangs off it: `carts` resets its pending and approved carts when — and only
   * when — the policy actually moved to `false`.
   */
  readonly changed: boolean;
}

/**
 * Container name: `organizationCartApprovalWritePort`. Owner: `organizations`.
 *
 * The per-organisation "an Org Admin must approve a cart before checkout"
 * policy (feature 027 US4). `carts` drives both surfaces that flip it — the
 * platform-admin route and the Org-Admin self-service one — but the column is
 * this module's, so the operation is (issue #175, D-78 step 1).
 *
 * The write runs through `CommandBus.run`, so it carries the audit row it had
 * never had while `carts` was writing the column directly, with the actor
 * derived from the caller's ambient context (Constitution XIII). The cart
 * cascade that follows a switch-off stays with `carts`: those are its rows, and
 * they are audited in its own per-cart trail.
 *
 * This module is non-deactivatable, so the gate the port registration applies
 * cannot be reached; the registration is a `providePort` anyway, for the reason
 * its siblings give.
 */
export interface OrganizationCartApprovalWritePort {
  setCartApprovalPolicy(
    organizationId: string,
    requiresCartApproval: boolean,
  ): Promise<CartApprovalPolicyWriteResult>;
}

/** The three allow-list kinds an organisation can restrict. */
export type OrganizationAllowListKind =
  | 'paymentMethodIds'
  | 'deliveryMethodIds'
  | 'warehouseIds';

/**
 * Container name: `organizationRestrictionPort`. Owner: `organizations`.
 *
 * `null` means "no restriction configured — everything is allowed", and it is
 * deliberately part of the return type rather than something a caller infers
 * from a thrown error. That is the worked example the composition checklist
 * cites for putting a degrade inside the owner's implementation: a consumer
 * that caught an exception here would turn a fail-closed edge into a
 * fail-open one.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `organizations` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface OrganizationRestrictionPort {
  allowedIdsFor(
    organizationId: string,
    kind: OrganizationAllowListKind,
  ): Promise<string[] | null>;
}

/**
 * Container name: `personalOrganizationPort`. Owner: `organizations`.
 *
 * Feature 051 — a B2C customer is backed by a single-member personal
 * organisation, so ordering, RFQ, credit and invoicing work and the tenant
 * guard isolates each individual as their own tenant. There is no
 * "no-organization" path (Principle XI), which is why this is idempotent
 * rather than a create.
 *
 * Takes the account **id**, not the account: the entity that used to cross
 * here is the shape feature 075 removes, and the second `EntityManager`
 * argument went with it — the one caller already flushes the account before
 * calling.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `organizations` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface PersonalOrganizationPort {
  ensureForCustomerAccount(customerAccountId: string): Promise<OrganizationRecord>;

  /**
   * D-178 — the organisation an account is moved **to** when an operator
   * detaches it from a company, and the one it would already be in had it never
   * joined one.
   *
   * It differs from {@link ensureForCustomerAccount} in exactly one way, and
   * the difference is the whole reason it exists: that method answers with the
   * account's *current* organisation when it has one, so an account inside a
   * company gets that company back. This one always answers with the account's
   * **own** personal organisation, provisioning it if it has never existed.
   *
   * It writes no membership. Binding the account is the caller's write on
   * `customer_accounts`' side of the boundary
   * (`CustomerAccountLifecycleWritePort.detachToPersonalOrganization`), because
   * the authority check and the "an organisation keeps an administrator" guard
   * that must precede it are `customers`' policy.
   *
   * Idempotent: the personal organisation's `taxId` is derived from the account
   * id, so a second call re-finds the row rather than creating a second one.
   */
  provisionPersonalOrganization(customerAccountId: string): Promise<OrganizationRecord>;

  /**
   * Feature 051, the other end of the same rule — the retention sweep's
   * cascade. Once the single member of a personal organisation has been
   * anonymised, the organisation is left with nobody in it and its name is
   * derived from that person's name, so it is scrubbed and soft-deleted too.
   *
   * Answers `null`, and writes nothing, in every case where the cascade does
   * not apply: an org-less account, an organisation that is not personal, one
   * already soft-deleted, and one that still has a live member. That is why it
   * takes the **account** id rather than the organisation's — the caller
   * (`customers`' anonymisation sweep) knows which customer it just scrubbed
   * and must not be the one deciding whether the organisation qualifies.
   *
   * Idempotent: a second call over the same account finds the organisation
   * already soft-deleted and answers `null`.
   */
  anonymizeIfOrphaned(customerAccountId: string): Promise<OrganizationRecord | null>;
}

/** One sales-rep ↔ organisation assignment row. */
export interface SalesRepAssignmentRow {
  readonly id: string;
  readonly organizationId: string;
  readonly adminUserId: string;
  readonly assignedByAdminUserId?: string | null;
  readonly createdAt: Date;
}

/**
 * Container name: `organizationSalesRepScopePort`. Owner: `organizations`.
 *
 * The sales-rep assignment relation as other modules see it. `quote_requests`
 * scopes an admin's RFQ list with it; the admin surfaces read it to decide
 * whether a rep may see an organisation at all.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `organizations` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface SalesRepAssignmentPort {
  canSeeOrganization(adminUserId: string, organizationId: string): Promise<boolean>;
  listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
  listForOrganization(organizationId: string): Promise<SalesRepAssignmentRow[]>;
  assign(input: {
    organizationId: string;
    adminUserId: string;
    assignedByAdminUserId?: string | null;
  }): Promise<SalesRepAssignmentRow>;
  unassign(input: { organizationId: string; adminUserId: string }): Promise<boolean>;
}

/** The address a VAT registry hands back when it recognises the tax id. */
export interface VatReturnedAddress {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export interface VatValidationResult {
  outcome: VatValidationOutcome;
  legalName: string | null;
  address: VatReturnedAddress | null;
  errorKind: string | null;
}

/**
 * Container name: `vatValidatorPort`. Owner: `organizations`.
 *
 * Pluggable VAT-ID validator (feature 026 US7), published so `customers` can
 * name the shape without naming a file in `organizations`.
 *
 * **Owner off:** the seam fails closed — resolving the port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`. That is
 * not the same thing as the `deferred` outcome below: `deferred` is the
 * *registry* being unreachable, which the caller may retry, while a refused
 * resolution says the platform is not offering the check at all.
 *
 * Every adapter MUST degrade safely: a transient network failure or a
 * provider-side 5xx returns `{ outcome: 'deferred', errorKind: … }` rather
 * than throwing. A clean "not registered" response returns
 * `{ outcome: 'failed', errorKind: 'not_found' }`. Only `validated` carries
 * the optional `legalName` + `address` payloads the auto-fill flow consumes.
 */
export interface VatValidator {
  readonly provider: VatValidationProvider;
  validate(input: {
    taxId: string;
    /** Optional country hint extracted upstream (VIES needs the country split). */
    countryCode?: string | undefined;
  }): Promise<VatValidationResult>;
}

/**
 * Container name: `organizationTaxProfilePort`. Owner: `organizations`.
 *
 * The Organization facts a VAT rate depends on (T143c).
 *
 * `country` is nullable because the caller's fallback is a business rule
 * (`'PL'`, in the Quote Requests resolver) and belongs where that rule is
 * written, not here — a port that invented a country would make an
 * unregistered address indistinguishable from a Polish one.
 *
 * Deliberately not a widening of the kernel's `OrganizationSnapshot`. That
 * shape is the tenancy projection every module reads; a tax profile is one
 * consumer's question, and D-55 settled the snapshot at what its callers
 * actually use.
 *
 * **Owner off:** the seam fails closed — resolving the port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`. The Quote
 * Requests tax closure deliberately carries no `catch` (issue #84): quoting
 * 0 % on an operator's behalf is worse than failing.
 *
 * It is declared here rather than in `organizations`' own `./backend` because
 * a port's type argument is a contract type and never the provider's file
 * (composition checklist item 3). The production composition root resolves this
 * name, and `specs/110-instance-repository/` T118 moves that read into
 * `@endora-commerce/platform`, where naming a module is D-52/D-53's refusal.
 */
export interface OrganizationTaxProfilePort {
  taxProfileOf(organizationId: string): Promise<{
    vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
    country: string | null;
  } | null>;
}
