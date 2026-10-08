---
'@endora-commerce/mod-crm': patch
---

The Admin UI for Events on a Sales Opportunity and for the CRM Calendar (User Stories 21 and
22). The routes it calls are the ones the contract of `crm-events-calendar-contract.md`
describes; they ship with the backend half of this feature.

- **A Calendar screen**, `/crm/calendar` (`crm:read`), in the CRM group of the sidebar between
  *Board* and *Analytics* and in the command palette (`open-crm-calendar`). It shows the Events
  of the open Opportunities the reader may see, in four views — **Month** (a table, three
  Events a day and "+N more"), **Week** and **Day** (a time grid with an all-day row,
  overlapping Events side by side, and the current time on today) and **Agenda** (a list of the
  days that have Events) — with *Today*, *Previous* / *Next*, *Go to date* and a title naming the
  range. Every Event is a link to its Opportunity. The view, the date and *Mine / All* are in the
  address: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`. *Mine / All* is drawn
  from what the server says the reader may ask for; a Sales Rep gets no switch. Under 640 px the
  Calendar is the Agenda. The screen holds no write.
- **An "Events" tab** (PL: "Wydarzenia") on the Opportunity screen, third after *Links*, its label
  counting the Events that have not ended. It lists the Events — upcoming first, then past — with
  what became of each reminder in words, draws them on a calendar of that Opportunity alone, and,
  for a holder of `crm:write`, adds, edits and deletes them. The address
  `/crm/opportunities/:id?tab=events&event=<id>` — what a reminder and a Calendar entry link to —
  marks that Event. On a closed Opportunity the tab says its Events are off the Calendar and its
  reminders held.
- **The Event dialog**: name, all day, date, from and to, description, and *Remind me* with a
  time that is offered as the Event's start and follows it until it is edited by hand. It
  refuses an end that is not after the start and a reminder time that is not in the future
  before sending, and puts the server's own refusal (`details.field`, `details.rule`) under the
  field it is about.
- Times are shown in the browser's time zone, which the screen names; the week starts on Monday
  in both languages; an all-day Event is drawn on its date for every reader.
- Bundle keys: `calendar.*`, `events.*`, `opportunity.tabs.events`, `nav.calendar.label` and
  `actions.openCrmCalendar.*` are new in English and Polish.

No new runtime dependency: the calendar is drawn by this package with `Date` and `Intl`.

For an overlay that mounts this module's components: `OPPORTUNITY_TABS` has a seventh member,
`events`, at index 2. Not part of the package's `exports`.
