# Contract: CRM admin surfaces — routes, navigation, palette, permissions, zones, off-state

**Feature**: `specs/143-crm-sales-opportunities/` · normative for
`packages/modules/crm/src/manifest.ts`, `packages/modules/crm/src/admin/index.ts` and the
off-state test. Rules it applies: `specs/conventions/module-admin-surfaces.md`,
`specs/conventions/module-activation.md`, `specs/conventions/module-i18n.md`.

## 1. Admin routes (`contributions.routes`)

Every component is a dynamic-import factory; the entry file exports data only.

| Path | Page | `requiredPermission` | Story |
| --- | --- | --- | --- |
| `/crm/opportunities` (index) | `OpportunitiesList` | `crm:read` | US1 |
| `/crm/opportunities/new` | `OpportunityCreatePage` | `crm:write` | US1 |
| `/crm/opportunities/:id` | `OpportunityDetail` | `crm:read` | US1 |
| `/crm/workflow` | `WorkflowConfigPage` | `crm:configure` | US1 |
| `/crm/board` | `OpportunityBoardPage` (on `KanbanBoard` from `@endora-commerce/admin-kit/components`) | `crm:read` | US7 |
| `/crm/tags` | `TagsPage` | `crm:configure` | US6 |
| `/crm/analytics` | `AnalyticsPage` | `crm:analytics` | US13 |

`OpportunityDetail` is a tabbed page. Tabs are data in
`src/admin/pages/opportunity-detail/tabs.ts` — one line per tab, each a lazy component — so a
story adds a tab by adding one file and one line: **Overview** (US1), **Notes** and
**Messages** (US4), **Attachments** (US5), **Change history** (US11). Links, the status
control and unresolved propagation outcomes are on *Overview*.

A route and its sidebar entry are added by the story that ships the page, never earlier: a
palette or nav entry pointing at a route that does not exist is a defect (Principle XVI).

## 2. Sidebar (`contributions.nav`) — the "CRM" group

Owner ruling, 2026-10-05: a top-level group of its own, **not** under *Sales*.

| `to` | `labelKey` | `icon` | `section` | `weight` | `requiredPermission` | Story |
| --- | --- | --- | --- | --- | --- | --- |
| `/crm/opportunities` | `nav.opportunities.label` | `CircleDollarSign` | `crm` | 100 | `crm:read` | US1 |
| `/crm/board` | `nav.board.label` | `PanelLeft` | `crm` | 200 | `crm:read` | US7 |
| `/crm/analytics` | `nav.analytics.label` | `LineChart` | `crm` | 300 | `crm:analytics` | US13 |
| `/crm/tags` | `nav.tags.label` | `Tag` | `crm` | 400 | `crm:configure` | US6 |
| `/crm/workflow` | `nav.workflow.label` | `ListChecks` | `crm` | 500 | `crm:configure` | US1 |

The section `crm` and its heading `appShell.section.crm` are the **host's**
(`foreign-module-changes.md` A3–A5). Every icon is already a member of `KnownIconNameSchema`,
so `admin/src/lib/admin-actions/icon-map.ts` is not edited.

Label keys are relative to the module namespace and live in
`packages/modules/crm/i18n/{en,pl}.json`: Opportunities / Szanse sprzedażowe, Board / Tablica,
Analytics / Analityka, Tags / Etykiety, Workflow / Statusy i przepływ.

## 3. Command palette (manifest `actions`)

| `id` | `targetRoute` | `requiredPermission` | `icon` | `weight` | Story |
| --- | --- | --- | --- | --- | --- |
| `open-opportunities` | `/crm/opportunities` | `crm:read` | `CircleDollarSign` | 320 | US1 |
| `new-opportunity` | `/crm/opportunities/new` | `crm:write` | `PlusCircle` | 321 | US1 |
| `open-opportunity-board` | `/crm/board` | `crm:read` | `PanelLeft` | 322 | US7 |
| `open-crm-analytics` | `/crm/analytics` | `crm:analytics` | `LineChart` | 323 | US13 |

Keys `actions.<camelId>.label` / `.description` in both bundles; keywords in both languages
(`crm`, `opportunity`, `pipeline`, `szansa`, `sprzedaż`, `lejek`). Four entries, deliberately:
the landing surface, the two things a Sales Rep does daily, and — added with User Story 13 —
analytics, the one screen that opens on a code of its own: for a manager holding
`crm:analytics` the palette would otherwise offer nothing that code is for (research N-F2).
`check:action-route-permissions` holds each code to the one enforced on its route.

## 4. Permissions (manifest `permissions`)

| `code` | `label` (English default) | `requires` |
| --- | --- | --- |
| `crm:read` | View sales opportunities | `orders:read` |
| `crm:write` | Create and work sales opportunities | `crm:read` |
| `crm:configure` | Configure the CRM workflow and tags | `crm:read` |
| `crm:analytics` | View CRM analytics | `crm:read` |

- `module: 'crm'` on each, so the role editor groups them.
- Labels: `adminRoles.permission.<code>` in the **module's own** bundles, both languages.
- `requires` is advisory. `orders:read` is named because the Opportunity screen fetches linked
  Orders' details and searches Orders through `orders`' own endpoints; the exact code those
  endpoints enforce is read from `packages/modules/orders/src/backend/routes.ts` before this
  line is written.
