# Research: Contributed record tabs

Each decision follows the same pattern: decision, then rationale, then the alternatives rejected
and why. The research is grounded on `origin/master` at `cbaeb67a0`, plus PR #1758 (open at the
time of writing).

## R1 — One closed enum member per host: `opportunity.detail.tabs`

**Decision.** Add `opportunity.detail.tabs` to `AdminZoneNameSchema`
(`packages/contracts/src/admin-contributions.ts`), with props `OpportunityDetailZoneProps`
(reused, `{ opportunityId }`). Record-tab zones are listed in a closed, exported tuple
`RECORD_TAB_ZONE_NAMES = ['opportunity.detail.tabs'] as const`, and `RecordTabZoneName` is derived
from that tuple.

**Rationale.**

- The enum's stated invariant is that a place is a declared name, which can be compared to rendered
  names (two-way refusal).
- Z13 refuses a shared member across hosts.
- Z14 names a place with the host's word. The host calls the strip its "tabs" (`tabs.ts`,
  `opportunity.tabs.label`).
- The tuple is what lets the schema (R2) and the helper types (R3) tell a record-tab zone from a
  stack zone without a second registry.

**Rejected.**

- **`<host>.detail.tab:<id>`, parameterised.** The enum's doc refuses parameters: a computed name
  compares to nothing.
- **A generic `entity.detail.tabs`.** Refused by Z13, because one host's mount would cover another
  host's absence.
- **Reusing `opportunity.detail.sidebar` with a `placement: 'tab'` field.** #1758's design (§2,
  alternative B) already rejected open placement fields. A mistyped placement renders nowhere.

## R2 — Tab data is a field of the zone contribution, not a new contribution list

**Decision.** `AdminZoneContributionSchema` gains an optional `tab` object:
`{ id, labelKey, countLabelKey? }`. It also gets a `superRefine`: `tab` is required when `zone` is
in `RECORD_TAB_ZONE_NAMES` and forbidden otherwise.

The TypeScript `AdminZoneContribution` interface gains an optional
`count?: AdminCountFactory`. That is a dynamic-import factory resolving
`{ default: (props, signal) => Promise<number> }`. It is TS-only, for the same reason `component`
is TS-only: the file's own header says a function value carries nothing for Zod to validate.

**Rationale.**

- The contribution already carries everything else a tab needs: `zone`, `weight`,
  `requiredPermission`, `match` and `component`.
- The registry's `module` attribution (D-142) and the presence and permission filter
  (`selectZoneContributions`) then apply unchanged.
- `check:admin-zones`' existing walk already sees a contribution to the new zone. Its
  `contribution-to-unrendered-zone` refusal therefore covers record tabs for free.

**Rejected.**

- **A separate `AdminContributions.recordTabs` array.** It duplicates presence, permission,
  `match`, weight, the generated registry's plumbing (`AdminContributionsProvider`) and the check's
  contribution walk, which gives two answers to one question (D-100).
- **Putting the label in the panel chunk** (as `<RouteTabsZone>` does, where each contribution
  renders its own `RouteTabLink`). The record strip is drawn before any chunk loads, and its count
  must be known for the strip. `RecordTabs` takes items as data (`TabItem.label`, `count`,
  `countLabel`), not as children. A label that arrives with the chunk would shift the strip and
  would download every tab's chunk on every visit, against FR-013 of feature 091.

## R3 — Kit API: `recordTabComponent()` and `useRecordTabZone()`

**Decision.** Two kit additions.

- `@endora-commerce/admin-kit/contributions` gets
  `recordTabComponent(zone, load, { tab, count?, weight?, requiredPermission?, match? })`. Its
  zone parameter is constrained to `RecordTabZoneName`. Its component and count loader are typed
  against `AdminZoneProps<Z>`.
  - `zoneComponent()` narrows its zone parameter to `Exclude<AdminZoneName, RecordTabZoneName>`.
  - The result: a tab zone without tab data is a compile error, and so is tab data on a stack
    zone.
- `@endora-commerce/admin-kit/zones` gets
  `useRecordTabZone(name, props, { reservedIds })`, which returns
  `{ tabs: readonly RecordTabZoneItem[]; renderPanel(id: string): ReactNode | null }`.
  - `RecordTabZoneItem` is `{ id, label, count, countLabel?, module }`. It is shaped to spread
    into the kit's `TabItem` (`value: id`).
  - Labels resolve through `useTranslationContext().t(module, key)`, where `module` is the
    registry entry's key.
  - Counts are held in the hook's state.
  - `renderPanel` returns the selected contribution inside `ZoneErrorBoundary`,
    `ZoneContributionContext`, `Suspense` and `EditorSectionChromeProvider chrome="section"`,
    reusing `AdminZone`'s `lazyComponentFor` cache (exported module-internally).

