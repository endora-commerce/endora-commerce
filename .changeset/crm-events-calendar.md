---
'@endora-commerce/mod-crm': minor
---

Events on a Sales Opportunity, their reminders, and a CRM Calendar (User Stories 21 and 22).
The module's page — `docs/crm.md`, sections *Events and reminders* and *The calendar* — is the
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
that moment; failing that — nobody assigned, or an assignee who is deactivated or can no longer
reach the Organization — to the person who added the Event, under the same tests; failing both,
to nobody. It is always written to the notification bell, and sent as an e-mail as well when
the recipient has made no request to the Admin UI in the last five minutes, or when
`admin_notifications` is switched off. It is delivered at most once; while its Opportunity is
closed or the module is switched off it waits; found more than 24 hours late it is not sent and
is reported as `missed`.

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
  *Board* and *Analytics*, and a fifth command-palette action, `open-crm-calendar`. Four views —
  **Month**, **Week**, **Day** and **Agenda** — with *Today*, *Previous* / *Next* and *Go to
  date*; every Event is a link to its Opportunity. The view, the date and *Mine / All* are in the
  address: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`. *Mine / All* is drawn
  from what the server says the reader may ask for. Under 640 px the Calendar is the Agenda. The
  screen holds no write.
- **An "Events" tab** on the Opportunity screen, third after *Links*, its label counting the
  Events that have not ended: the list — upcoming, then past — with what became of each reminder
  in words, a calendar of that Opportunity alone, and, for a holder of `crm:write`, adding,
  editing and deleting. `/crm/opportunities/:id?tab=events&event=<id>` — what a reminder and a
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
