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
| `/crm/calendar` | `CalendarPage` | `crm:read` | US22 — *planned*, §1b |

`OpportunityDetail` is a tabbed page. Tabs are data in
`src/admin/pages/opportunity-detail/tabs.ts` — one line per tab, each a lazy component — so a
story adds a tab by adding one file and one line: **Overview** (US1), **Links** (US20),
**Notes** and **Messages** (US4), **Attachments** (US5), **Change history** (US11). §1a says
what is on the screen besides the tabs, and where. **Events** (US21, planned) is one more
file and one more line, third in the order — §1b.

A route and its sidebar entry are added by the story that ships the page, never earlier: a
palette or nav entry pointing at a route that does not exist is a defect (Principle XVI).

## 1a. The Opportunity screen (US20)

Normative for `src/admin/pages/OpportunityDetail.tsx` and `pages/opportunity-detail/*`.
The story is `spec.md` User Story 20 (FR-110 – FR-121); the reasons are `research.md` N-DL.

**Regions.** One grid under the header. The rows below are in **markup order**, which is
also the order a screen narrower than `lg` stacks them in.

| Region | Component | Placement from `lg` | Holds |
| --- | --- | --- | --- |
| Header | the kit's `PageHeader` | above the grid | back link; `h1` = title + status badge; one meta line — number · Organization · assignee or *Unassigned* · Sales Channel when set; actions **Edit** (`crm:write`, opens the form on *Overview*) and **Delete** (`crm:configure`) |
| Stage bar | `components/StageBar.tsx` over `lib/stage-model.ts`, in a `Card` | left column | the current status, the allowed moves, the optional reason |
| Order status changes | `components/PropagationOutcomes.tsx`, in a `Card` | left column | this visit's outcomes and every unresolved refusal — rendered by the page, so on every tab; absent when there is nothing to show |
| Facts | `opportunity-detail/OpportunitySidebar.tsx` — an `aside` holding one `Card` | right column (`20rem`), from the first row down, spanning the three rows | see below |
| Tabs | `opportunity-detail/tabs.ts`, in a `Card` | left column | see below |

The grid's last row is the flexible one (`auto auto 1fr`), so a facts card taller than the
left column lengthens the space under the tabs and never the gaps between the cards.

**The stage bar** shows the current status and the moves allowed from it — never the whole
workflow.

- **The moves are the Opportunity's `allowedTransitions`**, all of them and nothing else.
  `lib/stage-model.ts` only decides each one's side:
  a target of kind `won` or `lost` is **forward**; an `open` target of a `won` / `lost`
  current status is **back** (reopening); between two `open` statuses the side is their
  order by `weight`, then `code`.
- That last rule is the only thing `GET /api/v1/admin/crm/workflow` (`crm:read`) is read for
  — `allowedTransitions` carries no weight — and it is not read at all when there is no
  move. When it fails, or does not hold one of the two statuses, the move is listed under
  `opportunity.stage.other` with `opportunity.stage.partial` beneath; nothing is guessed and
  no move is withheld.
- Three labelled `role="group"`s at most — `opportunity.stage.back`, `.forward`, `.other` —
  each a `ul`; a group with no move is not rendered. Markup order is current status, back,
  forward; from `sm` they are drawn back · current · forward. The current status is not
  focusable, so the keyboard meets back before forward either way.
- For a holder of `crm:write` a move is a `button` named `opportunity.stage.moveBack` /
  `.moveForward` / `.moveTo` (unsorted) / `.moveToClosing` (a closing status), each containing
  its visible label. Pressing it is `POST …/opportunities/:id/transition` with the reason
  field's trimmed text, exactly as the control it replaces: the server's sentence on a
  refusal, a re-read on 409, the move announced in a live region. Without `crm:write` the
  same moves are text and the section says why.
- With no move: `opportunity.status.none` (or the no-permission sentence). A closed
  Opportunity also shows `opportunity.status.closed.<kind>` with the closing time.
