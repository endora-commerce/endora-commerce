---
title: Google Analytics
description: Google Analytics 4 for the storefront — per-channel Measurement ID, Enhanced Ecommerce, a custom-events builder and optional server-side tagging
---

# Google Analytics

The `google_analytics` module (feature 049) integrates the storefront with
**Google Analytics 4**: per-Sales-Channel activation and Measurement ID,
Enhanced Ecommerce, an admin-configurable custom-events builder, and an optional
**server-side tagging** delivery path. It is a separate module from the legacy
internal `analytics` event log and supersedes that module's env-gated GA4
forwarder.

## Configuration (Settings module)

All per-channel configuration lives in the Settings module under the
`google_analytics.*` group (global value + per-channel override):

| Setting | Type | Meaning |
| --- | --- | --- |
| `google_analytics.enabled` | boolean | Master switch (per-channel overridable). |
| `google_analytics.measurement_id` | string | GA4 `G-XXXXXXXXXX`. Blank ⇒ channel untracked. |
| `google_analytics.enhanced_ecommerce_enabled` | boolean | Emit GA4 ecommerce events. |
| `google_analytics.server_side_enabled` | boolean | Route events through the server-side worker. |
| `google_analytics.server_side_endpoint` | string | Server-side GTM container URL (blank ⇒ GA4 Measurement Protocol). |
| `google_analytics.server_side_api_secret` | secret | Measurement Protocol API secret (needs `SETTINGS_SECRET_ENCRYPTION_KEY`). |
| `google_analytics.require_consent` | boolean | Load GA in Consent Mode v2 denied-by-default until consent is granted. |

A channel with a blank Measurement ID emits nothing, regardless of the master
switch.

## Storefront behaviour

- `gtag.js` is injected with `next/script` (`afterInteractive`, Core-Web-Vitals
  safe) and initialized with `send_page_view: false`.
- A `page_view` is emitted on every App-Router navigation (initial load plus
  each client-side route change) — exactly one per destination.
- **Consent Mode v2**: when `require_consent` is on, GA starts in the denied
  default. A cookie banner drives `updateAnalyticsConsent(granted)` to flip to
  granted. (This module provides the consent plumbing, not a full cookie
  banner.)
- **Enhanced Ecommerce** (when enabled): `view_item` (product page),
  `add_to_cart`, `begin_checkout` (checkout), and `purchase` (order-confirmation
  page).

## Custom events

Admins define custom events on the `/google-analytics` admin screen. Each event
has a name (GA4 event-name shape), a trigger action, and a selected subset of
the fields available for that action:

| Trigger action | Available fields |
| --- | --- |
| `contact_form_submitted` | all contact-form fields **except file uploads** |
| `place_order_clicked` | the checkout submission fields |
| `add_to_cart` / `add_to_quote_request` / `add_to_shopping_list` | `sku`, `name`, `price`, `quantity` |
| `button_click_by_id` | the originating page + the button's `data-*` attributes (requires a button ID) |

Only the selected fields are sent; absent fields are omitted (never blocking the
event). File uploads are never included. Custom events may be scoped to one
channel or all channels, and multiple events may bind to the same action.

> The storefront has no contact form yet; the `contact_form_submitted` trigger
> ships as a client hook (`trackContactFormSubmit`) that becomes active once a
> contact form is added.

## Server-side tagging (pure Measurement Protocol, Principle X)

When `server_side_enabled` is on for a channel the module runs **pure
server-side tagging through the platform's own server** — no external container
and no browser-side Google library:

- **gtag.js is not loaded.** Every event (page_view, Enhanced Ecommerce, custom)
  is posted to `POST /api/v1/storefront/google-analytics/collect`, so **no hit
  reaches Google directly from the browser** (best ad-blocker resilience, no
  client/server double count).
- The route is a **pure producer** — it validates and enqueues one job per event
  onto the durable BullMQ queue `google_analytics.ss.deliver`. A separable worker
  (co-located in the API process unless `BACKEND_ROLE=api`, then only in the
  `worker` process) forwards each event to GA4 via the **Measurement Protocol**,
  retrying on failure. Each event carries a stable `eventId` idempotency key.
- **GA4 default metrics come for free.** The browser owns a first-party
  `client_id` and a rolling 30-minute `session_id` (cookies only once consent is
  granted; ephemeral in-memory before that) and sends `engagement_time_msec` with
  every event, so GA4 auto-derives `first_visit`, `session_start`, sessions, and
  active users from the MP stream.
- **Optional destination override.** By default the worker sends to GA4's
  Measurement Protocol endpoint. Set `server_side_endpoint` to route events to a
  different collection URL instead (e.g. a self-hosted proxy or a server-side GTM
  container). The `server_side_api_secret` (a GA4 Measurement Protocol API
  secret, created under GA4 Admin → Data Streams → Measurement Protocol API
  secrets) authenticates delivery.
- **Consent** is carried in the MP payload (`analyticsStorage`) reflecting the
  visitor's actual banner decision.
- **Enhanced Measurement** is replicated in the browser (since gtag.js is not
  loaded) and routed through the server: `scroll` (90%), outbound `click`,
  `file_download`, `form_start` / `form_submit`, and `view_search_results` (site
  search). Video engagement is not covered — it would require a client-side
  YouTube-player integration. In client mode gtag.js emits all of these itself.

## Permissions

`google_analytics:read` and `google_analytics:write` gate the admin surface
(custom-events CRUD). Per-channel Settings are managed through the generic
Settings admin screen.
