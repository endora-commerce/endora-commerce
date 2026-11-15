---
'@endora-commerce/contracts': minor
---

Analytics figures name the time zone their days were counted in (issues #474, #475). Additive:
a reply without the field parses as before.

- `projectAnalyticsEnvelope` gains an optional `timeZone` (an IANA name, such as `Europe/Warsaw`
  or `UTC`) beside `from`, `to`, `projectCount` and `excluded`, so every
  `ProjectAnalytics*ResponseSchema` accepts it.
- New `opportunityAnalyticsEnvelope(data)` — `{ data, timeZone? }`. The five CRM analytics
  response schemas (`OpportunityHandlingTimeResponseSchema`,
  `OpportunityTimeInStatusResponseSchema`, `OpportunityRepEffectivenessResponseSchema`,
  `TopOpportunitiesResponseSchema`, `OpportunityAverageValueResponseSchema`) are built with it;
  `data` is unchanged.