- There is no position ("n of N") and no "done" state. A side has a word and an arrow; a
  closing status an icon and a spoken `opportunity.stage.kind.<kind>`. The groups stack on a
  narrow screen and their moves wrap; nothing scrolls.

**The tabs.** `role="tablist"` named `opportunity.tabs.label`; one tab stop, arrow keys,
`Home` and `End`.

| Order | `id` | Label key | Holds |
| --- | --- | --- | --- |
| 1 — default | `overview` | `opportunity.tabs.overview` | description (with references), custom fields (US15), the edit form while it is open |
| 2 | `links` | `opportunity.tabs.links` | `LinkedDocuments`, `LinkedQuoteRequests` — with the create buttons and return notices of US10; the label carries `links.length` when it is not zero |
| 3 | `notes` | `opportunity.tabs.notes` | US4 |
| 4 | `messages` | `opportunity.tabs.messages` | US4 |
| 5 | `attachments` | `opportunity.tabs.attachments` | US5 |
| 6 | `history` | `opportunity.tabs.history` | US11, under an `h2` that is not drawn |

**The address.** `?tab=<id>` selects a tab; the screen writes it with `replace`, keeping every
other parameter and the navigation state. The default tab is written as *no* parameter. An
unknown id selects the default. `?created=<kind>` without `tab` selects `links` — it is the
return address `components/CreateFromOpportunity.tsx` hands the Order and Quote Request
create screens. **An `id` is therefore part of a public address and is not renamed.**
Addresses that exist elsewhere and keep working unchanged: the bare
`/crm/opportunities/:id` written by `crm-notifier.ts` (the bell), `crm-audit-references.ts`,
the list, the board, the analytics table, the Organization zone and the linked-Opportunity
panel of the Order and Quote Request screens.

**The facts.** An `aside` named `opportunity.section.details` holding one `Card`; inside it
four `section`s separated by hairlines, each under an `h2`, each fact a `dt` above its `dd`:

| Group (key) | Facts | Changed in place (existing endpoint) |
| --- | --- | --- |
| `opportunity.facts.valueAndDeadline` | value and its mode, the kept estimate and the excluded documents (`OpportunityValue`); expected close date | the mode — `PATCH …/:id` `{ valueMode }` |
| `opportunity.facts.customer` | Organization (link), contact person and e-mail; assignee (`AssigneeSection`) | the assignee — `POST …/:id/assign` |
| `opportunity.facts.classification` | Sales Channel, source; tags (`TagsSection`) | the tags — `PUT …/:id/tags` |
| `opportunity.facts.record` | number, created, last changed; closed, once it is | — |

`OpportunityValue`, `AssigneeSection` and `TagsSection` are `role="group"` under an `h3`
inside their group, not landmarks. A fact without a value renders the dash and a spoken
`opportunity.facts.notSet`; the *closed* row alone is omitted while there is nothing to say.
The column adds no write: what is not in the third column above is changed by the edit form.

## 1b. Events on the Opportunity screen, and the Calendar (US21, US22)

Normative for `src/admin/pages/CalendarPage.tsx`,
`src/admin/pages/opportunity-detail/tabs/EventsTab.tsx`, `src/admin/components/calendar/*`,
`src/admin/components/EventDialog.tsx` and `src/admin/lib/calendar/*`. The stories are
`spec.md` User Stories 21 and 22 (FR-130 – FR-152); the API is `admin-api.md` §12d; the
reasons are `research.md` N-CAL9 – N-CAL12. **No calendar library**: `plan.md` §
*Complexity Tracking* sets the choice beside its alternative.

**As built (2026-10-08), and where the build left the first draft of this section.** The
Admin UI was built against `admin-api.md` §12d with the routes stubbed (`tasks.md` Phase 26).
Each line below is reflected in the text that follows; they are gathered here so a reader of
the diff sees them in one place.

