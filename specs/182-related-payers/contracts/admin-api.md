# Contract: Admin API and admin surfaces

Routes in `packages/modules/related_payers/src/backend/routes.admin.ts`, gated by
`requireAdmin('<code>')` as `preHandler` (`specs/conventions/module-admin-surfaces.md` item 3) and by
the module's presence. Organization reach of a scoped admin applies to the **buyer** Organization of
a link (the link's tenant) and, for payer-side lists, to the payer.

| Method and path | Code | Notes |
| --- | --- | --- |
| `GET /api/v1/admin/organizations/:id/related-payers` | `related_payers:read` | `{ asBuyer: Link[], asPayer: Link[] }` |
| `POST /api/v1/admin/organizations/:id/related-payers` | `related_payers:manage` | add existing Organization; body `{ payerOrganizationId, addressScope, validFrom?, validTo?, commercialTerms?, notifyPayerOnOrders? }` |
| `POST /api/v1/admin/organizations/:id/related-payers/new-organization` | `related_payers:manage`, manifest `requires: ['customers:manage']` (the code gating `POST /api/v1/admin/organizations`) | registry-prefilled create, approved, link active; optional `inviteFirstUser: { email, roleId? }` through the existing invitation service |
| `PATCH /api/v1/admin/related-payers/links/:linkId` | `related_payers:manage` | scope, window, terms, notify flag, `state: active \| inactive`; `If-Match` version |
| `POST /api/v1/admin/related-payers/links/:linkId/revoke` | `related_payers:manage` | |
| `GET /api/v1/admin/related-payers/requests` | `related_payers:read` | operator queue: filters by state, reason, channel; shows tax ID, contact e-mail, comment, candidates for an ambiguous tax ID |
| `POST /api/v1/admin/related-payers/requests/:id/approve` | `related_payers:manage` | |
| `POST /api/v1/admin/related-payers/requests/:id/reject` | `related_payers:manage` | `{ reason }`, shown to the sender |
| `POST /api/v1/admin/related-payers/requests/:id/assign-organization` | `related_payers:manage` | ambiguous tax ID: pick one candidate, then route per the captured approval mode |
| `POST /api/v1/admin/related-payers/requests/:id/create-organization` | `related_payers:manage` | as the card's create, link active |
| `POST /api/v1/admin/related-payers/requests/:id/send-invitation` | `related_payers:manage` | starts the `invite` path |

Changes in other modules' admin APIs: the orders list gains a `payerOrganizationId` filter and the
order detail a `payer` block (`orders:read`, unchanged gate); the invoice list's organization filter
and reach use `payerOrganizationId ?? organizationId` (research R-11).

## Admin surfaces

- **Organization card** — panel contributed to `organization.detail.after` (research R-7):
  two lists (*Pays for this organization*, *This organization pays for*), add / create / edit /
  activate / deactivate / revoke, `ImmediateBadge`, no save participant.
- **Queue screen** — `/related-payers/requests`, sidebar entry under Customers, landing route.
- **Settings group** — `related_payers` group on the settings screen, channel overrides.
- **Command palette** (`manifest.ts` `actions`): `open-payer-requests` → `/related-payers/requests`,
  `requiredPermission: related_payers:read`, icon from `KnownIconNameSchema` (a new name such as
  `HandCoins` needs the matching `icon-map.ts` entry in the same merge request).
- **Order detail** — a *Paid by* line in the billing card, rendered by `orders` from the order's own
  `payer` field (no zone needed: it is order data).
- **i18n** — `adminRoles.permission.related_payers:*`, palette keys, enum labels via
  `defineEnumLabels` in `src/admin/lib/labels.ts`, all in the module's own `i18n/{en,pl}.json`, flat.