**Rationale.**

- The host keeps its own tab array and its own `RecordTabs`. That is the least change to a
  working screen (Principle IX) and leaves `?tab=` handling in the host.
- A hook rather than a component, because the host needs the items **and** the body in two
  different places of one `RecordTabs`.

**Rejected.**

- **A `<RecordTabsZone>` component that owns the whole strip.** It would have to absorb the host's
  own tabs, counts and `?tab=` logic, so every host would be rewritten to adopt it.
- **Reusing `<RouteTabsZone>`.** It renders route links between pages, and its strip hides below
  two tabs. Neither applies to in-page record sections.

## R4 — The count: a lazily loaded loader chunk per contribution, run once per mount

**Decision.** The count is a contributor-supplied async function, loaded from its own small chunk.
The hook runs it after the presence and permission filter, in parallel for all contributed tabs.
It runs once per mount and again when the props' key (`opportunityId`) changes. It is aborted on
unmount. A rejection, an abort, or a value that is not a non-negative integer gives `count: null`,
which draws no badge. A failure is logged once per module and zone.

There is no in-page refresh API. The Tasks panel's only write (*Add task*) navigates to
`/tasks/new` and returns through `returnTo`, which remounts the page and re-reads the count.

**Rationale.**

- This is the only shape in which the host owns nothing about the count, so Principle I holds.
- It is lazy (FR-013 of 091), so a tab that is not visible costs nothing.
- It makes one request per contributed tab per record view, not one per row, because detail
  screens mount the zone once.

**Rejected.**

- **Count in the host payload** (`OpportunityDetail.taskCount`). `crm` would read `tasks` through a
  port, which adds a lifecycle edge (XVII), and `crm`'s contract would carry a field for a module
  it must not know.
- **A declarative count URL template in the contribution** (`countFrom: '/api/…?id={opportunityId}'`).
  It is a templating mini-language in contracts, an API path in a UI declaration, and it bypasses
  the module's own API client and its error handling.
- **The panel reports its count after it mounts.** The count would appear only after the tab is
  opened. The strip is drawn before that.
- **An in-page `refreshCount()` context now.** No contributor needs it (YAGNI). It can be added
  later without breaking anything, because `renderPanel` already wraps the panel in a provider.

## R5 — `tasks` count endpoint: `GET /api/v1/admin/tasks/count`

**Decision.** Add a new read route in `packages/modules/tasks/src/backend/routes/routes.tasks.ts`,
gated `requireAdmin('tasks:read')`.

- Query: `TaskCountQuerySchema`. It has the list's filter shape (`taskFilterShape`) and the same
  `linkedBothOrNeither` refinement, without `sort`, `dir`, `cursor`, `limit` or `cardValues`.
- Answer: `{ data: { count: number } }`.
- Service: `TaskService.count(filters, scope)` reuses the private `#where(query, scope)` that
  `list` and `countByStatus` already compose. The visibility pre-filter comes first, so the count
  equals what the list would return.
- The query is one `select count(*)` over `tasks t` with the existing
  `exists (… task_record_links …)` condition, served by the
  `@Index({ properties: ['recordKind', 'recordId'] })` on `task-record-link.entity.ts`.

**Rationale.**

- It is cheap, exact and uncapped.
- It is the same filter vocabulary the admin already uses, so a future count of "my overdue
  tasks" costs nothing.
- `countByStatus` proves the composition. `/count` is a static segment, which Fastify matches
  before `/:id`.

**Rejected.**

- **Counting `GET /tasks?…&limit=100` items.** It is capped (`TASK_LIST_LIMIT_MAX`), heavy, and
  wrong above the cap.
- **Summing `GET /tasks/board`.** It returns cards as well as counts.
- **Adding `total` to the list page.** That puts a `count(*)` on every keyset page of every list
  view to serve one badge.
- **No Redis cache.** The count is a per-reader visibility-filtered aggregate on an indexed
  predicate. A shared cache key would leak counts across visibility scopes, and invalidation
  would need every Task write and visibility change. The lifecycle pub/sub pattern therefore does
  not apply, because nothing is cached.