| What | Decision | By |
| --- | --- | --- |
| A **Day** view | added as a fourth view — the week grid with one column; "+N more" opens *Day* where it is offered and the day's week otherwise | owner ("in the style of Google Calendar") |
| Default date of a new Event | **plain today** — not "the day after the Opportunity's latest Event" | owner ruling, 2026-10-08 |
| Time format | follows **the language of the Admin UI the person is logged in with**: 24-hour in Polish, 12-hour in English; not the browser's own preference | owner ruling, 2026-10-08 |
| The closed note | shown on **every** closed Opportunity, with or without a scheduled reminder | owner ("leave it for now") |
| The address's defaults | written as **nothing** — a bare `/crm/calendar` keeps meaning *today* | build |
| An entry's name under *All* | also names the Opportunity's assignee; under *Mine* it does not | build |
| A truncated answer | is asked again on any change of range — a narrower one may be complete | build |
| *All day* | a checkbox; the kit has no switch | build |
| The tab's calendar | not drawn while the Opportunity has no Events | build |
| The toolbar | `role="toolbar"` without arrow-key roving: it holds a native date field and radio groups, whose own keys those are | build |
| *Go to date* | navigates 300 ms after the field stops changing, and only to a year between 1970 and 2199 — a native field reports every keystroke as a date | build |

### The one calendar component

`components/calendar/EventCalendar.tsx` is used twice — by the Calendar page with every
Event the caller may see, and by the *Events* tab with one Opportunity's. It is given its
Events and draws them; it fetches nothing and knows no route.

```text
EventCalendar props
  events: CalendarEntry[]            — { id, name, allDay, startsAt, endsAt, allDayDate, href, context }
  view: 'month' | 'week' | 'day' | 'agenda'  — controlled
  date: 'YYYY-MM-DD'                 — the anchor day, controlled
  views: readonly View[]             — which views the switch offers
  onNavigate(view, date)             — the parent owns the address (page) or the state (tab)
  state: 'loading' | 'ready' | 'error', onRetry, truncated
  toolbarExtra?: ReactNode           — the page's Mine / All switch
  titleHeading?: 'h2' | 'h3'         — the range title's level; a day is one under it (the tab passes 'h3')
```

`context` is the second line of an entry's name: on the page, the Opportunity's number and
title; on the tab, nothing. All date arithmetic is in `lib/calendar/date-math.ts` and all
geometry in `lib/calendar/layout.ts` — pure functions, tested without a DOM, on the
browser's local time through `Date` and `Intl.DateTimeFormat` only.

**Toolbar** (one `role="toolbar"` row that wraps): **Today**; **Previous** and **Next**
(icon buttons named `calendar.previous.<view>` / `calendar.next.<view>` — "Previous week");
the range title as the region's `h2`, in a polite live region so moving announces the new
range; **Go to date**, a native `<input type="date">` with a visible label; the view switch,
a `radiogroup` of *Month*, *Week*, *Day*, *Agenda* (native radios drawn as segments); then
`toolbarExtra`. *Go to date* waits 300 ms after its last change before it navigates. The
toolbar's controls are each a tab stop — there is no arrow-key roving, because the date field
and the radio groups use the arrow keys themselves. The browser's time zone is
named under the toolbar (`calendar.timeZone`, FR-149).

**Month** — a `<table>`: a header row of weekday names (`<th scope="col">`, `abbr` for the
full name), six rows of seven days starting Monday. Each cell: the day number as a `<time
datetime>` — today marked by a filled disc **and** the words `calendar.today` for assistive
technology, days of the neighbouring months muted **and** still readable at 4.5:1 — then a
`<ul>` of up to three entries (all-day first, then by start), then, when more, a button
`calendar.more` ("+{count} more", named "{count} more events on {date}") that calls
`onNavigate('day', thatDay)` — or `'week'` where the *Day* view is not among `views`. A cell is not focusable and not clickable; only its entries
and its "+N more" are.

