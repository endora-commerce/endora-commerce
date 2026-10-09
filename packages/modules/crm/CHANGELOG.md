# @endora-commerce/mod-crm

## 0.104.0

### Minor Changes

- d5ab69f: An operator chooses which fields a card on the Opportunity board shows, and the board is
  filtered by the fields its cards show. Additive: an instance nobody configures shows the card
  it showed before.

  **`@endora-commerce/mod-crm`.** A new Setting, `crm.board_card_fields` — a JSON array of field
  references, platform-wide, defaulting to the card as it was (`builtin:number`,
  `builtin:organization`, `builtin:value`, `builtin:assignee`, `builtin:tags`). It is edited in
  the new _Board card_ section of **CRM → Workflow**, which the board links to for a holder of
  `crm:configure`. A field is `builtin:<key>` or `custom:<definition key>`; a custom field
  whose definition is deleted drops out of the cards, the filters and the section without an
  error. At most six fields are shown, the title besides.

  - `GET /api/v1/admin/crm/board/card-fields` (`crm:read`) answers `{ fields, available,
maxFields }`; `PUT` on the same path (`crm:configure`) takes `{ fields: string[] }` and
    answers the same.
  - `GET /api/v1/admin/crm/board` answers `cardFields` beside `columns`, and every card carries
    `cardValues` — the values of the chosen fields a summary does not already hold, keyed by
    reference, and of no other field.
  - `GET /api/v1/admin/crm/board` and `GET /api/v1/admin/crm/opportunities` accept
    `fieldFilters`, a URL-encoded JSON object of operators per field reference (`contains`,
    `in`, `is`, `min`, `max`, `from`, `to`). A reference that is not on the card is ignored. The
    list also accepts `cardValues=true`.
  - The board's filters are now carried in its address (`/crm/board?assignee=me&f.custom:lead_source.in=referral`),
    so a filtered board can be reloaded and shared.

  The module now resolves two more ports, both of owners it already depends on:
  `customFieldDefinitionReadPort` (`custom_fields`) and `settingsAdminService` (`settings`).

  **`@endora-commerce/contracts`.** New exports: `OPPORTUNITY_BOARD_CARD_MAX_FIELDS`,
  `OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS`, `OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS`,
  `opportunityBoardFieldRefSchema`, `opportunityBoardFieldKindSchema`,
  `OpportunityBoardCardFieldSchema`, `SetOpportunityBoardCardFieldsRequestSchema`,
  `OpportunityBoardCardConfigSchema` (and its response envelope), `OpportunityFieldFilterSchema`,
  `OpportunityFieldFiltersSchema` and their inferred types. `OpportunityBoardSchema` gains the
  required member `cardFields`; `OpportunitySummarySchema` gains the optional `cardValues`;
  `OpportunityListQuerySchema` and `OpportunityBoardQuerySchema` gain the optional `fieldFilters`
  (parsed from its JSON text) and the list query the optional `cardValues`.

