---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-crm': patch
---

What an independent review of Events, reminders and the CRM Calendar changed, before any of
it was released.

**`@endora-commerce/contracts` — `crm`.** The five instants of the Event and Calendar routes —
`startsAt`, `endsAt` and `remindAt` of `CreateOpportunityEventRequestSchema` and
`UpdateOpportunityEventRequestSchema`, `from` and `to` of `CalendarEventsQuerySchema` — are
held to `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`, the end excluded. A four-digit year
as written was not enough: an offset carries `9999-12-31T22:00:00-14:00` into the year 10000,
which PostgreSQL refuses, and the request ended in a 500. It is a 400 now. No other shape
changes.

**`@endora-commerce/mod-crm`.**

- **Who is reminded.** The recipient of an Event reminder — the Opportunity's assignee, else
  the Event's creator — must hold `crm:read` as well as be active and reach the Opportunity's
  Organization. A person whose role lost the permission is passed over, as one who lost the
  Organization already was.
- **A reminder that changes while it is being sent.** An Event deleted, or a reminder removed
  or moved, after the sweep claimed it and before its turn is no longer delivered. A reminder
  that was delivered is recorded as delivered however long the pass took; `interrupted` is
  left only on a claim whose process died. `EventReminderSweepSummary` gains `withdrawn`.
- **A long Event name.** The bell stores a title of at most 255 characters; a reminder for an
  Event whose name is longer than about 190 characters used to fail on every pass and end as
  `missed`. The stored English sentence is cut to fit (`bellTitle`, `BELL_TITLE_MAX_LENGTH`);
  the translated sentence is built from the params and keeps the name whole.
- **One line.** A reminder says the Event's name with its line breaks collapsed
  (`reminderEventName`), in the bell sentence and in the subject of the e-mail.
- `allDayDate` of an Event before the year 1000 is `YYYY-MM-DD` with its leading zeros.
- **How a reminder says when.** `event.when` of the `crm_event_reminder` e-mail and the `when`
  param of the bell entry are worded in the recipient's Admin UI language, in the Event's own
  zone: `8 października 2026, 18:42 (Europe/Warsaw)`, `October 8, 2026, 6:42 PM
  (Europe/Warsaw)`; the date alone for an all-day Event. It was `2026-10-08 18:42
  Europe/Warsaw`. An operator's edited template keeps working — the variable is the same.
- **Wording.** The dialog's checkbox reads *Set a reminder* / *Ustaw przypomnienie* (was
  *Remind me* / *Przypomnij mi*), and its hint says that with nobody assigned the Event's
  author is reminded.
