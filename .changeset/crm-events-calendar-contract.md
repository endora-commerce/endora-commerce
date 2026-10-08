---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-auth': patch
---

The contract for Events on a Sales Opportunity and for the CRM Calendar, ahead of the routes
that will serve it and the screens that will draw it. Additive throughout; no route is added
by this change.

**`@endora-commerce/contracts` — `crm`.** The request and response shapes of five routes to
come (`GET`/`POST /opportunities/:id/events`, `PATCH`/`DELETE …/events/:eventId`,
`GET /calendar/events`):

- `CreateOpportunityEventRequestSchema` and `UpdateOpportunityEventRequestSchema` — a name of
  1 to 200 characters, an optional description of 5 000 at most, `allDay`, `startsAt` and
  `endsAt` as ISO 8601 instants with an offset, the IANA `timeZone` the times were chosen in,
  and an optional `remindAt`. The schema refuses what needs neither a clock nor zone data: an
  end that is not after the start, and a span over `OPPORTUNITY_EVENT_MAX_SPAN_HOURS` (25).
  The update is the same members, all optional, and strict.
- `OpportunityEventSchema` — the stored Event, with `allDayDate` computed by the server and a
  `reminder` of `{ at, state, handledAt, channels }` or `null`.
  `opportunityEventReminderStateSchema` names the seven states and
  `opportunityEventReminderChannelSchema` the two channels; `channels` is non-empty exactly
  when the state is `sent`.
- `opportunityEventRuleSchema` — the five reasons a well-formed Event is refused with 422
  `VALIDATION_FAILED` (`details.rule`).
- `CalendarEventsQuerySchema` (`from`, `to`, an optional `scope` of `mine` or `all`; a range
  of `CALENDAR_EVENTS_MAX_RANGE_DAYS`, 45, at most), `CalendarEventSchema` — what a calendar
  draws, without the description — `CalendarEventsMetaSchema` and
  `CalendarEventsResponseSchema`; `CALENDAR_EVENTS_MAX_RESULTS` (500).
- `OpportunityDetailSchema` gains `upcomingEventCount`, a non-negative integer.

**`@endora-commerce/contracts` — `auth`.** `AuthSessionReadPort` gains
`lastSeenByAdminUser(adminUserIds, since)` and the type `AuthAdminLastSeen`, the twin of
`lastSeenByCustomerAccount`. **An implementer or a test double of this port outside the
repository must add the method to keep compiling.**

**`@endora-commerce/contracts` and `@endora-commerce/admin-kit`.** `CalendarDays` joins the
admin icon allowlist: `KnownIconNameSchema` gains the name and `resolveIcon` maps it to the
lucide component, the pair a declared icon needs in one change.

**`@endora-commerce/mod-crm`.** `GET /api/v1/admin/crm/opportunities/:id`, and every answer
shaped like it, carries `upcomingEventCount: 0`. An Opportunity has no Events yet, so zero is
the count.

**`@endora-commerce/mod-auth`.** `AuthSessionReadService` declares `lastSeenByAdminUser` and
rejects when it is called: the answer needs administrator sessions to record when they were
last seen, which they do not do yet. Nothing in the repository calls it.
