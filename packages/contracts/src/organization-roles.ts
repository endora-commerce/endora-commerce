import { z } from 'zod';
import type { Actor } from './actor.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { ERROR_CODES } from './errors.js';

/**
 * Organization roles and organization permissions — the buyer's side of
 * "who may do what" (`specs/170-organization-roles/`).
 *
 * An Organization holds two predefined roles — *Administrator* (every present
 * permission, immutable) and *Member* (editable) — and up to fifty custom ones.
 * Each member holds exactly one. A role is a set of **organization permission**
 * codes (`<module>.<action>`), declared by the module whose buyer action each
 * gates in its manifest's `organizationPermissions` field (`./modules.ts`).
 * The operator vocabulary (`<area>:<action>`, `/admin-roles`) is a different
 * one and the two never meet (FR-020, research R-2).
 *
 * Normative: `specs/170-organization-roles/contracts/organization-permission-port.md`
 * and `contracts/storefront-api.md` §2. They replaced the legacy two-value role
 * enum, removed with its columns by the feature's legacy-removal package
 * (research R-23).
 */

// --- Kinds and references ----------------------------------------------------

export const organizationRoleKindSchema = z.enum(['administrator', 'member', 'custom']);
export type OrganizationRoleKind = z.infer<typeof organizationRoleKindSchema>;

/**
 * The role as every response shows it (FR-008, FR-056, FR-073). `name` is the
 * translated label for `administrator` / `member` in the response language and
 * the stored name for `custom`.
 */
export const organizationRoleRefSchema = z
  .object({ id: uuidSchema, name: z.string(), kind: organizationRoleKindSchema })
  .strict();
export type OrganizationRoleRef = z.infer<typeof organizationRoleRefSchema>;

/**
 * One role on the role-management screens, storefront and Admin UI alike
 * (`contracts/storefront-api.md` §2). `permissions` are the stored grants of
 * **present** codes only — a grant of a switched-off module's code is kept
 * server-side and never round-trips through the editor (FR-025); for the
 * administrator it is every present code. `pendingInvitationCount` counts
 * invitations neither accepted, revoked nor expired (FR-010a).
 */
export const organizationRoleViewSchema = z.object({
  id: uuidSchema,
  kind: organizationRoleKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  memberCount: z.number().int().min(0),
  pendingInvitationCount: z.number().int().min(0),
  version: z.number().int().min(1),
  updatedAt: isoDateTimeSchema,
});
export type OrganizationRoleView = z.infer<typeof organizationRoleViewSchema>;

export const organizationRoleListResponseSchema = z.object({ data: z.array(organizationRoleViewSchema) });
export type OrganizationRoleListResponse = z.infer<typeof organizationRoleListResponseSchema>;

export const organizationRoleResponseSchema = z.object({ data: organizationRoleViewSchema });
export type OrganizationRoleResponse = z.infer<typeof organizationRoleResponseSchema>;

/** One grantable code, translated in the request language (R-31). */
export const organizationPermissionCatalogueEntrySchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string(),
  memberDefault: z.boolean(),
});
export type OrganizationPermissionCatalogueEntry = z.infer<typeof organizationPermissionCatalogueEntrySchema>;

/** `GET …/permission-catalogue` — present codes only, grouped by declaring module. */
export const organizationPermissionCatalogueResponseSchema = z.object({
  data: z.object({
    groups: z.array(
      z.object({
        moduleId: z.string(),
        moduleLabel: z.string(),
        permissions: z.array(organizationPermissionCatalogueEntrySchema),
      }),
    ),
  }),
});
export type OrganizationPermissionCatalogueResponse = z.infer<
  typeof organizationPermissionCatalogueResponseSchema
>;

/** `GET /api/v1/organizations/mine/role` — the member's own role (FR-058). */
export const organizationOwnRoleResponseSchema = z.object({
  data: z.object({
    role: organizationRoleRefSchema,
    permissions: z.array(z.object({ code: z.string(), label: z.string(), description: z.string() })),
  }),
});
export type OrganizationOwnRoleResponse = z.infer<typeof organizationOwnRoleResponseSchema>;

/** `DELETE …/roles/:id` — what moved to the replacement role (FR-024). */
export const deleteOrganizationRoleResponseSchema = z.object({
  data: z.object({
    reassignedMembers: z.number().int().min(0),
    reassignedInvitations: z.number().int().min(0),
  }),
});
export type DeleteOrganizationRoleResponse = z.infer<typeof deleteOrganizationRoleResponseSchema>;

// --- Requests -----------------------------------------------------------------
//
// Every request schema here is `.strict()`, and that is load-bearing (FR-073,
// research R-24): Zod's default `.object` strips an unknown key silently, so a
// client still sending the legacy `role` would be answered as though it had
// asked for the default role. Strict refuses it with `400 VALIDATION_FAILED`
// naming the key.

