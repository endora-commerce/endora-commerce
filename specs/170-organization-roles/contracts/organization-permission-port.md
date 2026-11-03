# Contract: `organizationPermissionPort`, the route guard and the refusal

**Normative for**: WP-01 (types), WP-02a (implementation), every consumer in Wave 2. Decisions:
research R-7, R-15, R-16, R-20, R-25, R-34, R-35.

## 1. Types — `packages/contracts/src/organization-roles.ts` (new)

```ts
export const organizationRoleKindSchema = z.enum(['administrator', 'member', 'custom']);
export type OrganizationRoleKind = z.infer<typeof organizationRoleKindSchema>;

/** The role as every response shows it (FR-008, FR-056, FR-073). */
export const organizationRoleRefSchema = z
  .object({ id: uuidSchema, name: z.string(), kind: organizationRoleKindSchema })
  .strict();

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

/** Container name `organizationPermissionPort`. Owner: `organizations`. */
export interface OrganizationPermissionPort {
  can(subject: OrganizationPermissionSubject, code: string): Promise<boolean>;
  /** Throws 403 ORGANIZATION_PERMISSION_REQUIRED (§3). `language` selects `permissionLabel`. */
  assert(subject: OrganizationPermissionSubject, code: string, options?: { language?: string }): Promise<void>;
  isAdministrator(subject: OrganizationPermissionSubject): Promise<boolean>;
  effective(subject: OrganizationPermissionSubject): Promise<OrganizationEffectivePermissions>;
  /** Role ids of `organizationId` whose effective set holds `code` — administrator included. */
  rolesHolding(organizationId: string, code: string): Promise<readonly string[]>;
}

/** Container name `organizationRoleReadPort`. Owner: `organizations`; registered beside the port above (WP-02a). */
export interface OrganizationRoleReadPort {
  /** The id of the Organization's predefined role of `kind`; read through the role cache (R-16). */
  predefinedRoleId(organizationId: string, kind: 'administrator' | 'member'): Promise<string>;
}

/** The route guard (R-20, R-35). Plain function: no Fastify import, port resolved per request. */
export function organizationPermissionPreHandler(
  getPort: () => OrganizationPermissionPort,
  code: string,
  options?: { guests?: 'refuse' | 'pass' },   // default 'refuse'
): (request: { actor: Actor; responseLanguage?: () => Promise<string> }) => Promise<void>;
```

With `guests: 'refuse'` (the default) `organizationPermissionPreHandler` throws the platform's `401`
when `request.actor.kind !== 'customer'` (the guard is declared after `requireCustomer`, so this is a
second line, not the first). With `guests: 'pass'` — only on routes that admit a guest today
(owner ruling PR-4, `storefront-api.md` §5) — a non-customer actor passes **unjudged** to the
route's own handling. In both modes a customer actor (impersonation included) is judged: the guard
builds the subject from the actor and calls `assert`.