- Proof: `backend/test/contract/admin_users/permission-inventory.test.ts` — both directions
  plus labels. A code is declared in the same change as its first `requireAdmin('…')`, never
  before (`grantable ⇒ enforced` fails otherwise) — so `crm:analytics` is declared by US13 and
  not by the Foundational phase.

## 5. Zone contribution (US14)

One contribution into a screen `organizations` owns:

| `zone` | Component | `weight` | `requiredPermission` |
| --- | --- | --- | --- |
| `organization.detail.after` | `zones/OrganizationOpportunities` | 600 | `crm:read` |

Props are `OrganizationDetailZoneProps` (`{ organizationId }`). It renders that
Organization's open Opportunities and a "New opportunity" link to
`/crm/opportunities/new?organizationId=<id>`. The zone exists and is rendered today (`carts`,
`price_lists`, `quick_order` and `sales_channels` contribute to it), so nothing changes in
`organizations`.

Two more contributions since the second ruling of 2026-10-05 (US17), into two **new** zones
whose members and mounts are host changes (`foreign-module-changes.md` §J):

| `zone` | Component | `weight` | `requiredPermission` | Props |
| --- | --- | --- | --- | --- |
| `order.detail.after` | `zones/OrderOpportunity` | 600 | `crm:read` | `OrderDetailZoneProps` `{ orderId }` |
| `quote_request.detail.after` | `zones/QuoteRequestOpportunity` | 600 | `crm:read` | `QuoteRequestDetailZoneProps` `{ quoteRequestId }` |

Both render `components/LinkedOpportunityPanel`: the linked Opportunity's number, title,
status badge, assignee and value with a link to it; for an unlinked document, "Link to an
opportunity" and "Create opportunity" for a holder of `crm:write`. The Quote Request
contribution exists only once User Story 8 has made Quote Requests linkable.

## 6. Off-state contract (Principle XVII)

Module state → what an operator and an API client observe.

| Surface | `crm` on | `crm` deactivated (platform-available) | `crm` platform-disabled |
| --- | --- | --- | --- |
| `/api/v1/admin/crm/**` | answers | 503 `MODULE_DISABLED` | 503 `MODULE_DISABLED` |
| sidebar "CRM" group | rendered for a holder of any CRM code | **not rendered** (no visible item ⇒ no heading) | not rendered |
| palette actions | listed | absent | absent |
| `organization.detail.after` panel | rendered | absent | absent |
| `order.detail.after`, `quote_request.detail.after` panels | rendered | absent — the host screens are identical to those without the module | absent |
| `opportunity` on the custom-fields screen | offered | **not offered**; its definitions cannot be changed | not offered |
| CRM events on the webhooks screen | offered | **not offered**; nothing is delivered | not offered |
| permission codes on `/admin-roles` | grantable | not grantable (vocabulary only) | not grantable |
| Settings group "CRM" | editable | **not editable** | not editable |
| `/platform/modules` row | switch on | switch off, actionable | blocked with the reason |
| subscribers (`order.*`, `rfq.*`) | run | do not run | do not run |
| `crm-value-recalculation` worker | consumes | paused; jobs left waiting | paused |
| `opportunityReadPort`, `opportunityTransitionPort` | answer | throw `ModuleDisabledError` | same |
| guards contributed *by other modules* | run | n/a — no transition can happen | n/a |
| data | — | **untouched**; restored on reactivation | untouched |

The off-state test, `backend/test/integration/crm/off-state.test.ts`, calls
**`expectModuleAbsent(h, 'crm', { routes, adminPresence, settingWrite })`** — the call
`check:off-state-coverage` keys on — and additionally proves, with a positive control first in
each case:

1. `order.status_changed.v1` for a linked Order moves nothing while deactivated, and does
   after reactivation (US2);
2. `order.created.v1` creates nothing while deactivated with the automatic-creation setting
   on, and nothing retroactively afterwards (US9);
3. `POST /api/v1/admin/orders` with an `origin` succeeds and produces the same Order whether
   CRM is on or off (US10 — the "orders behave identically" half of FR-070).
4. definitions and stored custom values survive an off → on cycle (US15), and the document
   route of US17 is 503 while off.

The off-state halves that belong to another module's surface are proven in that module's
tests: `backend/test/integration/custom_fields/entity-owner-presence.test.ts`,
`backend/test/integration/webhooks/contributed-events.test.ts`, and the two host-screen tests
`admin/test/modules/orders/OrderDetail.after-zone.test.tsx` /
`admin/test/modules/quote_requests/RfqDetail.after-zone.test.tsx`.

The story that adds a subscriber adds its off-state case in the same change.

## 7. i18n key namespaces (flat JSON, both bundles)

| Prefix | Content |
| --- | --- |
| `nav.*`, `actions.*` | sidebar and palette |
| `adminRoles.permission.*` | permission labels |
| `errors.CRM_*` | error sentences |
| `auditLog.crm.*` | audit action labels for the history tab and the audit viewer |
| `opportunity.*`, `workflow.*`, `links.*`, `propagation.*` | US1 screens |
| `assignment.*`, `comments.*`, `attachments.*`, `tags.*`, `board.*`, `value.*`, `history.*`, `references.*`, `analytics.*` | one prefix per later story |

A story writes only under its own prefix, which is what keeps two stories' edits to the same
two JSON files from conflicting beyond line adjacency.
Proofs: `backend/test/unit/_i18n/registered-bundles-shape.test.ts`,
`pnpm --filter backend run check:bundle-pairing`, `pnpm --filter backend run i18n:hardcoded`.
