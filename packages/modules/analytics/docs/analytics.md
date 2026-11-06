---
title: Analytics
description: Storefront event ingest + admin aggregation + optional GA4 forwarder
---

# Analytics (`analytics`)

Append-only event log fed by the storefront and admin, plus a small
aggregation read path for the admin dashboard. An optional GA4 forwarder
mirrors each ingested event into Google Analytics when configured.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/analytics/events` | storefront / admin (no auth) | Ingest a batch of events (≤ 100) |
| `GET /api/v1/admin/analytics/summary` | admin (`analytics:read`) | Totals by type + per-day breakdown for a window |

## Event types

The Zod boundary accepts a fixed set:

- `product.viewed`, `category.viewed`
- `product.added_to_cart`, `cart.abandoned`
- `order.placed`
- `search.performed`, `filter.clicked`

Adding a new type is a single edit in
`packages/contracts/src/analytics.ts`.

## Ingest semantics

Storefront sends batches; the boundary Zod schema rejects an entire batch
if any event is malformed (storefront should not be allowed to drift the
type union). Per-event validation inside the service still runs in case a
property field is unexpected — those individual events are reported in the
response's `rejected` array and the rest of the batch lands.

The endpoint returns `202 Accepted` with `{ accepted, rejected[] }`. Each
stored row mirrors the request's `X-Request-Id` for cross-log correlation.

## Aggregation

`AnalyticsQueryService.summary({ from, to, salesChannelId? })` runs two
window-bounded queries (totals by type, daily totals by type) against the
`(occurred_at)` and `(type, occurred_at)` indexes. The dashboard never
queries an unbounded range.

## GA4 forwarder

`buildForwarderFromEnv(env)` returns:

- `Ga4Forwarder` — when both `ANALYTICS_GA4_MEASUREMENT_ID` and
  `ANALYTICS_GA4_API_SECRET` are set. Each ingest is fire-and-forget POSTed
  to GA4's Measurement Protocol; client_id is bucketed by sessionId →
  customerAccountId → organizationId → `'anonymous'` so GA4 sees coherent
  user journeys.
- `NoopForwarder` — otherwise. Ingest never blocks on a forwarder failure
  and the source events are durable in `analytics_events` regardless.

## Reporting time zone

The setting **Reporting time zone** (`analytics.reporting_time_zone`, in the
*Analytics* section of the settings screen) is the calendar reports count days
in: a report over a range of days takes each day from midnight to midnight in
this zone. It is an IANA time-zone name such as `Europe/Warsaw`, or `UTC`, the
default; a zone the runtime does not know is refused with `422`
`VALIDATION_FAILED`. Projects analytics count in it today, and CRM is to follow.

Other modules read it through the gated port `reportingTimeZonePort`
(`ReportingTimeZonePort` in `@endora-commerce/contracts`, `timeZone()`), never by
the setting's code. A reader declares the edge `degrades-without`, asks this
module's presence first and counts in `UTC` while Analytics is switched off.

## Entities

`AnalyticsEvent` — `type`, `occurredAt`, `recordedAt`, optional
`salesChannelId`, `customerAccountId`, `organizationId`, `sessionId`,
`properties` (JSONB), `requestId`.

## Extension points

- **New consumers** — implement the `AnalyticsForwarder` interface and
  register in the composition root (e.g. PostHog, Mixpanel, internal data
  warehouse).
- **Pre-aggregated rollups** — the dashboard query is fine at hundreds of
  thousands of events; for sustained million-event volumes, materialise a
  daily rollup table here and have the indexer fold inserts into it.
