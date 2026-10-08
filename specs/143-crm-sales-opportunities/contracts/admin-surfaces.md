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

**Four of the seven routes, and that is the rule, not a shortfall.** `/crm/tags` and
`/crm/workflow` are reached from the sidebar only, and `/crm/opportunities/:id` is not a
destination a palette can name. Principle XVI asks a module for its primary landing surface
plus the few highest-value operator actions and says "a module MUST NOT enumerate every route
it owns"; the quality gate lists an exhaustive route dump as a violation. Tags and the
workflow are configured rarely, by the few who hold `crm:configure`. `spec.md` FR-071 and
SC-008 first asked for "every CRM screen … from the command palette" and were amended on
2026-10-06 to this (`spec.md` § Clarifications, A-2). Adding either screen later is one
manifest `actions` entry and four bundle keys — a judgement under the same principle, not a
contract change.

## 4. Permissions (manifest `permissions`)

| `code` | `label` (English default) | `requires` |
| --- | --- | --- |
| `crm:read` | View sales opportunities | `orders:read`, `custom_fields:read` |
| `crm:write` | Create and work sales opportunities | `crm:read` |
| `crm:configure` | Configure the CRM workflow and tags | `crm:read` |
| `crm:analytics` | View CRM analytics | `crm:read` |

- `module: 'crm'` on each, so the role editor groups them.
- Labels: `adminRoles.permission.<code>` in the **module's own** bundles, both languages.
- `requires` is advisory. `orders:read` is named because the Opportunity screen fetches linked
  Orders' details and searches Orders through `orders`' own endpoints; the exact code those
  endpoints enforce is read from `packages/modules/orders/src/backend/routes.ts` before this
  line is written.
- `custom_fields:read` is named as well (as built — research N-G4): the operator-defined
  fields of an Opportunity are rendered from `custom_fields`' own definitions endpoint, which
  that code gates, and it grants nothing beyond reading definitions. A holder of `crm:read`
  without it sees no custom-fields section and no refused request.
- **Codes of other modules that CRM asks for and does not name in `requires`**, each
  deliberately: `rfqs:handle` (to link or see a Quote Request — asked by the services after
  presence, never by a route gate, because its owner can be switched off; research N-R13),
  `catalog:read` (a Product's name in a reference), `assets.read` (attaching a library file
  by id — a Sales Rep needs it for nothing the screens do; research N-I5), and
  `orders:write` / `rfqs:handle` on the two "create from an Opportunity" buttons. A role
  without one of them sees the corresponding record as unavailable, or no button, and is
  told why.
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
opportunity" and "Create opportunity" for a holder of `crm:write`. The panel's strings stay
under `orderPanel.*`; the three sentences that name the document have a Quote Request
variant each, chosen by kind in the component (research N-I6).

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
| `customFields.*` | the custom-fields section of the create form and the Overview (US15) |
| `organizationPanel.*` | the panel on the Organization screen (US14, §5) |
| `orderPanel.*` | the linked-Opportunity panel on the Order and Quote Request screens (US17, §5) |
| `origin.*` | the "create from an Opportunity" buttons and their return messages (US10) |

A story writes only under its own prefix, which is what keeps two stories' edits to the same
two JSON files from conflicting beyond line adjacency.
Proofs: `backend/test/unit/_i18n/registered-bundles-shape.test.ts`,
`pnpm --filter backend run check:bundle-pairing`, `pnpm --filter backend run i18n:hardcoded`.

## 8. The text composer's shortcuts (US18)

The field of a description, a note and a message (`ReferenceField`) turns what is typed
into the token of `admin-api.md` §9, and **shows every token as the name it stands for while
the text is written or edited** (owner ruling, 2026-10-07; research N-M11). Normative for
`src/admin/lib/mention-trigger.ts` and `src/admin/lib/reference-editor-dom.ts`:

| Typed | Opens a search of | Offered when |
| --- | --- | --- |
| `@` | people — `GET /lookups/mentionable`, with the Opportunity's Organization when there is one | the session holds `crm:write` |
| `@@` | the Organization's Orders — `orders`' own list | the session holds `orders:read` and an Organization is chosen |
| `@@@` | Products — `catalog`'s own list | the session holds `catalog:read` |

- A run opens only at the start of the text or after white space, holds one to three `@`s,
  and is followed by a search of at most 40 characters on the same line that does not begin
  with a space. So an e-mail address, `@ `, and `@@@@` open nothing.