## R6 — Where contributed tabs sit, and deep links

**Decision.** The host splices the hook's tabs into its own array **after Events, before Notes**.
`tabFromSearch(search, extraIds)` and `searchForTab` in `opportunity-detail/tabs.ts` accept the
visible contributed ids. `reservedIds` is `OPPORTUNITY_TABS.map((tab) => tab.id)`.

**Rationale.** Spec 143's ordering note in `tabs.ts` puts "what is planned for it" third (Events),
and Tasks are planned work. The address rule is unchanged: an id nobody visible declares is the
default tab, and the address is not rewritten.

**Rejected.**

- **Contributions after Change history.** History is deliberately last ("where a list's end is
  easy to find").
- **The host sorting by weight across its own tabs and contributed ones.** That would give the
  host's own tabs weights, which is a renumbering of a working screen for no user gain.

## R7 — `check:admin-zones`

**Decision.** In `backend/scripts/check-admin-zones.ts`:

- `zoneRenderSites` records `useRecordTabZone('<literal>', …)` as a render site
  (`via: 'useRecordTabZone'`). A non-literal first argument is recorded with `zone: null`, so it is
  reported as `computed-zone-name`.
- `zoneContributionSites` records `recordTabComponent('<literal>', …)` as a contribution spelling.
  The hand-written `{ zone, component }` object form is already covered.
- No new finding kind.
  - A tab contribution to a stack zone, or a stack contribution to a tab zone, is a `tsc` error
    (R3) and a schema refusal (R2).
  - A hand-written object without `tab` that slips past both is dropped by `useRecordTabZone` at
    runtime, with a development warning.

**Rationale.** It extends the instrument's two enumerated vocabularies, in the merge request that
publishes the renderer, which is what the script's own comment on `ZONE_RENDERER_TAGS` asks for.

**Rejected.** A new `record-tab-shape` predicate. It would be a third check of a property that
`tsc` and the schema already hold.

## R8 — The Tasks tab panel

**Decision.** `tasks` adds `src/admin/zones/OpportunityTasksTab.tsx` (the tab panel) and
`src/admin/zones/opportunity-task-count.ts` (the count loader).

- The tab reuses `TasksPanel` with a new `layout: 'section' | 'tab'` prop.
  - In the `tab` layout the visible section title is dropped, because the tab already names the
    panel and the `tabpanel` is `aria-labelledby` the tab.
  - *Add task* sits in a toolbar row.
  - `PANEL_LIMIT` rises to 50 for the tab layout.
- *Add task*'s `returnTo` is the current `pathname + search`, which already includes `?tab=tasks`.
- `OpportunityTasksPanel.tsx` and its `opportunity.detail.sidebar` contribution are removed.
  `OrderTasksPanel` and `QuoteRequestTasksPanel` are unchanged.

**Rationale.** It reuses an existing panel (IX) without a second list implementation (issue #1506,
WORK-15). Final spacing and copy are for `endora-commerce-designer`, and are not blocking.

## R9 — Other hosts

- **Project detail.** `projects` already owns a Tasks tab (`project-detail/tabs.ts`, `id: 'tasks'`)
  through its ports and boot hook (`specs/163-projects-and-tasks/`). It does not adopt this
  mechanism. Moving that tab would change a working lifecycle arrangement for no visible gain.
- **Organization detail.** `organization` is not in `TASK_LINK_KINDS`. Adopting would need a new
  link kind, lookups and history in `tasks`, which is not trivial, so it is out of scope.
- **Order and RFQ detail.** Both have tab strips and keep Tasks in their sidebars (per #1758),
  because the owner decision names the opportunity only. Adopting later costs one enum member, one
  hook call, one splice and one contribution move each (SC-004). This is recorded as a follow-up,
  not built.

## R10 — Delivery split

**Decision.** Two merge requests, both off `origin/master` after #1758 merges.

- **MR-A, `tasks` backend only:** `TaskCountQuerySchema` and `TaskCountResponseSchema` in
  contracts, `TaskService.count`, the route, and contract tests. It is independently releasable
  and has no UI.
- **MR-B, the mechanism and its first host:** the contracts zone member and schema, the kit helper
  and hook, `check:admin-zones`, the `crm` host, the `tasks` tab and the contribution move, i18n,
  docs and changesets.

**Rationale.** MR-B cannot be split further without leaving a declared member unrendered
(`unrendered-zone` has no ledger by design). MR-A has no such coupling.