const roleNameSchema = z.string().trim().min(1).max(80);
const roleDescriptionSchema = z.string().trim().max(500);
const permissionCodesSchema = z.array(z.string().min(1));

/** `POST …/roles` — a custom role. */
export const createOrganizationRoleRequestSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema.optional(),
    permissions: permissionCodesSchema,
  })
  .strict();
export type CreateOrganizationRoleRequest = z.infer<typeof createOrganizationRoleRequestSchema>;

/**
 * `PATCH …/roles/:id`. `expectedVersion` is the version the editor read
 * (`ORGANIZATION_ROLE_STALE` on mismatch, R-29); `name` and `description` are
 * refused for the *Member* role by the Command, not by the schema.
 */
export const updateOrganizationRoleRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.nullable().optional(),
    permissions: permissionCodesSchema.optional(),
  })
  .strict();
export type UpdateOrganizationRoleRequest = z.infer<typeof updateOrganizationRoleRequestSchema>;

/** `DELETE …/roles/:id`. A held role needs a replacement (FR-024). */
export const deleteOrganizationRoleRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    replacementRoleId: uuidSchema.optional(),
  })
  .strict();
export type DeleteOrganizationRoleRequest = z.infer<typeof deleteOrganizationRoleRequestSchema>;

/**
 * `PATCH /api/v1/organizations/mine/members/:id/role` — replaces the legacy
 * `changeMemberRoleRequestSchema` (`{ role }`).
 */
export const assignMemberRoleRequestSchema = z.object({ roleId: uuidSchema }).strict();
export type AssignMemberRoleRequest = z.infer<typeof assignMemberRoleRequestSchema>;

/**
 * Inviting a member, on the storefront and in the Admin UI
 * (`POST …/mine/invitations`, `POST /api/v1/admin/organizations/:id/members/invite`)
 * — replaces the legacy `inviteMemberRequestSchema` (`{ email, role? }`). An
 * absent `roleId` is the Organization's *Member* role, resolved server-side.
 */
export const inviteMemberToRoleRequestSchema = z
  .object({ email: z.string().email(), roleId: uuidSchema.optional() })
  .strict();
export type InviteMemberToRoleRequest = z.infer<typeof inviteMemberToRoleRequestSchema>;

/**
 * Platform admin — `POST /api/v1/admin/organizations/:id/members` (direct
 * create). Replaces the legacy `adminDirectMemberRequestSchema`'s `role?`.
 */
export const adminDirectMemberToRoleRequestSchema = z
  .object({
    email: z.string().email(),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    password: z.string().min(12).max(256),
    roleId: uuidSchema.optional(),
  })
  .strict();
export type AdminDirectMemberToRoleRequest = z.infer<typeof adminDirectMemberToRoleRequestSchema>;

/**
 * Platform admin — `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role`.
 * Replaces the legacy `adminPatchMemberRoleRequestSchema` (`{ role, expectedUpdatedAt? }`).
 */
export const adminAssignMemberRoleRequestSchema = z
  .object({ roleId: uuidSchema, expectedUpdatedAt: z.string().optional() })
  .strict();
export type AdminAssignMemberRoleRequest = z.infer<typeof adminAssignMemberRoleRequestSchema>;

// --- The permission port --------------------------------------------------------

/** Who is being judged. `organizationRoleId` is the actor's when known (R-15). */
export interface OrganizationPermissionSubject {
  readonly customerAccountId: string;
  readonly organizationId: string;
  readonly organizationRoleId?: string | null;
}

export interface OrganizationEffectivePermissions {
  readonly role: { readonly id: string; readonly kind: OrganizationRoleKind };
  /** Sorted; present codes only (FR-007). */
  readonly permissions: readonly string[];
}

/**
 * Container name: `organizationPermissionPort`. Owner: `organizations`.
 *
 * Reached with `lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort')`
 * and never captured into a singleton. A subject whose role cannot be found in
 * its Organization fails **closed**: `can` and `isAdministrator` answer `false`,
 * `effective` an empty set. A code outside the vocabulary is a programming
 * error: `can` answers `false`, `assert` throws `500 INTERNAL` (the permission
 * inventory refuses such a call statically as well).
 */
export interface OrganizationPermissionPort {
  can(subject: OrganizationPermissionSubject, code: string): Promise<boolean>;
  /**
   * Throws `403 ORGANIZATION_PERMISSION_REQUIRED` with
   * `details: { permission, permissionLabel }`. `language` selects the label.
   */
  assert(
    subject: OrganizationPermissionSubject,
    code: string,
    options?: { language?: string },
  ): Promise<void>;
  isAdministrator(subject: OrganizationPermissionSubject): Promise<boolean>;
  effective(subject: OrganizationPermissionSubject): Promise<OrganizationEffectivePermissions>;
  /** Role ids of `organizationId` whose effective set holds `code` — administrator included. */
  rolesHolding(organizationId: string, code: string): Promise<readonly string[]>;
}

