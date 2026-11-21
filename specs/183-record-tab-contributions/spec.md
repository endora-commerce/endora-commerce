# Feature Specification: Contributed record tabs

**Feature Branch**: `spec/record-tab-contributions`
**Created**: 2026-11-21
**Status**: Draft. The owner decision of 2026-11-21 is recorded below. OQ-1 (what the tab counts)
is open and has a recommended default.
**Input**: Owner decision (2026-11-21): *on the CRM opportunity detail, Tasks get their own
**tab** (for example "Tasks (3)") next to Overview, Links, Events, Notes, Messages, Attachments and
Change history, not a sidebar section.*

**Related**: issue #1526 (UX audit WORK-12) and PR #1758 (DS-20). #1758 adds the
`opportunity.detail.sidebar` zone, where the Tasks panel sits until this feature moves it, and its
design record flagged this mechanism as spec-worthy (its Q1). Tracking: #1567 (UX audit
2026-11-17). Precedents: `order.detail.payment` and `profile.security`, which are tab bodies whose
label the **host** owns, and `order.entry.tabs` / `<RouteTabsZone>`, where the contributions are
route links.

## Owner decision *(binding, 2026-11-21)*

- **OD-1.** On the opportunity detail, the Tasks linked to the opportunity are a **tab of the
  record**, with a label and a count. They are not a section of the sidebar.
- **OD-2.** The mechanism must not make `crm` name `tasks`. The tab is absent when `tasks` is off
  (Principle XVII) or when the reader cannot read Tasks.

## Context

The opportunity screen (`packages/modules/crm/src/admin/pages/OpportunityDetail.tsx`) declares its
tabs as data in `opportunity-detail/tabs.ts` and renders them with the kit's `RecordTabs`. Each
tab's count comes from the `OpportunityDetail` payload that `crm` already reads, such as
`noteCount` and `upcomingEventCount`.

Today a module can add only these things to another module's screen:

- a **stack of panels** (`<AdminZone>`);
- the **body** of a tab whose button and label the host already draws (`order.detail.payment`);
- a **route-tab strip** whose tabs are links to pages (`<RouteTabsZone>`).

None of them lets a module add a whole in-page tab, with its own label and count, to a record's
`RecordTabs`. The host cannot declare a "Tasks" tab itself, because it would have to spell another
module's id, which `check:admin-zones` reports as `foreign-module-id`. It also cannot read the
count, because the number of Tasks is `tasks`' data, and reading it would add a cross-module edge
that Principle I and XVII refuse.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A sales rep sees an opportunity's Tasks as a tab with a count (Priority: P1)

A sales rep opens an opportunity. The tab strip shows a **Tasks** tab, and its count shows how many
Tasks are behind it. Opening the tab lists the Tasks linked to the opportunity, with *Add task* and
a link to the full filtered Tasks list.

**Why this priority**: This is the owner's decision (OD-1). WORK-12 stays open until it ships.

**Independent Test**: Seed an opportunity with linked Tasks. Sign in with `crm:read` and
`tasks:read`. Open the opportunity: the Tasks tab is in the strip with the count, and selecting it
renders the list.

**Acceptance Scenarios**:

1. **Given** `tasks` is on, the reader holds `tasks:read`, and 3 open Tasks plus 1 closed Task are
   linked to the opportunity, **When** the opportunity opens, **Then** the strip shows a **Tasks**
   tab with the count **3** (per OQ-1's default) and the accessible name "Tasks, open: 3".
2. **Given** the same, **When** the reader selects Tasks, **Then** the address becomes `?tab=tasks`
   and the panel lists the linked Tasks the reader may see, with *Add task* for a holder of
   `tasks:write`.
3. **Given** no Task is linked, **When** the opportunity opens, **Then** the Tasks tab is shown with
   no count, and opening it shows the empty state with *Add task*.
4. **Given** the strip is drawn, **When** the count has not arrived yet or its request failed,
   **Then** the tab shows no count, and nothing else on the page waits for it or reports an error.
5. **Given** a Task was added from the tab (the create screen returns to `?tab=tasks`), **When**
   the opportunity shows again, **Then** the count includes the new Task.

---

### User Story 2 — The tab is not there when Tasks are off or not readable (Priority: P1)

**Why this priority**: Principle XVII (NN) and OD-2.

**Independent Test**: Switch `tasks` off, or sign in without `tasks:read`. Open an opportunity and
then `?tab=tasks`.

**Acceptance Scenarios**:

1. **Given** `tasks` is off (on either axis), **When** the opportunity opens, **Then** there is no
   Tasks tab, no Tasks chunk or count chunk is downloaded, and no request reaches `/tasks`.
2. **Given** the reader lacks `tasks:read`, **Then** the same as scenario 1 applies.
3. **Given** either case, **When** the address is `?tab=tasks`, **Then** the default tab
   (Overview) opens. The page shows no error and does not rewrite the address.
4. **Given** the Tasks tab is open, **When** an operator switches `tasks` off in another session
   and this page next re-reads activation, **Then** the tab leaves the strip and the default tab is
   shown.

---

### User Story 3 — A deep link opens the Tasks tab (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a saved link `/crm/opportunities/<id>?tab=tasks`, **When** it is opened by a reader
   who may see the tab, **Then** the Tasks tab is selected on first paint.
2. **Given** the reader moves between tabs, **Then** the address is replaced, not pushed, exactly
   as for the host's own tabs.

---

### User Story 4 — A module author adds a record tab to another module's screen (Priority: P2)

A module author declares a record tab for a host's tab zone: an id, a label key in the author's own
bundle, an optional count loader, a weight and a permission. The author edits no file of the host.

**Acceptance Scenarios**:

1. **Given** a contribution to a record-tab zone declared with the kit helper, **When** it is
   built, **Then** `tsc` checks the panel's props and the count loader's argument against the
   zone's props.
2. **Given** a contribution to a record-tab zone without tab data, or tab data on a zone that is
   not a record-tab zone, **Then** the type-check or the contract schema refuses it.
3. **Given** a contributed tab id that equals one of the host's own tab ids or another
   contribution's id, **Then** the host's tab (or the lower-weight contribution) wins, the
   duplicate is not drawn, and a development warning names both.
4. **Given** a contributed panel throws, **Then** only that tab's body shows the zone error state,
   and the strip and the other tabs keep working.

### Edge Cases

- **Two contributed tabs.** They appear together in the host's slot, ordered by weight and then
  module id.
- **A count above 99.** The badge renders the kit's own formatting, unchanged.
- **The opportunity changes without a remount (same route, another id).** The count is re-read for
  the new id. The tab panel remounts by key.
- **The count is zero.** No badge, the same as for the host's own tabs, where zero draws nothing.
- **The `projects` panel.** It stays a section of `opportunity.detail.sidebar`. This feature moves
  only Tasks.
- **A Task the reader cannot see** (private or a draft of someone else). It is in neither the count
  nor the list, because both use the same visibility pre-filter.

## Requirements *(mandatory)*

### Functional Requirements

#### The record-tab zone mechanism (contracts, admin-kit)

- **FR-001**: A host MAY declare a **record-tab zone**. A record-tab zone is a member of the
  closed admin zone enum whose contributions are whole tabs of the host's record tab strip. Its
  name is `<host>.detail.tabs`.
- **FR-002**: A contribution to a record-tab zone MUST declare:
  - a tab id, which is stable, URL-safe and lowercase, because it is part of `?tab=`;
  - a label key resolved in the **contributing** module's bundle;
  - optionally, a count-label key;
  - optionally, a count loader;
  - a weight;
  - optionally, a permission requirement;
  - its panel component.
- **FR-003**: Tab data MUST be present on every contribution to a record-tab zone and absent on
  every other contribution. The contract schema and the kit helper's types both enforce this.
- **FR-004**: The host MUST be able to obtain, synchronously and before any contributed chunk
  loads, the ordered list of contributed tabs. Each entry carries its id, resolved label and
  current count. The list applies both presence axes, the permission and `match`, the same way the
  existing zone enumeration does.
- **FR-005**: The host decides **where** in its strip the contributed tabs go. Contributions decide
  only their order among themselves, by weight and then module id.
- **FR-006**: A count loader MUST be fetched and run only for contributions that survive presence
  and permission. It runs once per mount and per change of the zone props, never once per render.
  While it is pending, failed or returns a non-integer, the tab shows no count.
- **FR-007**: The selected contributed tab's panel MUST render with the zone's per-contribution
  error boundary, `Suspense` and contribution context, and with `section` chrome.
- **FR-008**: A contributed tab whose id collides with a host-reserved id, or with an earlier
  contribution's id, MUST NOT be drawn. A development warning MUST name the colliding module.
- **FR-009**: `check:admin-zones` MUST treat a record-tab zone as **rendered** when a host calls the
  new enumeration hook with the literal name. It MUST recognise the new helper as a contribution
  spelling. A computed name in either is reported as `computed-zone-name`.

#### Opportunity adoption (crm, tasks)

- **FR-010**: `crm` MUST declare and render `opportunity.detail.tabs`. The contributed tabs sit
  after Events and before Notes, in the "what is planned for it" position (spec 143 User Story 21
  ordering).
- **FR-011**: The opportunity screen MUST select a contributed tab from `?tab=<id>`. An id that
  neither the host nor a visible contribution declares opens the default tab.
- **FR-012**: `tasks` MUST contribute a **Tasks** tab (`id: tasks`) to `opportunity.detail.tabs`,
  gated on `tasks:read`. It replaces its contribution to `opportunity.detail.sidebar`.
- **FR-013**: The Tasks tab's count MUST come from a single dedicated count read that applies the
  list's filters and the visibility pre-filter. It MUST NOT come from a capped list page.
  **[NEEDS CLARIFICATION] OQ-1**: does it count **open** Tasks (default) or all linked Tasks?
- **FR-014**: The Tasks tab panel MUST list the linked Tasks the reader may see, with number,
  title, status, assignees and due date. It offers *Add task* to a `tasks:write` holder, with a
  return address of the current `?tab=tasks` URL, and a link to the filtered Tasks list. It MUST
  NOT repeat the tab's label as a second heading.
- **FR-015**: With `tasks` off, or without `tasks:read`, the opportunity screen MUST be identical to
  one where the `tasks` module was never installed: no tab, no chunk, no request.

#### Cross-cutting

- **FR-016**: Every new user-facing string MUST ship in English and Polish in the owning module's
  bundle (`tasks`: the tab label and count label).
- **FR-017**: The count read MUST be gated by the existing `tasks:read` code. It introduces no new
  permission code, palette action, setting, entity or migration.
- **FR-018**: The user documentation for `crm` and `tasks` MUST describe the Tasks tab, in EN and
  PL.

### Key Entities

- **Record-tab contribution**: a zone contribution that carries tab data (id, label key,
  count-label key, count loader) beside the usual zone, weight, permission and component.
- **Task count**: the number of Tasks that one reader may see under a filter set. It is derived
  and not stored.

## Success Criteria *(mandatory)*

- **SC-001**: On an opportunity, the Tasks tab and its count appear after at most one extra HTTP
  request beyond today's page load (the count). A page whose reader cannot see the tab makes zero
  extra requests.
- **SC-002**: `packages/modules/crm/src/admin/**` contains no occurrence of the `tasks` module id
  that `check:admin-zones` reports as `foreign-module-id`.
- **SC-003**: Every FR above traces to at least one test that fails before the change.
- **SC-004**: A second host can adopt the mechanism by adding one enum member, one hook call and
  one splice, with no change to the kit.

## Assumptions

- PR #1758 (DS-20) merges first. If it has not merged when implementation starts, this feature
  rebases onto it, because the move in FR-012 is *from* `opportunity.detail.sidebar`.
- Order and quote-request detail screens keep Tasks in their sidebars. The owner decision names the
  opportunity only (see `plan.md` § Other hosts).
- The project detail already has a Tasks tab that `projects` owns through its ports (spec 163), so
  it does not adopt this mechanism. Organizations are not a Task link kind (`TASK_LINK_KINDS` in
  `packages/contracts/src/tasks.ts`), so the organization detail is out of scope.

## Open questions

- **OQ-1 [NEEDS CLARIFICATION] — what does the Tasks count count?**
  - **A (recommended):** open Tasks (`statusCategory=open`), with the accessible name "Tasks,
    open: 3". This is the Events precedent, which counts upcoming items ("is anything still to
    do?", research N-CAL12, kept by the owner on 2026-10-09). A total of linked Tasks only grows.
  - **B:** all linked Tasks the reader may see ("Tasks, items: 4"). This is the Notes and
    Attachments precedent.
  - Either is one query parameter. If the owner has not ruled, A ships.
