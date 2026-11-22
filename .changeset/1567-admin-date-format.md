---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
---

The admin kit exports `formatDate(value, language)`, and `formatDateTime(iso, language)` takes the admin UI language: a medium date, and a moment as that date with the short time, never the browser's locale (UX audit #1567). The Opportunity sidebar's deadline and Record dates, the Projects date labels (the Project panel's Stage deadline among them) and the Tasks date labels use them, so one screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`. On the Opportunity sidebar the value stays on one line and the value-mode switch sits below it instead of squeezing it to one character per line.