- A run that is not offered opens nothing and asks no endpoint; the characters stay as typed.
- The list opens **at the `@`**: under its line, above it when the window has no room below,
  never past the window's edge nor the field's. A run's first search waits 200 ms, so `@@`
  and `@@@` typed at speed open one list and ask one endpoint. Arrow keys move the active
  option (kept in view), Enter or Tab replaces the run — the `@`s and the search — with the
  token and one space, Escape closes the list for that run and leaves the text; a search
  with a space in it that matches nothing closes it too, and so does the field losing the
  focus. A key pressed while an input method is composing is left to it.
- The field is a `contenteditable` element with `role="textbox"`, `aria-multiline="true"`
  and `aria-labelledby` naming the `<label for>` of its id; while options are listed it is
  `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and
  `aria-activedescendant` naming the active `role="option"` (and without `aria-multiline`
  and `aria-placeholder`, which a combobox may not carry). Focus never leaves the field.
- **What the field holds** is text nodes, `<br>` for a line break, and one non-editable
  element per token it can name, carrying the token. What it sends is that content read back
  as the stored text. A token it cannot name is drawn as its characters and read back as the
  same characters; a target the reader may not see is drawn as "unavailable" and its token is
  read back unchanged. Nothing else can enter it: a paste is its plain text, Enter is `\n`,
  formatting commands and drops are refused. A chip is one unit to Backspace and Delete. The
  length limit counts the stored text. Undo and redo are the field's own.
- The same three searches are reachable by a button each, and the line under the field names
  the shortcuts that are offered (`references.shortcuts`, `references.shortcut.*`).

## 9. The board card's configuration (US19)

**No new route, no new sidebar row, no new palette action.** What a board card shows is
configured in a section of `/crm/workflow` — *Board card*, anchored `#board-card`, after
*Statuses that count towards a computed value* — because that screen is where CRM is
configured and the sidebar's `crm:configure` rows already lead to it. The board links there
(**Card fields**, `/crm/workflow#board-card`) for a session holding `crm:configure`, so the
choice is one click from where its effect is seen; a session without the code is shown no
link. The palette is unchanged: `targetRoute` takes no fragment, and the contract of §3 —
"the workflow configuration is reached from the sidebar by the few who configure it" —
covers this section with the rest of that screen.

Normative for `src/admin/components/BoardCardFieldsEditor.tsx`,
`src/admin/components/BoardCardFields.tsx`, `src/admin/components/BoardFieldFilters.tsx` and
`src/admin/lib/board-fields.ts`:

- **The section**: two lists — *Shown on the card*, ordered, each row with *Move up*, *Move
  down* and *Remove* buttons (no drag: SC 2.5.7 is met by the only path there is), and *Add a
  field*, grouped into *Opportunity fields* and *Custom fields*. The count "n of 6" is always
  visible; at six every *Add* is disabled and a sentence says why. Nothing is stored until
  *Save*; the confirmation is a `role="status"` line, a refusal the server's own sentence.
- **The card**: the title, then the chosen fields in order. The number, the Organization, the
  value, the assignee and the tags keep the form they had (the number and the Organization on
  one line when they are neighbours), so the default card is unchanged. Every other field is
  "Label: value" on one line, cut after two lines with the whole text in `title`, and **left
  out when the Opportunity has no value for it** — a count of zero included.
- **The filters**: after the list's shared fields, one grid cell per shown field that has a
  filter of its own (`contracts/admin-api.md` §12c), in the card's order: a search box
  (text), a pair of number boxes (number, amount), a pair of date boxes, a three-way select
  (yes / no), the kit's `MultiSelect` (options). A pair is a `fieldset` whose `legend` is the
  field's name, each box named "<field>: lowest / highest / from / to". Text and number boxes
  commit 300 ms after typing pauses. The contact-person filter is `ContactLookup`, disabled
  until an Organization is chosen, and shown only to a session holding `crm:write` — the code
  `GET /lookups/contacts` enforces.
- **The address**: the board's filters are query parameters of `/crm/board` — `q`,
  `organizationId`, `assignee` (`me` | `unassigned` | an id | `person` while nobody is chosen
  yet, which filters nothing), `tagId` (repeated),
  `salesChannelId`, `createdFrom`, `createdTo`, and `f.<reference>.<operator>` per field
  filter (`in` repeated). They are written with `replace`, so the board is one history entry.
  A parameter that is not of its shape is left out rather than sent. *Clear filters* removes
  them all, and is shown only while something is filtered.

i18n namespaces added: `board.field.*`, `board.filter.*`, `board.card.field`,
`board.configureCard`, `boardCard.*`.
