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

## Server-side tagging (Principle X)

When `server_side_enabled` is on for a channel, the browser posts events to
`POST /api/v1/storefront/google-analytics/collect` instead of sending them to
Google directly (no client/server double count). The route is a pure producer —
it validates and enqueues one job per event onto the durable BullMQ queue
`google_analytics.ss.deliver`. A separable worker (co-located in the API process
unless `BACKEND_ROLE=api`, then only in the `worker` process) forwards each event
to the channel's GA4 destination via the Measurement Protocol, retrying on
failure. Each event carries a stable `eventId` idempotency key.

## Permissions

`google_analytics:read` and `google_analytics:write` gate the admin surface
(custom-events CRUD). Per-channel Settings are managed through the generic
Settings admin screen.
