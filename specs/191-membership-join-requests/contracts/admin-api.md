# Contract: Admin API and Admin UI surfaces

Routes in `packages/modules/organizations/src/backend/routes.admin-join-requests.ts` (new),
mounted through `ctx.routes`, each gate a route `preHandler` (`requireAdmin('<code>')`). Reach:
the admin tenant scope (`services/admin-tenant-scope.ts`, `organization-reach.ts`) over the
request's target; out of reach answers `404`, indistinguishable from a missing id (XI).
Checklists: `specs/conventions/module-admin-surfaces.md`.

## 1. Permissions (`organizations' manifest.ts` `permissions`)

| Code | Label | `requires` |
| --- | --- | --- |
| `organizations:read-join-requests` | View organization join requests | `customers:read` |
| `organizations:decide-join-requests` | Approve and reject organization join requests | `organizations:read-join-requests` |

Labels `adminRoles.permission.<code>` in `packages/modules/organizations/i18n/{en,pl}.json`.

## 2. Routes

| Method and path | Code | Notes |
| --- | --- | --- |
| `GET /api/v1/admin/organization-join-requests?state=&routing=&organizationId=&page=&pageSize=&sort=` | `organizations:read-join-requests` | default `state=pending`, `sort=createdAt` asc |
| `GET /api/v1/admin/organization-join-requests/:id` | `organizations:read-join-requests` | the full admin view |
| `POST /api/v1/admin/organization-join-requests/:id/approve` | `organizations:decide-join-requests` | `{ organizationRoleId?: uuid, expectedVersion: int }`; any routing (FR-073) |
| `POST /api/v1/admin/organization-join-requests/:id/reject` | `organizations:decide-join-requests` | `{ reason?: string ≤ 500, expectedVersion: int }` |
| `GET /api/v1/admin/organizations/:id` (existing) | unchanged | gains `pendingJoinRequestCount` when the caller holds the read code |

```ts
AdminJoinRequestView = CompanyJoinRequestView & {
  organization: { id; name; status };
  routing; operatorReason; origin; salesChannelId;
}
```

Personal data (registrant e-mail, names, note) is served to holders of the read code only, under
reach — the same exposure as the organization members list.

## 3. Admin UI (`packages/modules/organizations/src/admin/`)

| Item | Value |
| --- | --- |
| Route | `/organizations/join-requests` → `pages/OrganizationJoinRequestsPage.tsx` (list + detail drawer), `requiredPermission: 'organizations:read-join-requests'` |
| Sidebar | entry *Join requests* under the Organizations group, same `requiredPermission` |
| Palette action | `id: 'open-organization-join-requests'`, `labelKey: 'actions.openOrganizationJoinRequests.label'`, `descriptionKey: '….description'`, `icon: 'UserPlus'` (add to `KnownIconNameSchema` and `admin/src/lib/admin-actions/icon-map.ts` if absent), `targetRoute: '/organizations/join-requests'`, `requiredPermission: 'organizations:read-join-requests'`, `keywords: ['join', 'request', 'membership', 'registration', 'company', 'tax']`, `keywordsKey: 'actions.openOrganizationJoinRequests.keywords'` (pl: `dołączenie, prośba, wniosek, członkostwo, firma, NIP`), `weight: 170` |
| Enum labels | `src/admin/lib/labels.ts`: `defineEnumLabels<OrganizationJoinRequestState>`, routing, operator reason, decided-by kind |
| Organization detail | a *Join requests (n)* link in the members section header when `n > 0`, to the queue filtered by the Organization |
| Decide UI | approve dialog with a role select (the target's roles through the existing admin roles read, *Member* preselected); reject dialog with an optional reason. Both immediate actions — no zone-panel Save session (FR-083's "immediate actions stay immediate") |
| Settings | the four settings on the generic Settings screen under the `organizations` group; the existing palette action `open-registration-registry-lookup-settings` gains keywords `join`, `conflict` |
| Notifications | the operator in-app notification links to the queue filtered to the request |

Components come from `@endora-commerce/admin-kit` (DataTable, filters, Dialog, Select, Badge); no
new primitive (Principle IX). All copy in the module bundle, en + pl; enum values never rendered raw.

## 4. Tests

- `backend/test/contract/admin_users/permission-inventory.test.ts` — both codes enforced and grantable, labelled in both languages;
- `pnpm --filter backend run check:action-route-permissions` — the action's code is the one enforced on its route;
- `admin/test/unit/palette-coverage.test.ts` — the sidebar destination is covered;
- contract: an operator out of reach gets `404` on read and approve; a read-only operator gets `403` on approve;
- admin Vitest: queue renders enum labels in pl; approve dialog preselects *Member*.
