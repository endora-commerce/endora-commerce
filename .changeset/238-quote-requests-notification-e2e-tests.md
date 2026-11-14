---
---

Test-only: two integration files walk the quote request notification matrix end to end (every change, side and channel, against an Organization holding a requester, an Administrator member, a Member, an assigned representative and an administrator without `rfqs:handle`) and the off states a notification can meet (each receiving module off in turn, and `quote_requests` itself off with its delivery worker idle and resuming, a record over 24 hours old closing stale) — `specs/179-rfq-and-customer-notifications/` WP-12, issue #238. The spec's header bell rationale now words the badge's accessible name as FR-051b does. No package publishes anything new.