/** Container name: `organizationRoleReadPort`. Owner: `organizations`. */
export interface OrganizationRoleReadPort {
  /**
   * The id of the Organization's predefined role of `kind`, read through the
   * role cache from **committed** rows. A caller that has just created the
   * Organization in its own open transaction takes the id from the provisioning
   * answer instead (research R-34).
   */
  predefinedRoleId(organizationId: string, kind: 'administrator' | 'member'): Promise<string>;

  /**
   * The role `roleId` **of `organizationId`**, or `null` when that Organization
   * has no such role — another Organization's role id included (FR-005). Read
   * through the role cache from committed rows, like {@link predefinedRoleId}.
   * `name` is `null` for the two predefined roles, whose label is translated
   * (FR-003). Added for `customer_account.change_role` (WP-02b), which assigns a
   * role the caller named and must refuse one it cannot see.
   */
  findRole(organizationId: string, roleId: string): Promise<OrganizationRoleSummary | null>;

  /**
   * The role `roleId` **of `organizationId`** as every response names it
   * (FR-008, FR-056): a predefined role's label translated into `language`
   * (English when absent or unsupported), a custom role's own name verbatim;
   * `null` when that Organization has no such role (FR-005). Read through the
   * role cache like {@link findRole}. Added for the session views and the
   * operator's impersonation answer (WP-03), which other modules serve.
   */
  roleRef(organizationId: string, roleId: string, language?: string): Promise<OrganizationRoleRef | null>;
}

/** A role as {@link OrganizationRoleReadPort.findRole} answers it. */
export interface OrganizationRoleSummary {
  readonly id: string;
  readonly kind: OrganizationRoleKind;
  /** The custom role's name; `null` for `administrator` and `member`. */
  readonly name: string | null;
}

// --- The route guard -------------------------------------------------------------

/**
 * The refusal {@link organizationPermissionPreHandler} raises for a request
 * that carries no customer: `401 UNAUTHORIZED`, the answer `requireCustomer`
 * gives.
 *
 * It is a class of this package rather than the platform's `HttpError`
 * because the guard is a plain function here and this package depends on
 * nothing but `zod` — it cannot construct the platform's error. The platform's
 * error envelope renders it exactly as it renders `requireCustomer`'s refusal.
 * The guard is declared **after** `requireCustomer`, so in a correctly
 * declared route this is a second line and never the first.
 */
export class CustomerSessionRequiredError extends Error {
  readonly statusCode = 401;
  readonly code = ERROR_CODES.UNAUTHORIZED;

  constructor() {
    super('Customer session required.');
    this.name = 'CustomerSessionRequiredError';
  }
}

/** What {@link organizationPermissionPreHandler} reads off a request. */
export interface OrganizationPermissionGuardRequest {
  readonly actor: Actor;
  /** The platform's `request.responseLanguage()`, when the error envelope installed it. */
  readonly responseLanguage?: () => Promise<string>;
}

export interface OrganizationPermissionGuardOptions {
  /**
   * `'refuse'` (the default): a non-customer actor is refused with
   * {@link CustomerSessionRequiredError}. `'pass'`: a non-customer actor — an
   * anonymous visitor with a guest basket — passes **unjudged** to the route's
   * own handling. Only for routes that admit a guest today (owner ruling PR-4,
   * research R-35); every other guard stays fail-closed.
   */
  readonly guests?: 'refuse' | 'pass';
}

/**
 * The route guard every gating module declares (research R-20, R-35):
 *
 * ```ts
 * preHandler: [requireCustomer, organizationPermissionPreHandler(() => permissions, 'carts.create')]
 * ```
 *
 * A plain function — no Fastify import — so it lives beside the port it calls.
 * `getPort` is a thunk resolved on **every** request, never at registration:
 * a captured port is the third fail-open shape of `module-composition.md` item
 * 4a. A customer actor — impersonation included — is judged by `assert` with
 * the subject built from the actor and the response language; the port's
 * refusal propagates unchanged. Composite actions are two guards, never a
 * combined code; the refusal names the first missing one.
 */
export function organizationPermissionPreHandler(
  getPort: () => OrganizationPermissionPort,
  code: string,
  options: OrganizationPermissionGuardOptions = {},
): (request: OrganizationPermissionGuardRequest) => Promise<void> {
  const guests = options.guests ?? 'refuse';
  return async (request) => {
    const actor = request.actor;
    if (actor.kind !== 'customer') {
      if (guests === 'pass') return;
      throw new CustomerSessionRequiredError();
    }
    const subject: OrganizationPermissionSubject = {
      customerAccountId: actor.customerAccountId,
      // `''` is what the auth hook stamps when no resolver is wired; the port
      // finds no role in it and fails closed.
      organizationId: actor.organizationId ?? '',
      organizationRoleId: actor.organizationRoleId ?? null,
    };
    const language = request.responseLanguage ? await request.responseLanguage() : undefined;
    await getPort().assert(subject, code, language === undefined ? {} : { language });
  };
}
