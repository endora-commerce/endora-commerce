---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

The contract for Events on a Sales Opportunity and for the CRM Calendar. Additive throughout.
The routes that serve it and the screens that draw it are `@endora-commerce/mod-crm`'s, and
the port method is answered by `@endora-commerce/mod-auth`; each has a changeset of its own in
this release.

**`@endora-commerce/contracts` — `crm`.** The request and response shapes of five routes
(`GET`/`POST /opportunities/:id/events`, `PATCH`/`DELETE …/events/:eventId`,
`GET /calendar/events`):

- `CreateOpportunityEventRequestSchema` and `UpdateOpportunityEventRequestSchema` — a name of
  1 to 200 characters, an optional description of 5 000 at most, `allDay`, `startsAt` and
  `endsAt` as ISO 8601 instants with an offset, the IANA `timeZone` the times were chosen in,
  and an optional `remindAt`. The schema refuses what needs neither a clock nor zone data: an
  end that is not after the start, and a span over `OPPORTUNITY_EVENT_MAX_SPAN_HOURS` (25).
  The update is the same members, all optional, and strict.
- **Every instant of these shapes** — `startsAt`, `endsAt`, `remindAt`, and `from` and `to` of
  `CalendarEventsQuerySchema` — must lie in `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`, the
  end excluded. A four-digit year as written is not enough: an offset carries
  `9999-12-31T22:00:00-14:00` into the year 10000, which PostgreSQL refuses. Outside the range
  the schema refuses, so the routes answer 400.
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