- eb04e42: Events on a Sales Opportunity, their reminders, and a CRM Calendar (User Stories 21 and 22).
  The module's page — `docs/crm.md`, sections _Events and reminders_ and _The calendar_ — is the
  full description; this is what an upgrader and an integrator need.

  **What installing this version does.**

  - **One new table, `crm_opportunity_events`** — the module's fourteenth, created by its fourth
    migration (`20261008T135701_crm_opportunity_events`). Run the migrations. An Event belongs to
    one Opportunity, is deleted with it, and carries no organization of its own.
  - **One new hard dependency: `transactional_emails`**, beside the existing ones. It owns the
    sender the reminder e-mail goes out through and the registry its default subject and body are
    pushed into. That module cannot be switched off, so the edge holds no operator's switch.
    `admin_notifications` stays a dependency the module degrades without; `auth`, already a
    dependency, now also answers whether a reminder's recipient is online
    (`AuthSessionReadPort.lastSeenByAdminUser`, new in this release).
  - **A second queue consumer**, on the queue `crm-event-reminders`: a scheduler that fires every
    60 seconds and a worker that reads the due reminders from the table. It needs the worker
    process the value recalculation already needs; an instance that runs none delivers no
    reminder. Nothing but the clock is kept in Redis.
  - **One transactional e-mail, `crm_event_reminder`** ("Event reminder", group `crm`), with
    defaults in `en-US` and `pl-PL` and the variables `event.name`, `event.when` and
    `opportunity.number`. An operator edits it or switches it off on the Transactional Emails
    screen.
  - **No new permission, setting, error code or environment input.** Reading Events and the
    Calendar needs `crm:read`; adding, editing and deleting an Event needs `crm:write`.

  **Five routes**, under `/api/v1/admin/crm`, with the shapes `@endora-commerce/contracts`
  publishes in this release:

  - `GET /opportunities/:id/events` (`crm:read`), `POST /opportunities/:id/events`,
    `PATCH` and `DELETE /opportunities/:id/events/:eventId` (`crm:write`). An Event is a name, an
    optional plain-text description, **one day** — a start and an end on it, or all day — the IANA
    `timeZone` it was planned in, and an optional reminder time. Any holder of `crm:write` who can
    see the Opportunity edits and deletes any of its Events. An Opportunity the caller may not see
    answers 404 `CRM_OPPORTUNITY_NOT_FOUND`; a well-formed Event the rules refuse answers 422
    `VALIDATION_FAILED` with `details.field` and `details.rule`. Each write is an entry of the
    Opportunity's change history (`crm.opportunity.event_add`, `.event_update`, `.event_remove`)
    that carries the name and the times and never the description's text.
  - `GET /calendar/events?from=&to=&scope=` (`crm:read`): the Events of **open** Opportunities
    the caller may see, over at most 45 days, at most 500 of them (`meta.truncated`). The scope
    is the server's decision: a caller who may see every organization gets `all` and may ask for
    `mine`; a caller restricted to a set of organizations is always answered with `mine` — the
    Opportunities assigned to them.
  - `GET /opportunities/:id` now counts the Events that have not ended, in `upcomingEventCount`.

  **Reminders.** A reminder goes, when it is due, to the person the Opportunity is assigned to at
  that moment; failing that — nobody assigned, or an assignee who does not qualify — to the person
  who added the Event; failing both, to nobody (`no_recipient`). To qualify, a person must be an
  active administrator, hold `crm:read`, and reach the Opportunity's Organization — the same three
  tests for both. It is always written to the notification bell, and sent as an e-mail as well
  when the recipient has made no request to the Admin UI in the last five minutes, or when
  `admin_notifications` is switched off. It is delivered at most once; while its Opportunity is
  closed or the module is switched off it waits; found more than 24 hours late it is not sent and
  is reported as `missed`.

  - **How it says when.** `event.when` of the e-mail and the `when` param of the bell entry are
    worded for the one recipient, in the language of their Admin UI and in the Event's own zone:
    `October 8, 2026, 6:42 PM (Europe/Warsaw)`, `8 października 2026, 18:42 (Europe/Warsaw)`; the
    date alone for an all-day Event.
  - **The name, on one line.** A line break in an Event's name is said as a space, in the bell
    sentence and in the subject of the e-mail. The bell stores a title of at most 255 characters,
    so for a very long name the stored English sentence is cut to fit; the translated sentence
    the reader is shown keeps the name whole.
  - **An Event deleted, or a reminder removed or moved, is not reminded of** — also when the
    sweep had already claimed it. `interrupted` is reported only for a reminder whose sending
    process died before recording the result; it is not sent again.

  Three things an operator should know before relying on it:

  - **The reminder e-mail carries no link.** It names the Opportunity by its number. An absolute
    link needs the address of the instance's Admin UI, which this module does not read; the bell
    entry links to the Opportunity.
  - **With no SMTP connection configured, the e-mail is written to the server's log and reported
    as sent**, so the Event shows "sent — notification bell and e-mail" for a message that reached
    no mailbox. The bell entry is unaffected.
  - **A reassignment moves every Event and every pending reminder** to the new assignee, with no
    row written: an Event holds no assignee.

  **In the Admin UI.**

  - **A Calendar screen**, `/crm/calendar` (`crm:read`), in the CRM group of the sidebar between
    _Board_ and _Analytics_, and a fifth command-palette action, `open-crm-calendar`. Four views —
    **Month**, **Week**, **Day** and **Agenda** — with _Today_, _Previous_ / _Next_ and _Go to
    date_; every Event is a link to its Opportunity. The view, the date and _Mine / All_ are in the
    address: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`. _Mine / All_ is drawn
    from what the server says the reader may ask for. Under 640 px the Calendar is the Agenda. The
    screen holds no write.
  - **An "Events" tab** on the Opportunity screen, third after _Links_, its label counting the
    Events that have not ended: the list — upcoming, then past — with what became of each reminder
    in words, a calendar of that Opportunity alone, and, for a holder of `crm:write`, adding,
    editing and deleting. The dialog's reminder checkbox reads _Set a reminder_ / _Ustaw
    przypomnienie_, and its hint says who is reminded. `/crm/opportunities/:id?tab=events&event=<id>` — what a reminder and a
    Calendar entry link to — marks that Event. A closed Opportunity keeps the tab and says that its
    Events are off the Calendar and its reminders held.
  - Times are shown in the browser's time zone, which the screen names, and written the way the
    language of the Admin UI writes them; the week starts on Monday in both languages.
  - Bundle keys: `calendar.*`, `events.*`, `opportunity.tabs.events`, `nav.calendar.label`,
    `actions.openCrmCalendar.*`, `notifications.eventReminder*`, three
    `auditLog.crm.opportunity.event_*` labels and five `history.field.*` labels are new in English
    and Polish.

  No third-party runtime dependency is added: the calendar is drawn by this package with `Date`
  and `Intl`. The package gains one peer dependency on a sibling,
  `@endora-commerce/email-components`, for the default body of the reminder e-mail.

  **Not in this release:** Events over several days and repeating Events; dragging on the Calendar
  or creating an Event from it; kinds, colours and participants; synchronisation with an external
  calendar; Events in webhooks, analytics, import or export.

  For an overlay that mounts this module's components: `OPPORTUNITY_TABS` has a seventh member,
  `events`, at index 2. Not part of the package's `exports`.

- ce0471f: A new module package, `@endora-commerce/mod-crm` (module id `crm`): sales opportunities with a
  configurable status workflow that linked orders follow. Backend and Admin UI. This is the
  module's first release.

  **What installing it does.** Thirteen `crm_`-prefixed tables and a default workflow of six
  statuses (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) arrive with the next
  migration run — three migrations. An instance that does not install it is unaffected. The module
  is optional: `crm.enabled`, on by default, switched on `/platform/modules`; while it is off
  every route answers `503 MODULE_DISABLED`, its screens, panels, permissions and settings are
  withdrawn, and nothing is deleted. It depends on `orders`, `organizations`, `sales_channels`,
  `catalog`, `assets_library`, `custom_fields`, `audit_logs` and the platform's account and
  settings modules, and degrades without `quote_requests`, `admin_notifications` and `webhooks`. One queue consumer,
  `crm-value-recalculation`. Peers: `fastify`, `@fastify/multipart`, MikroORM, `bullmq`,
  `ioredis`, `zod`, and — optional, for the admin layer only — `@endora-commerce/admin-kit`,
  `react`, `react-router-dom`, `lucide-react`. Its own demo data is three tags (`Key account`,
  `Upsell`, `Tender`); the demo sales pipeline that carries them is a step of
  `@endora-commerce/demo-composition`. `./backend` also exports `nextOpportunityNumber(em)`, the
  next `OPP-…` number from the module's sequence, for that step.

  **Permissions**, none granted to any role automatically: `crm:read`, `crm:write`,
  `crm:configure`, `crm:analytics`. `crm:read` advises `orders:read` and `custom_fields:read`.
  What another module owns is shown to somebody who may read it there: a linked or mentioned
  order needs `orders:read`, a quote request `rfqs:handle`, a mentioned product `catalog:read`;
  without it the document is listed as unavailable and nothing of it is shown.

  **The API**, all under `/api/v1/admin/crm`, tenant-scoped throughout (an opportunity of an
  organization the caller may not see answers `404 CRM_OPPORTUNITY_NOT_FOUND`):

  - **Workflow** — `GET /workflow`; `POST|PATCH|DELETE /statuses`; `PUT /transitions`;
    `PUT /order-status-mappings` (both directions); `PUT /value-counting-statuses` (answers 202
    and recalculates in the background). A change that would break the workflow answers
    `422 CRM_WORKFLOW_INVALID` naming the rule in `details.rule`.
  - **Opportunities** — list (search, filters by state, status, organization, assignee, tags,
    sales channel, creation date; sorting; cursor paging), create, read, `PATCH` under
    `If-Match` (409 for a stale version, 400 for a header that is not one), delete
    (`crm:configure`), `POST …/transition`, `POST …/assign`, `PUT …/tags`.
  - **Linked documents** — `POST|PATCH|DELETE …/links` for orders and quote requests. A document
    belongs to at most one opportunity, of its own organization.
    `GET /documents/:kind/:id/opportunity` answers the opportunity a document is linked to.
  - **Orders follow, and lead.** A move asks every linked order that follows the opportunity to
    enter the mapped order status, through the Orders module's own transition rules, after the
    opportunity's change has committed. A refusal is not an error: the response is 200, the
    opportunity has moved, and each order's outcome is in `propagation`, addressed afterwards by
    `…/propagations/:id/retry` and `…/dismiss`. In the other direction a linked order reaching
    a mapped status moves its opportunity through the opportunity's own workflow; a closed
    opportunity is never reopened, and the two directions do not loop.
  - **Value** — entered by hand, or computed from linked orders (gross total) and quote requests
    (net sum of lines) in a counting status; one currency, nothing converted, documents left out
    listed in `excludedDocuments`.
  - **Tags** (`/tags`), **notes and internal messages** (`…/comments`: a note is its author's to
    edit or delete, a message is immutable), **attachments** (`…/attachments/upload` under
    `crm:write` alone, stored in the media library as a private file, at most 25 MB, active
    content refused; attaching an existing library file by id also needs `assets.read`).
  - **Change history** — `GET …/history`, read from the platform's audit trail under `crm:read`,
    reaching back 499 entries and answering `truncated: true` on its last page when there are more;
    the text of a note or a message is never in it, and the tab shows every audited value in
    words — custom field values under the fields' own labels, an order status by name to a
    reader holding `orders:read`.
  - **References** — `[[product:<uuid>]]`, `[[order:<uuid>]]` and `[[admin_user:<uuid>]]` in a
    description, note or message are resolved into `references` beside the text — and beside a
    description in the change history. A mentioned person is named and never linked.
  - **Mentions** — in the Admin UI, typing `@`, `@@` or `@@@` in those fields opens a search
    of people, the organization's orders or products at the caret and inserts the choice. The
    field shows every reference by its name while it is being written or edited, never the
    token; what is stored and sent is the token text, unchanged. A person newly mentioned in a
    saved text gets one bell entry, `crm.opportunity.mention`, naming the opportunity by number
    and the author by name; never the author themself, nobody without `crm:read`, nobody who
    cannot see the organization.
  - **Bell entries in the reader's language** — the three kinds the module records
    (`crm.opportunity.assigned`, `crm.opportunity.message`, `crm.opportunity.mention`) carry a
    `titleMessage` in the `crm` bundle (`notifications.*.title`, English and Polish) beside the
    English `title`, so the Admin UI shows each reader their own language and falls back to the
    English sentence while the module is switched off. The params are the opportunity's number
    and, for a mention, the author's name — nothing the sentence does not already say.
  - **Board** — `GET /board`: a column per status with count, value totals per currency and the
    first cards.
  - **Analytics** (`crm:analytics`) — five live reads under `/analytics/`: handling time, time
    in status, rep effectiveness, top opportunities, average value. Per currency, UTC.
  - **Lookups** — `/lookups/organizations`, `/sales-channels`, `/assignees`, `/contacts`,
    `/mentionable`, `/quote-requests`, so the module's pickers need no permission of the modules that own those
    rows.

  **Automatic creation**, both off by default: `crm.auto_create_from_orders` (per sales channel)
  and `crm.auto_create_from_quote_requests`. A document created from within an opportunity — the
  _Create order_ and _Create quote request_ buttons, carried as an `origin` on the owner's create
  request — is linked to that opportunity and gets none of its own.

  **An order placed from a linked quote request joins the opportunity by itself**
  (`linkSource: "quote_conversion"`), whether the opportunity is open or closed, and such a pair
  is counted once in a computed value — the order's figure, not the two added. It relies on the
  order recording the quote request it was placed from, which `@endora-commerce/mod-orders` does
  from the same release.

  **The Admin UI** (`./admin`, `./tailwind.css`): a "CRM" sidebar section with _Opportunities_,
  _Board_, _Analytics_, _Tags_ and _Workflow_; the create screen and the opportunity's own screen
  with _Overview_, _Notes_, _Messages_, _Attachments_ and _Change history_; four command-palette
  actions (`open-opportunities`, `new-opportunity`, `open-opportunity-board`,
  `open-crm-analytics`); and three panels contributed to other modules' screens — _Open
  opportunities_ on an organization, _Linked opportunity_ on an order and on a quote request.
  The board moves a card by dragging (mouse, touch, keyboard) or from the card's "Move to…"
  menu. English and Polish.

  **For other modules.** Events: `crm.opportunity.created.v1`, `…status_changed.v1`,
  `…closed.v1` (these three are also offered as outbound webhooks), `…assigned.v1`,
  `…document_linked.v1`, and per transition `crm.opportunity.status.from_<x>_to_<y>.before`,
  `…from_<x>.before`, `…from_<x>_to_<y>.after`, `…to_<y>.after`. Container names:
  `opportunityReadPort`, `opportunityTransitionPort` (both fail closed while the module is off)
  and `opportunityTransitionGuardRegistry`, into which a module pushes a guard that may refuse a
  move by throwing `OpportunityTransitionVetoError`. The module contributes to the registries of
  `sales_channels` (attribution), `assets_library` (an attached file cannot be deleted from the
  library), `audit_logs` (recent activity names an opportunity), `custom_fields` (the
  `opportunity` host type) and `webhooks`.

  The module's documentation page, `docs/crm.md`, describes all of it for an operator and for a
  developer.

### Patch Changes

- bcd577c: The Sales Opportunity screen is laid out anew: a header and, under it, a stage bar and tabs
  beside a card of facts. Nothing about the API changes, and no action the screen had is gone.

  - **Stage bar.** It names the current status and shows only the statuses the workflow allows a
    move to from it — the Opportunity's own `allowedTransitions` — sorted into **Back** (an earlier
    status in the operator's order, and reopening) and **Forward** (a later status, and every
    closing one). It lists no other status, marks none as completed and counts no stage: the
    workflow is a graph. For a holder of `crm:write` each move is a button that performs the same
    `POST …/transition`, with the same optional reason, as the status buttons it replaces; a
    reader sees the moves as text. `GET /api/v1/admin/crm/workflow` (`crm:read`) is read only to
    order two open statuses; when that read fails every move is still offered, the ones it could
    not place under a plain heading.
  - **A "Links" tab** (PL: "Powiązania") now holds _Linked orders_ and _Linked quote requests_,
    with the number of linked documents on its label. They are no longer on _Overview_.
  - **The selected tab is in the address**: `/crm/opportunities/:id?tab=links|notes|messages|attachments|history`.
    A bare address opens _Overview_, as before. The return address the module hands the Order and
    Quote Request create screens (`?created=…`) opens _Links_.
  - **A card of facts** in the right column, from the header down beside the stage bar and the
    tabs — value and deadline, customer and assignee, classification, record — replaces the
    _Details_ list of _Overview_. On a narrow screen it comes after the stage bar and before the
    tabs. The value's mode, the
    assignee and the tags are still changed in place; everything else through **Edit**, which moved
    to the header.
  - What became of the linked Orders after a status change is shown under the stage bar on every
    tab.
  - Bundle keys: `opportunity.stage.*`, `opportunity.facts.*`, `opportunity.tabs.links`,
    `opportunity.tabs.label`, `opportunity.field.number`, `opportunity.field.closed` and
    `opportunity.description.empty*` are new in English and Polish; `opportunity.detail.subtitle`,
    `opportunity.status.current` and `opportunity.status.moveTo` are removed.

  For an overlay that mounts this module's components: `components/StatusControl` is replaced by
  `components/StageBar` (same props), and `OpportunityTabProps` gains `orderStatuses`, `editing`
  and `onEditingChange`. Neither is part of the package's `exports`.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/email-components@0.104.0