**Week** — seven day columns under an all-day row, beside an hour scale of 24 rows of 48 px.
On opening it scrolls its own box so that 07:00 is at the top. Structure for assistive
technology is **seven sections, not a grid**: each day an `<section>` under an `<h3>`
("Thursday 8 October — 3 events"), holding one `<ol>` of that day's entries in order of
time, all-day ones first. The hour lines and the scale are decoration and are hidden from
assistive technology; each entry states its own time. A timed entry is positioned from
`layout.ts`: top and height from its start and length (minimum height 24 px, so a 15-minute
Event still shows its name), and overlapping entries share the column's width in equal
lanes — greedy column packing over entries sorted by start, each cluster of mutually
overlapping entries as wide as its number of lanes. An entry that, in the reader's zone,
runs past midnight is cut at the bottom of its start day and says `calendar.continues`. The
current time is a 2 px line with a dot on today's column, updated every minute, hidden from
assistive technology.

**Day** — the *Week* view with one column: the same grid, the same list, the same line.

**Times** are written in the language of the Admin UI (`useAppLanguage`), through
`Intl.DateTimeFormat`: `13:05` in Polish, `01:05 PM` in English (owner ruling, 2026-10-08;
`lib/calendar/format.test.ts`).

**Agenda** — a list of the days that have entries, from the anchor date for 30 days: each
day an `<h3>` and a `<ul>`. It is the only view under 640 px (`sm`): there the switch is
not rendered, `view` is treated as `agenda` whatever the address says, and *Previous* /
*Next* move 30 days.

**An entry** (`EventChip`) is a link — `<a href>` through the router's `Link`, so Enter,
middle-click and "open in new tab" are the browser's. Visible: the start time (not for
all-day), the name, and `context` when given, cut with an ellipsis. Accessible name:
`calendar.entry.label` — "{name}, {time}, {context}" — complete, never cut. A reminder is a
bell glyph with the spoken `calendar.entry.hasReminder`. Minimum target 24 × 24 px in the
grids (WCAG 2.2 SC 2.5.8) and 44 px in the Agenda, which is what a touch screen gets.
Entries are one colour, the theme's accent tint with its on-colour; nothing is said by
colour.

**Keyboard**: Tab walks toolbar, then entries in DOM order, which is chronological in every
view. There are no arrow-key grid cells, because a cell does nothing: the APG grid pattern
is for cells that are themselves widgets, and making 42 inert cells focus stops would be
slower, not more accessible. A "Skip the calendar" link precedes the first entry.

**States**: `loading` — the view's frame with skeleton entries and `aria-busy`; `ready` with
no entry in range — the frame, plus `calendar.empty` with a *Today* button when the anchor
is not today; `error` — `calendar.error` with **Try again**, the frame kept so the toolbar
still works; `truncated` — a `role="status"` line, `calendar.truncated`, above the view.

### The Calendar page — `/crm/calendar`

`PageHeader` titled `calendar.title`; under it `EventCalendar` with all three views.

