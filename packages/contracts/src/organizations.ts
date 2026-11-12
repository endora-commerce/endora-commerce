import { z } from 'zod';
import {
  addressSnapshotSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common.js';
import { fulfilmentStrategySchema, type FulfilmentStrategy } from './inventory.js';
import { organizationRoleRefSchema } from './organization-roles.js';
import { SalesChannelOptionSchema } from './sales-channels.js';
import { foldDiacritics } from './text-normalization.js';
import { registryLookupIdSchema } from './organization-registry-lookup.js';
import { ExtensionAttributesSchema } from './schema-extensions.js';
import { customFieldValuesSchema } from './custom-fields.js';

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

/**
 * The codes a redacted `organization` audit row keeps (issue #844).
 *
 * Owner: `organizations`; **codes only** — see
 * `CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS` for the rule they extend. This module's
 * snapshots record codes under `provider` and `outcome` (a tax-id validation)
 * and `creditInheritanceMode`; `blockSource` and `countryCode` are kept
 * wherever a writer records them, as they are on the account and the address.
 * `orderConfirmationEmailCount` is the count the `organization.anonymized` row
 * records instead of the addresses: the retention sweep redacts after that row
 * is written, and must leave it as its owner wrote it (issue #844).
 */
export const ORGANIZATION_AUDIT_KEEP_KEYS: readonly string[] = [
  'blockSource',
  'countryCode',
  'creditInheritanceMode',
  'orderConfirmationEmailCount',
  'outcome',
  'provider',
];

export const addressKindSchema = z.enum(['delivery', 'billing']);
export type AddressKind = z.infer<typeof addressKindSchema>;

// --- Resources --------------------------------------------------------------

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /**
   * `specs/177-tax-id-scope/` — `null` for a personal (B2C) organization, which
   * has no tax ID; a company organization always has one (FR-001, FR-004).
   */
  taxId: z.string().nullable(),
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

/**
 * `specs/178-extensible-columns/` FR-051 — an Organization as the admin detail
 * and list reads return it. `extensions` is present only when the request named
 * modules with `?extensions=` (`ExtensionsQuerySchema`): per
 * named module that declares columns on `organizations` with `adminReads` and is
 * present, its declared keys and values; an absent, switched-off or
 * non-exposing module is simply not a key (FR-052).
 */
export const adminOrganizationSchema = organizationSchema.extend({
  extensions: ExtensionAttributesSchema.optional(),
});
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

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
  /**
   * The member's role (`specs/170-organization-roles/`, FR-008, FR-056); it
   * replaced the legacy two-value `role`, removed by WP-12 (FR-073).
   */
  organizationRole: organizationRoleRefSchema,
  /** The member's effective organization permissions, sorted (FR-056). */
  permissions: z.array(z.string()),
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

/**
 * `specs/177-tax-id-scope/` — the one normalisation a tax ID gets before it is
 * stored or looked up: whitespace and dashes stripped, upper-cased. It is the
 * admin boundary's rule (`organizations`' `schemas/organization.ts`), published
 * so the lookups (`OrganizationDetailsPort.findByTaxId`) and the conversion body
 * apply exactly the same one. Pure, so it is a function and not a port.
 */
export function normalizeTaxId(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** A tax ID as an operator types it, normalised, then held to the stored length (8–32). */
const normalizedTaxIdSchema = z.string().transform(normalizeTaxId).pipe(z.string().min(8).max(32));

export const registerOrganizationRequestSchema = z.object({
  organization: z.object({
    name: z.string().min(1).max(255),
    // `specs/177-tax-id-scope/` — normalised, then held to the stored length,
    // so `--------` is refused instead of storing an empty tax ID.
    taxId: normalizedTaxIdSchema,
    registeredAddress: z.object({
      street: z.string().min(1).max(255),
      city: z.string().min(1).max(120),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2),
    }),
    vatStatus: vatStatusSchema.optional(),
    /**
     * Feature 175 — the Organization's custom-field values (entity type
     * `organization`). On registration they are validated as BUYER input on
     * the `organization.register` surface; on the admin create, which derives
     * from this member (`AdminOrganizationCreateBodySchema`), with the
     * administrator's rules — the two routes never share a validator (FR-023).
     */
    customFieldValues: customFieldValuesSchema.optional(),
  }),
  firstUser: z.object({
    email: z.string().email(),
    password: z.string().min(12).max(256),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    /**
     * Feature 175 — the registering person's custom-field values (entity type
     * `customer`), validated as buyer input on `organization.register`.
     */
    customFieldValues: customFieldValuesSchema.optional(),
  }),
  acceptedTermsVersion: z.string(),
  /**
   * Feature 173 — the reference a registry lookup answered
   * (`organization-registry-lookup.ts`). Top-level, not inside `organization`:
   * `AdminOrganizationCreateBodySchema` is derived from that member and the
   * admin create must not accept it. The snapshot is read from the platform's
   * own store by this id, never from the client (FR-019).
   */
  registryLookupId: registryLookupIdSchema.optional(),
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
  /**
   * `skipped_permission` (owner ruling PR-12, `specs/170-organization-roles/`):
   * the member's role lacks `carts.create`, so sign-in did not merge the guest
   * basket. The HTTP narrowing reports it as `'noop'`.
   */
  outcome: z.enum(['adopted', 'merged', 'noop_empty', 'noop_no_anon', 'skipped_permission']),
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
      /** The member's role (FR-056); it replaced the legacy `role` (FR-073). */
      organizationRole: organizationRoleRefSchema,
      /** The member's effective organization permissions, sorted (FR-056). */
      permissions: z.array(z.string()),
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

export const acceptInvitationRequestSchema = z.object({
  password: z.string().min(12),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
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

/** `gus_pl` — feature 173: the GUS REGON registry, written by a registration-time lookup. */
export type VatValidationProvider = 'vies' | 'mf_pl' | 'format_only' | 'gus_pl';

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
  /**
   * `null` for a personal (B2C) organization (`specs/177-tax-id-scope/`,
   * FR-004): it used to carry a 32-hex placeholder derived from its account id.
   * Print it through {@link organizationCompanyTaxId}.
   */
  taxId: string | null;
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
  /**
   * When `organization.convert_to_company` turned this personal organization
   * into a company (`specs/177-tax-id-scope/`, FR-039); `null` for one that was
   * never converted. Set once, never cleared — `returns` reads it to keep a
   * consumer's withdrawal right for orders placed before it (FR-040).
   */
  convertedToCompanyAt: Date | null;
}

// --- Tax-ID scope (specs/177-tax-id-scope/) ----------------------------------

/**
 * Where the same tax ID may appear twice (`contracts/tax-id-scope.md` §1):
 * `global` — nowhere, every tax ID belongs to one organization (the default of
 * every installation); `per-tree-root` — only inside one organization tree, so
 * a head office and its branches may share it. Enforced by the database and
 * changed only by the audited `organization.tax_id_scope.set` Command.
 */
export const taxIdScopeSchema = z.enum(['global', 'per-tree-root']);
export type TaxIdScope = z.infer<typeof taxIdScopeSchema>;

/** `PUT /api/v1/admin/organizations/tax-id-scope` — the scope to switch to. */
export const adminTaxIdScopeSetBodySchema = z.object({ scope: taxIdScopeSchema });
export type AdminTaxIdScopeSetBody = z.infer<typeof adminTaxIdScopeSetBodySchema>;

/**
 * `GET` / `PUT /api/v1/admin/organizations/tax-id-scope` — the installation's
 * scope, who set it last, how many tax IDs are on more than one organization,
 * and whether the database enforcement agrees with the stored scope
 * (`mismatch` only after a hand edit; re-applying the scope repairs it).
 */
export const adminTaxIdScopeResponseSchema = z.object({
  data: z.object({
    scope: taxIdScopeSchema,
    updatedAt: isoDateTimeSchema,
    updatedByAdminUserId: uuidSchema.nullable(),
    sharedTaxIdCount: z.number().int().nonnegative(),
    enforcement: z.enum(['consistent', 'mismatch']),
  }),
});
export type AdminTaxIdScopeResponse = z.infer<typeof adminTaxIdScopeResponseSchema>;

/**
 * What {@link OrganizationDetailsPort.resolveByTaxId} answers. `one` carries the
 * tree's root (all matches share it in both scopes); `ambiguous` — matches in
 * more than one tree — is unreachable in `global` and `per-tree-root` alike and
 * is typed for a later scope, so a caller handles it today.
 */
export type TaxIdResolution =
  | { kind: 'none' }
  | { kind: 'one'; organization: OrganizationRecord }
  | { kind: 'ambiguous'; organizations: OrganizationRecord[] };

// --- Personal → company conversion (specs/177-tax-id-scope/) -----------------

/**
 * `POST /api/v1/admin/organizations/:id/convert-to-company`
 * (`contracts/convert-to-company.md` §2). The tax ID is normalised exactly as
 * the admin boundary normalises it. `validateTaxId` is the route's own switch
 * — a VAT validation after the conversion commits — and is not part of the
 * Command's input.
 */
export const adminOrganizationConvertToCompanyBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  legalName: z.string().trim().min(1).max(255).optional(),
  taxId: normalizedTaxIdSchema,
  registeredAddress: z.object({
    street: z.string().min(1).max(255),
    city: z.string().min(1).max(120),
    postalCode: z.string().min(1).max(20),
    country: z.string().length(2),
  }),
  vatStatus: vatStatusSchema.default('vat_payer'),
  validateTaxId: z.boolean().default(false),
});
export type AdminOrganizationConvertToCompanyBody = z.infer<
  typeof adminOrganizationConvertToCompanyBodySchema
>;
export type OrganizationConvertToCompanyInput = Omit<
  AdminOrganizationConvertToCompanyBody,
  'validateTaxId'
>;

/**
 * Container name: `organizationCommandPort`. Owner: `organizations`
 * (`specs/177-tax-id-scope/` `contracts/convert-to-company.md` §4).
 *
 * Server-side writes on the Organization aggregate, each one audited Command.
 * **No permission is checked here** — the caller is the gate: an admin route
 * behind `organizations:convert-to-company` and the reach rule, or
 * operator-run server code. Never resolve it for a customer-facing route.
 */
export interface OrganizationCommandPort {
  /**
   * Runs `organization.convert_to_company` as one Command with the ambient
   * actor (an administrator inside an admin request; the system under
   * `withSystemScope` in a worker). For admin routes and server code — an ERP
   * import — and never for a customer-facing route. No VAT validation: trigger
   * one after it resolves if you need it. Refusals: `404 NOT_FOUND`,
   * `409 ORGANIZATION_CONVERSION_REFUSED`, `409 ORGANIZATION_TAX_ID_EXISTS`,
   * and whatever a command hook on the action vetoes with. `options.extensions`
   * reaches those hooks (issue #1057).
   */
  convertToCompany(
    organizationId: string,
    input: OrganizationConvertToCompanyInput,
    options?: OrganizationCommandPortOptions,
  ): Promise<OrganizationRecord>;
  /**
   * Issue #1040 — runs `organization.tax_id.change` as one Command with the
   * ambient actor: corrects a live company organization's tax ID in place (same
   * id, members, roles and orders). The value is normalised and checked in the
   * active tax-ID scope inside the write; the organization's VAT validation is
   * reset to unverified. The same value after normalisation changes nothing and
   * is not audited, unless a command hook on the action noted a write of its
   * own; `options.extensions` reaches those hooks (issue #1057). No VAT validation runs: trigger one after it resolves if you
   * need it. Refusals: `404 NOT_FOUND`, `409 ORGANIZATION_TAX_ID_CHANGE_REFUSED`
   * (`not_company` | `deleted`), `409 ORGANIZATION_TAX_ID_EXISTS`,
   * `409 ORGANIZATION_WRITE_CONTENDED`.
   */
  changeTaxId(
    organizationId: string,
    input: OrganizationChangeTaxIdInput,
    options?: OrganizationCommandPortOptions,
  ): Promise<OrganizationRecord>;
}

/**
 * What a server-side caller may hand either {@link OrganizationCommandPort}
 * method besides its input (issue #1057, as `OrganizationCustomFieldWriteOptions`
 * for the custom-field port).
 *
 * `extensions` is extension input for the command-hook modules on
 * `organization.convert_to_company` / `organization.tax_id.change`, keyed by
 * module id; each hook sees only its own module's key. A key no present hook
 * module claims is refused `422 COMMAND_EXTENSION_UNCLAIMED` before anything is
 * written. No HTTP body carries it — that field is spec 178's.
 */
export interface OrganizationCommandPortOptions {
  readonly extensions?: Readonly<Record<string, unknown>>;
}

// --- Tax-ID correction (issue #1040, follow-up to specs/177-tax-id-scope/) ----

/**
 * `POST /api/v1/admin/organizations/:id/change-tax-id`. The tax ID is
 * normalised exactly as the admin boundary normalises it on creation.
 * `validateTaxId` is the route's own switch — a VAT validation after the change
 * commits, whose failure never undoes it — and is not part of the Command's
 * input.
 */
export const adminOrganizationChangeTaxIdBodySchema = z.object({
  taxId: normalizedTaxIdSchema,
  validateTaxId: z.boolean().default(false),
});
export type AdminOrganizationChangeTaxIdBody = z.infer<typeof adminOrganizationChangeTaxIdBodySchema>;
export type OrganizationChangeTaxIdInput = Omit<AdminOrganizationChangeTaxIdBody, 'validateTaxId'>;

/**
 * `organization.tax_id_changed.v1` — emitted once, after the change commits,
 * never on rollback and never for a same-value no-op. Carries neither the old
 * nor the new tax ID (the precedent of
 * {@link OrganizationConvertedToCompanyEvent}): a tax ID is personal data for a
 * sole trader, and a subscriber that needs the current value reads it through
 * {@link OrganizationDetailsPort}.
 */
export interface OrganizationTaxIdChangedEvent {
  eventId: string;
  /** ISO-8601. */
  occurredAt: string;
  organizationId: string;
  /** ISO-8601 — when the change committed its write. */
  changedAt: string;
}

/**
 * `organization.converted_to_company.v1` — emitted once, after the conversion
 * commits, never on rollback (FR-039). Carries no name and no tax ID: a
 * subscriber has the id and {@link OrganizationDetailsPort}.
 */
export interface OrganizationConvertedToCompanyEvent {
  eventId: string;
  /** ISO-8601. */
  occurredAt: string;
  organizationId: string;
  /** ISO-8601 — the organization's `convertedToCompanyAt`. */
  convertedAt: string;
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
  /**
   * `specs/177-tax-id-scope/` (FR-023) — every live organization holding this
   * tax ID: the tree's root first, then by depth, creation time and id. The
   * input is normalised with {@link normalizeTaxId}; an input with nothing left
   * answers `[]`. Soft-deleted rows are excluded unless `includeDeleted`.
   * In `global` there is at most one; in `per-tree-root` a head office and its
   * branches. Never matches a personal organization, which has no tax ID.
   */
  findByTaxId(taxId: string, options?: { includeDeleted?: boolean }): Promise<OrganizationRecord[]>;
  /**
   * The single organization a tax ID resolves to — the root of the tree that
   * holds it (the live root, else the oldest live match), `none` when no live
   * organization holds it. See {@link TaxIdResolution} for `ambiguous`.
   */
  resolveByTaxId(taxId: string): Promise<TaxIdResolution>;
}

/**
 * Container name: `organizationCustomFieldWritePort`. Owner: `organizations`.
 *
 * The server-side write of an Organization's custom-field values — for code
 * with no admin request to ride on: a subscriber on
 * `organization.registered.v1`, an overlay module, an integration worker. The
 * case it was published for is an `audience: internal` field (an acquisition
 * source, say) set after self-registration, which by design cannot travel
 * through the buyer's registration input. Before it the only ways were the
 * admin HTTP API or a native `UPDATE organizations SET custom_field_values`,
 * and the second breaks Principle I.
 *
 * A port of its own rather than a method on the read-only
 * {@link OrganizationDetailsPort}, mirroring
 * `CustomerAccountLifecycleWritePort.setCustomFieldValues` on the account side.
 *
 * **The merge is the caller's.** The owner loads the Organization, calls
 * `merge` with its current bag and stores what `merge` returns — inside **one
 * transaction, as one Command (`organization.set_custom_field_values`) with one
 * audit row** naming the keys that changed (`changedCustomFields`), never
 * their values (`specs/conventions/audit-state.md`). It is a callback rather
 * than a pre-merged bag because the read, the validation and the write have
 * to share that transaction, or a concurrent write is silently lost.
 *
 * **The owner does not validate.** Whatever `merge` returns is stored, so the
 * caller validates inside it through `CustomFieldValuePort.validateAndMerge`
 * (the administrator's rules — an `internal` field is accepted, unknown keys
 * are dropped, every `required` definition is enforced):
 *
 * ```ts
 * await organizationCustomFieldWritePort.setCustomFieldValues(organizationId, (current) =>
 *   customFieldValueService.validateAndMerge('organization', current, { acquisition_source: 'trade_fair' }),
 * );
 * ```
 *
 * **Failures propagate unchanged.** A throwing `merge` — `custom_fields`'
 * validation failure included — rolls the transaction back, stores nothing,
 * records nothing, and reaches the caller as it was thrown. An unknown or
 * soft-deleted Organization (or an id that is not a uuid) throws the platform's
 * `404 NOT_FOUND` HTTP error before `merge` is called, as the account port does.
 *
 * **The actor is the ambient one.** The Command Bus records the actor of the
 * caller's tenant context, never one passed in: an administrator inside an
 * admin request, and a null actor (system) for a subscriber or a worker. A
 * subscriber runs in its emitter's context, and `organization.registered.v1` is
 * emitted by the anonymous registration request, which the platform scopes as
 * system — so the entry records no actor. With no tenant context at all the bus
 * refuses before `merge` runs (`MissingTenantContextError`); a detached caller
 * (a timer, a script) opens one with `enterSystemScope`.
 *
 * **It is not transactional with registration.** Called from an
 * `organization.registered.v1` subscriber it runs after the registration
 * committed, in a transaction of its own: best effort. A failure leaves the
 * Organization registered without the value, and the event bus logs a
 * subscriber's error rather than surfacing it to the buyer.
 *
 * When `organizations` is off the method fails closed (503 `MODULE_DISABLED`);
 * the module is the platform's one tenant concept, so in practice the gate
 * cannot close.
 */
export interface OrganizationCustomFieldWritePort {
  setCustomFieldValues(
    organizationId: string,
    merge: (current: Record<string, unknown>) => Promise<Record<string, unknown>>,
    options?: OrganizationCustomFieldWriteOptions,
  ): Promise<OrganizationRecord>;
}

/**
 * What a server-side caller may hand `setCustomFieldValues` besides the merge
 * (`specs/176-command-hooks-outbox/` FR-018, architect ruling on #1055 Q2).
 *
 * `extensions` is extension input for the command-hook modules on
 * `organization.set_custom_field_values`, keyed by module id; each hook sees only
 * its own module's key. A key no present hook module claims is refused
 * `422 COMMAND_EXTENSION_UNCLAIMED` before the merge runs. No HTTP body carries
 * it — that field is spec 178's.
 */
export interface OrganizationCustomFieldWriteOptions {
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * The tax id a reader may print or hand out for an Organization: a company's,
 * never a personal (B2C) Organization's. A personal Organization stores no tax
 * id at all since `specs/177-tax-id-scope/` (it carried an internal 32-hex
 * placeholder derived from the account id until then, issue #767), and the flag
 * is still honoured for a payload written before that. `null` — not an empty
 * string — when there is nothing to show, so every renderer drops its tax-id
 * line rather than printing a label with no value.
 *
 * Published as a **function, not a port**, for the reason
 * {@link normalizeOrganizationName} is: it is pure over its argument. Every
 * module that prints an {@link OrganizationRecord}'s tax id asks it — the quote
 * request document, the admin order and quote request panels, the price-book
 * and push audience pickers, and the storefront's checkout — so the rule has
 * one home.
 */
export function organizationCompanyTaxId(organization: {
  /** Absent reads as a company, as a session payload without the flag does. */
  readonly isPersonal?: boolean | undefined;
  readonly taxId: string | null;
}): string | null {
  if (organization.isPersonal) return null;
  const taxId = organization.taxId?.trim() ?? '';
  return taxId === '' ? null : taxId;
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
 * A personal organisation as {@link PersonalOrganizationPort.provisionPersonalOrganization}
 * answers it: the record, and the id of its *Administrator* role — the role
 * its single member holds (`specs/170-organization-roles/`, owner ruling PR-3,
 * research R-34), which a caller moving the account there writes with it.
 */
export interface ProvisionedPersonalOrganizationRecord extends OrganizationRecord {
  administratorRoleId: string;
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
   * Idempotent by the account link: the personal organisation records the
   * account it was provisioned for (`specs/177-tax-id-scope/`, FR-003), so a
   * second call re-finds the row rather than creating a second one. It has no
   * tax ID.
   */
  provisionPersonalOrganization(customerAccountId: string): Promise<ProvisionedPersonalOrganizationRecord>;

  /**
   * Feature 051, the other end of the same rule — the retention sweep's
   * cascade. Once the single member of a personal organisation has been
   * soft-deleted, the organisation is left with no live member and its name is
   * derived from that person's name, so it is scrubbed and soft-deleted too.
   *
   * **Convergent** (issue #800). The sweep calls this *before* it anonymises
   * the account, and calls it again on the next tick if anything after it
   * failed. It writes only what part of the scrub is still missing (the name,
   * the registered address, the legal name, the order-confirmation e-mails,
   * every custom field value, the block and rejection reasons (issue #843:
   * set to `null`, while the status and its dates stay), `deletedAt` — an
   * existing `deletedAt` is kept),
   * in one transaction with its audit row, and records nothing when nothing
   * was missing. The audit row names none of the erased data (issue #802).
   * It answers the organisation **whether or not it wrote anything**,
   * so a repeat call still tells the caller which saved addresses to clear.
   *
   * Answers `null`, and writes nothing, only where the cascade does not apply:
   * an org-less account, an organisation that is not personal, and one that
   * still has a live member. That is why it takes the **account** id rather
   * than the organisation's — the caller (`customers`' anonymisation sweep)
   * knows which customer it is scrubbing and must not be the one deciding
   * whether the organisation qualifies.
   */
  anonymizeIfOrphaned(customerAccountId: string): Promise<OrganizationRecord | null>;

  /**
   * Issue #923 — the ids of the personal organisations a scrub has reached
   * (they carry its name) that do not yet hold all of the **current** scrub:
   * one an earlier release scrubbed before the rule grew, or one a crash left
   * half-written. The retention sweep runs each one's anonymised member
   * through the cascade again, and {@link anonymizeIfOrphaned} writes what is
   * missing, so a field added to the scrub reaches every earlier subject on
   * the next run with no backfill.
   *
   * The selection is free of any retention cutoff: a subject already
   * anonymised is finished whatever the window reads today. It agrees field by
   * field with the owner's own "fully scrubbed" test, which stays the
   * in-transaction re-check; a live organisation that merely carries the name
   * may be listed, and is left alone because it still has a live member.
   *
   * Reads only the owner's rows; writes nothing. Unbounded, like
   * `CustomerAccountLifecycleWritePort.listDueForAnonymization`: in steady
   * state it answers an empty list.
   */
  listIncompletelyScrubbed(): Promise<string[]>;

  /**
   * Whether {@link listIncompletelyScrubbed} would list anything — **yes or
   * no, and nothing else**. The retention sweep's scheduled tick asks it with
   * no tenant context, before it enters the system scope, beside
   * `CustomerAccountLifecycleWritePort.hasDueForAnonymization`, so that a tick
   * with organisation-side residue to finish is not taken for an idle one. It
   * is the list's own row source; no id, row or count leaves it.
   */
  hasIncompletelyScrubbed(): Promise<boolean>;
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

/**
 * Which organizations an admin's requests may reach: every one, a named set, or
 * every one but a named set (issue #305).
 *
 * The platform turns it into the ambient tenant context, and the admin lists
 * read their scope from that context, so the two cannot disagree about one
 * admin.
 */
export type AdminTenantScope =
  | { readonly allowAll: true }
  | {
      readonly allowAll: false;
      readonly allowedOrganizationIds: string[];
      /**
       * Set when the admin's reach could not be established at all — the id
       * names no live administrator, or the administrator holds no role. The
       * scope then names **no** organization and carries the refusal, which the
       * tenant guard raises on the first tenant-scoped read of the request. It
       * can only turn an answer into a refusal, never widen one.
       */
      readonly unresolved?: Error;
    }
  | {
      /**
       * Issue #305 — a sales representative's reach, described by its
       * **complement**: every Organization except those governed by somebody
       * else. Under the reach rule a representative sees every Organization
       * nobody is assigned to (B2C personal organizations included, which can
       * never carry an assignment), so the reachable set grows with the
       * customer base while the excluded one is bounded by the B2B book.
       */
      readonly allowAll: false;
      readonly reach: 'excluding';
      /**
       * Issue #955 (architect ruling, Q2; owner ruling of 2026-11-10) — the excluded organizations as one
       * uncorrelated SELECT of a single non-null uuid column, read live in each
       * statement's own snapshot. Built by the owner from the authenticated
       * admin's identity and permissions only — never from request input. The
       * platform renders it on the filtered row's own organization column as
       * `col is not null and col not in (<sql>)`; no module reads it.
       */
      readonly excludedOrganizationsQuery: {
        readonly sql: string;
        readonly params: readonly (string | boolean)[];
      };
      /**
       * Issue #955 Phase 2 (owner ruling of 2026-11-10) — the lists, on demand:
       * the organizations governed by another representative, and the
       * representative's own assignments (roll-up expanded; ranking and "mine"
       * filters only, never a filter input). They replaced the
       * `excludedOrganizationIds` / `assignedOrganizationIds` fields, which made
       * every admin request compute them. The owner memoises the call once per
       * answered scope; a failure rejects, which refuses rather than widens.
       */
      readonly loadReach: () => Promise<{
        readonly excludedOrganizationIds: readonly string[];
        readonly assignedOrganizationIds: readonly string[];
      }>;
      readonly unresolved?: Error;
    };

/**
 * Container name: `adminTenantScopePort`. Owner: `organizations`.
 *
 * The tenant reach of an authenticated admin, derived from the role the admin
 * holds and never from request inputs (Principle XI). An admin whose role is
 * the sales-representative one answers the `excluding` reach (issue #305): every
 * Organization except those governed by another representative — the reach
 * rule of `SalesRepAssignmentPort.canSeeOrganization`, assigned, roll-up and
 * the unassigned fallback — and an admin holding any other role answers
 * `allowAll`. The `allowedOrganizationIds` member remains for the customer
 * roll-up and API keys, which name their set.
 *
 * **An admin with no role is refused, never widened.** An id that names no
 * live administrator, or an administrator holding no role, answers the empty
 * set with `unresolved` carrying a 403 `ADMIN_ROLE_REQUIRED`. Nothing answers
 * `allowAll` for want of a role.
 *
 * **Its consumer is the platform's request-scope hook**, which establishes the
 * ambient tenant context from the authenticated actor before any handler runs.
 * The rule is a module's — a role code over two modules' rows — so the platform
 * asks for the answer here rather than deciding it, and a composition that
 * registers no such port gives an admin **no** organization rather than all of
 * them.
 *
 * It takes the admin's id rather than a request because the question is about
 * an identity; reading the actor off the request is the caller's half.
 *
 * **Owner off:** resolving this port throws `ModuleDisabledError`, as every
 * gated port does, and so does a call made while `admin_users` or `admin_roles`
 * — which the implementation reads the role through — is absent. **The
 * platform's request-scope hook does not turn that into a 503 for the whole
 * request**: it gives the admin a context holding no organization and defers
 * the refusal to the first tenant-scoped read, which answers 503
 * `MODULE_DISABLED`. That is the confined end, so nothing widens, and routes
 * over global data keep answering — the module-presence projection among them,
 * which an operator needs exactly when a module is absent. Any other consumer
 * gets the throw at the call. Whether `organizations` has an off state at
 * all is its manifest's `activation` to say, not this line's: a module
 * declaring `nonDeactivatable` never enters one.
 */
export interface AdminTenantScopePort {
  resolveForAdmin(adminUserId: string): Promise<AdminTenantScope>;
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

// --- Sales-channel assignment and admin creation (feature 154) ------------

/**
 * A set of sales-channel ids an Organization is assigned to: at least one (an
 * Organization with no channel may shop nowhere), at most 100, no repeats.
 */
const organizationSalesChannelIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Each sales channel may be listed once.',
  });

/**
 * `GET`/`PUT /api/v1/admin/organizations/:id/sales-channels` — the channels an
 * Organization's members may sign in and shop on
 * (`specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §2).
 *
 * `options` is every channel the Organization may be assigned to, inactive ones
 * included and flagged, so the panel needs no `sales_channels:read`.
 */
export const OrganizationSalesChannelOptionSchema = SalesChannelOptionSchema.extend({
  systemDefault: z.boolean(),
});
export type OrganizationSalesChannelOption = z.infer<typeof OrganizationSalesChannelOptionSchema>;

export const OrganizationSalesChannelsResponseSchema = z.object({
  data: z.object({
    organizationId: uuidSchema,
    assignedSalesChannelIds: z.array(uuidSchema),
    options: z.array(OrganizationSalesChannelOptionSchema),
  }),
});
export type OrganizationSalesChannelsResponse = z.infer<
  typeof OrganizationSalesChannelsResponseSchema
>;

/** `PUT /api/v1/admin/organizations/:id/sales-channels` — replaces the whole set. */
export const OrganizationSalesChannelsUpdateBodySchema = z.object({
  salesChannelIds: organizationSalesChannelIdsSchema,
});
export type OrganizationSalesChannelsUpdateBody = z.infer<
  typeof OrganizationSalesChannelsUpdateBodySchema
>;

/**
 * `POST /api/v1/admin/organizations` — an operator creates a customer
 * Organization and chooses its sales channels (§3). The organization fields are
 * self-registration's own, so the two creation paths cannot drift apart; the
 * status is one an operator may start from, and the channels are bound in the
 * creating transaction.
 */
export const AdminOrganizationCreateBodySchema = registerOrganizationRequestSchema.shape.organization
  .extend({
    status: z.enum(['active', 'pending_verification']).default('active'),
    salesChannelIds: organizationSalesChannelIdsSchema,
    /**
     * `specs/177-tax-id-scope/` (FR-018) — create the organization as a branch
     * under this parent, in the same Command, so that in `per-tree-root` it may
     * carry the head office's tax ID. Naming a parent requires an unscoped
     * platform administrator (D-260).
     */
    parentId: uuidSchema.optional(),
  });
export type AdminOrganizationCreateBody = z.infer<typeof AdminOrganizationCreateBodySchema>;
export type AdminOrganizationCreateRequest = z.input<typeof AdminOrganizationCreateBodySchema>;

/**
 * `GET /api/v1/admin/organizations/sales-channel-options` — what the *New
 * organization* form chooses from, before there is an Organization to ask about.
 */
export const OrganizationSalesChannelOptionsResponseSchema = z.object({
  data: z.array(OrganizationSalesChannelOptionSchema),
});
export type OrganizationSalesChannelOptionsResponse = z.infer<
  typeof OrganizationSalesChannelOptionsResponseSchema
>;