`organizationRoleReadPort.predefinedRoleId` reads committed rows. A caller that has just created the
Organization in its own open transaction — self-registration and federated sign-in — takes the
*Administrator* id from the provisioning answer instead (`PersonalOrganizationProvisionApi.provisionFor`
→ `administratorRoleId`, read on the caller's `EntityManager`; research R-34).

`ActorCustomer` (`packages/contracts/src/actor.ts`) gains `organizationRoleId?: string | null`; the
auth hook fills it (R-15). `CustomerSessionAccount` (the `customerOrgResolver` answer) gains
`organizationRoleId: string`.

## 2. Semantics

| Call | Answer |
| --- | --- |
| subject's role cannot be found in its Organization | **fail closed**: `can` → `false`, `isAdministrator` → `false`, `effective` → `{ permissions: [] }`; logged at `error` with the account and Organization ids |
| role `kind === 'administrator'` | every **present** code (`can` true for any present code, false for an absent or unknown one) |
| role `kind === 'member'` | `code ∈ permissions ∪ (vocabularyMemberDefaults ∖ member_defaults_offered)` **and** `code` is present (R-17) |
| role `kind === 'custom'` | `code ∈ role.permissions` **and** `code` is present |
| `code` not in the vocabulary | `can` → `false`; `assert` throws `500 INTERNAL` — a programming error the inventory (§4 of the manifest contract) also refuses statically |

Presence is `effectiveState.isPresent(<declaring module>)`, read at call time from the registry cache,
so a module flip needs no cache invalidation (US 8, SC-007). The port is registered with
`ctx.di.providePort`; `organizations` is non-deactivatable, so its gate is never closed in practice,
and `check:port-catches` classifies the sites `OWNER LOCKED`.

**Roll-up never adds a permission** (spec *Edge Cases*): the subject is always the member's own
account and role; roll-up widens only the tenant filter's reach, as today.

## 3. The refusal

```json
HTTP/1.1 403
{ "error": {
    "code": "ORGANIZATION_PERMISSION_REQUIRED",
    "message": "Your role does not allow this: “Create quote requests”.",
    "details": { "permission": "quote_requests.create", "permissionLabel": "Create quote requests" },
    "requestId": "…" } }
```

Declared in `organizations`' manifest `errorCodes`, translated in its `i18n/{en,pl}.json` under the
error-translation key the D-121 machinery uses; the `{permissionLabel}` placeholder is filled from
`details` by the envelope. Distinct from `401 UNAUTHORIZED`, `503 MODULE_DISABLED` (the module's
route seam answers first) and `404` (FR-055).

New role-management refusals, also `organizations`':

| Code | Status | When |
| --- | --- | --- |
| `ORGANIZATION_ROLE_NAME_TAKEN` | 409 | FR-004 / R-29 |
| `ORGANIZATION_ROLE_STALE` | 409 | `expectedVersion` mismatch |
| `ORGANIZATION_ROLE_LIMIT_REACHED` | 422 | 51st custom role |
| `ORGANIZATION_ROLE_PROTECTED` | 409 | edit/rename/delete of `administrator`, rename/delete of `member` (US 6.3) |
| `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED` | 422 | delete of a held role without `replacementRoleId`, or a replacement equal to the deleted role |
| `ORGANIZATION_PERMISSION_UNKNOWN` | 422 | a submitted code outside the vocabulary |

`CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN`, `CANNOT_REVOKE_LAST_ADMIN_INVITE` and
`ORG_OWNER_DEPLETION` keep their codes and statuses; their predicate becomes "holds the
administrator-kind role".

## 4. The cache (R-16)

`OrganizationRoleCache` — `packages/modules/organizations/src/backend/services/organization-role-cache.ts`.

| Property | Value |
| --- | --- |
| Key | `organizationId` |
| Value | `Map<roleId, { kind, permissions: ReadonlySet<string>, memberDefaultsOffered: ReadonlySet<string> }>` |
| Local layer | LRU, cap 4096, entries older than **30 000 ms** ignored; generation counter against racing fills |
| Source | one `select id, kind, permissions, member_defaults_offered from organization_roles where organization_id = $1` under `withSystemScope` |
| Drop | every `organization_role.*` Command, **after commit**: local drop, then `PUBLISH b2b:organization-roles:changed {"organizationId": "…"}`; assignment Commands drop nothing — assignments are not cached (R-15, `commands-audit-events.md` §5) |
| Subscribe | `onBoot` in `organizations`, on the cradle's `redisSubscriber`, dropping the local entry |
| Redis down | publish failure is logged and swallowed; the 30 s bound holds. Never falls open: a miss reads PostgreSQL |

Tests follow `custom-field-definitions-cache.test.ts` and `sales-channel-access-cache.test.ts`:
writer-process immediacy, cross-process drop, lost announcement bounded by 30 s, racing fill not
stored, Redis unreachable degrades to source reads.

## 5. Consumer checklist

1. `lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort')` — string literal,
   never captured into a singleton.
2. No manifest change: every consumer already lists `organizations` in `dependencies`.
3. Route gate as `preHandler: [requireCustomer, organizationPermissionPreHandler(() => permissions,
   '<code>')]`, never a check inside the handler.
4. Service-level checks (`can` for a CTA, `rolesHolding` for recipients) inside the service; never
   wrap a port call in a bare `catch` (`check:port-catches`).
5. Remove the old `role === 'organization_admin'` / `isOrgAdmin` reading **in the same change**; the
   inventory command (research R-14) over the WP's files reports zero.