- **Address**: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`, written with
  `replace`. Absent or malformed: `month`, today, and no `scope` (the server's default). The
  defaults are written as *no* parameter, so the bare address keeps meaning today.
  `lib/calendar/calendar-address.ts` reads and writes it.
- **Data**: `GET /calendar/events` for the view's range, one day wider each side
  (`admin-api.md` §12d). Month: the 42 days drawn. Week: its seven. Day: its one. Agenda: 30.
  Moving inside an already loaded range asks nothing — unless the answer held was
  `truncated`, which is asked again for the new range.
- **Mine / All**: rendered from `meta.scopes` — a two-option `radiogroup` when it has two
  members, **nothing at all** when it has one. The applied `meta.scope` is what is shown as
  chosen, whatever the address asked.
- An entry's `href` is `/crm/opportunities/<id>?tab=events&event=<eventId>`. Its `context` is
  the Opportunity's number and title and, when the applied scope is `all`, its assignee's name.
- No write: the page holds no `crm:write` control (spec OQ-7).

### The *Events* tab — `id: 'events'`

Third in `OPPORTUNITY_TABS`, after `links`: `labelKey: 'opportunity.tabs.events'`,
`count: (opportunity) => opportunity.upcomingEventCount`. The id is an address and is not
renamed.

| Region | Holds |
| --- | --- |
| Header row | `h2` *Events*; **Add event** (`crm:write`), which opens the dialog; a link **Open the calendar** to `/crm/calendar` |
| Closed note | on **every** closed Opportunity (status kind not `open`): `events.closedNote`, `role="note"` — its Events are off the Calendar and its reminders held |
| List | `GET /opportunities/:id/events`. Two `h3` groups: **Upcoming** (`endsAt` later than now, soonest first) and **Past** (latest first, the first ten with *Show all*). Each row: the date and time in the browser's zone, the name, the description's first two lines, the reminder's state in words (`events.reminder.<state>`, with its time and, for `sent`, its channels), and for `crm:write` **Edit** and **Delete** — Delete asks for confirmation in a dialog naming the Event |
| Calendar | `EventCalendar` with `views = ['month', 'week']`, its view and date in component state (not in the address — the address already carries `tab` and `event`), `context` empty; entries link to `?tab=events&event=<id>` on this same screen. Not rendered under 640 px — the list above is the agenda — nor while the Opportunity has no Events |

`?event=<id>` marks that Event's row (`aria-current="true"`, a ring) and scrolls it into
view once; an id that is not among the Events is ignored.

**The dialog** (`components/EventDialog.tsx`, on the module's `ModalDialog`) — one form for
add and edit:

| Field | Control | Rule |
| --- | --- | --- |
| Name | text, required, `maxLength` 200 | focus lands here |
| All day | checkbox | on: the two time fields leave the form |
| Date | `<input type="date">`, required | default: **today** (owner ruling, 2026-10-08) |
| From, To | `<input type="time">`, required unless all day | default the next whole hour and one hour after; changing *From* moves *To* by the same amount; *To* not after *From* is said under the field before saving |
| Description | `textarea`, `maxLength` 5 000 | plain; no `@` shortcuts |
| Remind me | checkbox | off by default |
| Remind at | `<input type="datetime-local">`, shown only when *Remind me* is on | default the Event's start (09:00 on the date when all day); **follows the start until the user edits it**; a time not in the future is said under the field |

Labels above fields, one column, errors under the field they belong to and linked with
`aria-describedby`; the server's 422 is mapped by `details.field` to the same place. Save
sends instants built from the local date and times and `timeZone` from
`Intl.DateTimeFormat().resolvedOptions().timeZone`; for *All day*, local midnight and the
next local midnight. On success the dialog closes, the list and the tab's count are read
again, and a `role="status"` line says what was saved.

## 2. Sidebar (`contributions.nav`) — the "CRM" group

Owner ruling, 2026-10-05: a top-level group of its own, **not** under *Sales*.

| `to` | `labelKey` | `icon` | `section` | `weight` | `requiredPermission` | Story |
| --- | --- | --- | --- | --- | --- | --- |
| `/crm/opportunities` | `nav.opportunities.label` | `CircleDollarSign` | `crm` | 100 | `crm:read` | US1 |
| `/crm/board` | `nav.board.label` | `PanelLeft` | `crm` | 200 | `crm:read` | US7 |
| `/crm/calendar` | `nav.calendar.label` | `CalendarDays` | `crm` | 250 | `crm:read` | US22 — *planned* |
| `/crm/analytics` | `nav.analytics.label` | `LineChart` | `crm` | 300 | `crm:analytics` | US13 |
| `/crm/tags` | `nav.tags.label` | `Tag` | `crm` | 400 | `crm:configure` | US6 |
| `/crm/workflow` | `nav.workflow.label` | `ListChecks` | `crm` | 500 | `crm:configure` | US1 |

The section `crm` and its heading `appShell.section.crm` are the **host's**
(`foreign-module-changes.md` A3–A5). Every icon is already a member of `KnownIconNameSchema`,
so `admin/src/lib/admin-actions/icon-map.ts` is not edited. **One exception, planned with
US22**: the allowlist holds no calendar glyph, so `CalendarDays` joins it and the icon map
(`foreign-module-changes.md` §CAL-A) — the way `LineChart` and `ShieldCheck` joined, rather
than the Calendar borrowing a glyph that means something else. Calendar / Kalendarz sits
between Board and Analytics: the three daily screens first, then the manager's, then the
two that configure.

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
| `open-crm-calendar` | `/crm/calendar` | `crm:read` | `CalendarDays` | 324 | US22 — *planned* |

Keys `actions.<camelId>.label` / `.description` in both bundles; keywords in both languages
(`crm`, `opportunity`, `pipeline`, `szansa`, `sprzedaż`, `lejek`). Four entries, deliberately:
the landing surface, the two things a Sales Rep does daily, and — added with User Story 13 —
analytics, the one screen that opens on a code of its own: for a manager holding
`crm:analytics` the palette would otherwise offer nothing that code is for (research N-F2).
`check:action-route-permissions` holds each code to the one enforced on its route.

**A fifth, planned with US22**: `open-crm-calendar`, keywords `crm`, `calendar`, `events`,
`reminder`, `schedule`, `kalendarz`, `wydarzenia`, `przypomnienie`, `terminy`. It is inside
the principle's "few highest-value actions": the Calendar is opened daily and by everybody
who holds `crm:read`. It is added in the change that ships the route, never before.

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
- **Events and the Calendar add no code** (US21, US22; research N-CAL2). Reading Events and
  the Calendar is `crm:read`; adding, changing and deleting an Event is `crm:write` — an
  Event is part of working an Opportunity, as a note is. What a Sales Rep's Calendar shows
  is decided from the caller's **reach**, not from a code (`admin-api.md` §12d).
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
| `/crm/calendar`, its sidebar row and palette action; the *Events* tab (US21, US22 — *planned*) | rendered | absent with every other CRM surface | absent |
| `crm-event-reminders` worker (US21 — *planned*) | sweeps every 60 s | **paused: no reminder is delivered**; on reactivation one up to 24 h late is delivered once, an older one is marked missed | paused |
| transactional e-mail `crm_event_reminder` on the e-mail templates screen | offered | not offered — the registry leaves out a contributor that is not present | not offered |
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

Planned with US21 and US22, in the same test: the five routes of `admin-api.md` §12d join
the `routes` probe; and — positive control first — a due reminder is delivered while CRM is
on, **not** delivered while it is deactivated (the sweep is driven the way the consumer
drives it, through the worker's own presence gate, not by calling the service around it),
and delivered once after reactivation.

## 7. i18n key namespaces (flat JSON, both bundles)

| Prefix | Content |
| --- | --- |
| `nav.*`, `actions.*` | sidebar and palette |
| `adminRoles.permission.*` | permission labels |
| `errors.CRM_*` | error sentences |
| `auditLog.crm.*` | audit action labels for the history tab and the audit viewer |
| `opportunity.*`, `workflow.*`, `links.*`, `propagation.*` | US1 screens |
| `opportunity.stage.*`, `opportunity.facts.*`, `opportunity.tabs.links`, `opportunity.tabs.label`, `opportunity.description.*` | the Opportunity screen's layout (US20, §1a) |
| `assignment.*`, `comments.*`, `attachments.*`, `tags.*`, `board.*`, `value.*`, `history.*`, `references.*`, `analytics.*` | one prefix per later story |
| `customFields.*` | the custom-fields section of the create form and the Overview (US15) |
| `organizationPanel.*` | the panel on the Organization screen (US14, §5) |
| `orderPanel.*` | the linked-Opportunity panel on the Order and Quote Request screens (US17, §5) |
| `origin.*` | the "create from an Opportunity" buttons and their return messages (US10) |
| `events.*`, `opportunity.tabs.events` | the *Events* tab, its list and its dialog (US21 — Admin UI track) |
| `calendar.*`, `nav.calendar.label`, `actions.openCrmCalendar.*` | the calendar component, the Calendar page, its sidebar row and palette action (US22 — Admin UI track) |
| `notifications.eventReminder.title`, `notifications.eventReminderAllDay.title`, `auditLog.crm.opportunity.event_add` / `.event_update` / `.event_remove` | the reminder's bell sentences and the three history labels (US21 — backend track) |

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
