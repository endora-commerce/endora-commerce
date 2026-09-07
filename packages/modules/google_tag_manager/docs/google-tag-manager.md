---
title: Google Tag Manager
description: Google Tag Manager containers per sales channel, with a documented commerce dataLayer and an optional server-side relay
---

# Google Tag Manager

The `google_tag_manager` module (feature 066) puts your **GTM container** on the storefront, one per
sales channel, and publishes a documented commerce `dataLayer` vocabulary for your tags to trigger
on. It can also relay those events from the platform's backend to your **server-side GTM container**.

## What this module does, and what it does not

Google Tag Manager is a *tag container*, not a measurement product. Every tag, trigger and variable
lives in the Google Tag Manager console, outside this platform. So the module's job is narrow on
purpose:

**It does:**

- load the right container on the right channel's storefront, behind the storefront's single consent
  decision;
- publish a stable, documented set of commerce events onto `window.dataLayer`;
- optionally deliver the relay-eligible subset of those events to your server container, durably and
  exactly once.

**It does not:**

- model, mirror or manage your tags, triggers or variables — those stay in the GTM console;
- own a database table or an admin page of its own. Its whole configuration is six settings on the
  generic Settings screen;
- decide anything about which vendors your container talks to.

## Configuration (Settings module)

All values live in the **Google Tag Manager** settings group and are overridable per sales channel.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `google_tag_manager.enabled` | boolean | `false` | Master switch for the channel. |
| `google_tag_manager.container_id` | string | `''` | Container ID, `GTM-XXXXXXX`. Blank ⇒ the channel is untracked. |
| `google_tag_manager.require_consent` | boolean | `true` | Start the container under Consent Mode v2 denied and send no platform events until the visitor accepts. |
| `google_tag_manager.server_side_enabled` | boolean | `false` | Relay commerce events from the backend to your server container. |
| `google_tag_manager.server_container_url` | string | `''` | Base URL of your server container, e.g. `https://sgtm.example.com`. |
| `google_tag_manager.server_ingest_path` | string | `/data` | Request path your container's ingest client claims. |

A channel is tracked only when the master switch is on **and** the container ID has the `GTM-…`
shape. A blank or malformed ID means "not configured", never a broken script tag, so clearing it is
a safe way to pause a channel. Configuration changes reach the storefront immediately — no redeploy,
no cache wait.

There is no admin page: six settings and no rows of its own means the generic Settings screen already
does everything a bespoke page could. Under the command palette, "Google Tag Manager" lands there.

## Double counting with the native Google Analytics module

> **Do not run a GA4 tag inside your container *and* the platform's Google Analytics module on the
> same channel.** Both report the same shopping actions, so every metric doubles.

The platform cannot detect this: the GA4 tag lives in your container, where the platform has no
visibility. It also does not enforce mutual exclusion — the two integrations stay independent
switches and the choice is yours. Pick one measurement path per channel:

- **GTM as the single path** — turn the platform's Google Analytics module off for the channel and
  build your GA4 tag in the container. GTM tracking is unaffected by that switch.
- **The native module as the single path** — keep GTM for everything that is not GA4.

## Storefront behaviour

The container loads with `next/script` on `afterInteractive`, so it never blocks the critical
rendering path. The standard `<noscript>` iframe fallback is rendered too, so the container is
reachable without JavaScript.

### Consent

Consent is the storefront's single decision, shared with Google Analytics, LinkedIn Ads and Meta
Ads: one banner, one stored answer. The banner is shown whenever **any** enabled integration on the
channel requires consent — including when Google Tag Manager is the only one enabled.

With `Require analytics consent` on:

1. before the container loads, the page publishes Consent Mode v2 defaults of `denied` for
   `analytics_storage`, `ad_storage`, `ad_user_data` and `ad_personalization`;
2. the container itself **is** loaded. A container is not a tag: withholding it would silently
   disable every tag you built, including ones that never needed consent;
3. the platform pushes **no events of its own** — no page views, no commerce events, no relay —
   until the visitor accepts;
4. accepting mid-session delivers a Consent Mode `update` to the container and starts the platform's
   events flowing, with no page reload.

> **Consent Mode governs Google tags, not everyone else's.** Google's own tags read the consent state
> and withhold storage and identifiers automatically. A Meta, LinkedIn or custom HTML tag in your
> container **fires regardless** unless you add an **additional consent check** to it in the GTM
> console. The platform cannot see or enforce that — it is your obligation.

## The event vocabulary

Trigger your tags on these custom events. The `items` parameter is a **JSON string** using the GA4
recommended item shape (`item_id`, `item_name`, `price`, `quantity`), because virtually every
container maps it to a GA4 tag.

| Event | Parameters | Relay-eligible |
| --- | --- | --- |
| `page_view` | `page_path`, `page_location`, `page_title` | yes |
| `view_search_results` | `search_term` | yes |
| `view_item` | `currency`, `value`, `items` | yes |
| `add_to_cart` | `currency`, `value`, `items` | yes |
| `add_to_quote_request` | `currency`, `value`, `items` | yes |
| `add_to_shopping_list` | `items` | yes |
| `begin_checkout` | `currency`, `value`, `items` | yes |
| `place_order_clicked` | the checkout submission fields | yes |
| `purchase` | `transaction_id`, `value`, `currency`, `items` | yes |
| `contact_form_submitted` | the contact-form field values | yes |

Event payloads carry scalar values only, so an uploaded file or attachment can never appear in one.

> **Trigger `page_view`, not History Change.** The storefront pushes exactly one `page_view` per
> destination, including navigations that do not reload the document. If your container also uses
> GTM's built-in History Change trigger you will count every navigation twice.

### Client-only events

These are **not** published by the platform and have no server-side path, by design:

| Trigger | Why the platform cannot reconstruct it |
| --- | --- |
| Scroll depth | Depends on viewport size and live scroll position. |
| Outbound link clicks | Needs the clicked element and the live DOM. |
| File downloads | Needs the clicked link's href and text. |
| `form_start` / `form_submit` | DOM interaction timing; `form_start` has no server-observable moment at all. |
| Element visibility | `IntersectionObserver` state, internal to the container. |
| Timers | Wall-clock dwell time in the browser session. |
| `gtm.js`, `gtm.dom`, `gtm.load`, history change | Generated by the container itself. |

There is nothing to configure here, and nothing is lost: the container stays loaded in the browser
even when server-side tagging is on, so its own triggers keep handling all of them. The backend
ingest rejects any event name outside the relay-eligible list, so a crafted request cannot give a
client-only event a server path either.

## Server-side tagging

With `Server-side tagging` on and a server container URL configured, the ten events above stop being
pushed to the browser `dataLayer` and are delivered from the platform's backend instead. Each
logical event is reported exactly once — never both ways.

> **This *moves* those events out of the web container.** Tags that triggered on them in the web
> container must be rebuilt in the **server** container. Everything configured inside the web
> container that observes the browser — scroll depth, link clicks, file downloads, form interaction,
> element visibility, timers — is unaffected and keeps firing.

A blank `Server container URL` keeps the channel on the browser path even with the switch on, so
turning the switch on first is harmless.

### How delivery works

The storefront posts to `POST /api/v1/storefront/google-tag-manager/collect`, which is a **pure
producer**: it validates the batch and enqueues one job per event onto the durable BullMQ queue
`google_tag_manager.ss.relay`, then answers `202`. No outbound call happens inside the shopper's
request, so a slow or failing container can never affect the shop.

A separable worker (co-located in the API process unless `BACKEND_ROLE=api`, in which case only the
`worker` process runs it) posts each event to your container and retries on failure: eight attempts
with exponential backoff from one second. Exhausted deliveries are retained as failed jobs so they
are observable rather than silently dropped.

### The request your container receives

```
POST {server_container_url}{server_ingest_path}
Content-Type: application/json
```

```json
{
  "event_name": "purchase",
  "client_id": "1234567890.1754006400",
  "event_id": "6b1f0ec4-0000-4000-8000-000000000001",
  "page_location": "https://shop.example.com/checkout/thank-you",
  "page_referrer": "https://shop.example.com/checkout",
  "page_title": "Thank you",
  "language": "pl",
  "consent": { "analytics_storage": "granted" },
  "ip_override": "203.0.113.7",
  "user_agent": "Mozilla/5.0 ...",
  "transaction_id": "ORD-2026-000123",
  "value": 1249.0,
  "currency": "PLN",
  "items": "[{\"item_id\":\"SKU-9\",\"item_name\":\"Widget 9\",\"price\":249,\"quantity\":5}]",
  "gtm_event_id": "6b1f0ec4-0000-4000-8000-000000000001"
}
```

The event's own parameters are flattened at the top level. `client_id`, `ip_override` and
`user_agent` deliberately reuse the GA4 Measurement Protocol field names, which server-side GTM's
clients already recognise, so you write no translation layer. No credentials are sent: an sGTM
ingest endpoint is a public collection endpoint by design.

### What you have to do on your side

1. **Claim the configured request path.** Google's **Data Client** claims `/data` by default; a
   custom client can claim any path, in which case set `Server container ingest path` to match.
2. **Rebuild the tags** that triggered on the platform's commerce events, in the server container.
   Those events no longer reach the web container.
3. **Parse `items` as JSON** — it arrives as a string, not an array.
4. **Deduplicate on `event_id`** (also present as `gtm_event_id`). It is stable across retries, so a
   redelivery carries the same value.
5. **Handle a missing IP and user agent.** When the visitor denied consent, `ip_override` and
   `user_agent` are omitted entirely, so geo and device enrichment is not always possible.

### What the relay never carries

Only the documented commerce parameters, page context, client id, consent state and event id. No
`user_id`, no e-mail address, no organization id, no postal address, no hashed identifiers, and
never a file attachment. Enhanced conversions and user-id stitching are deliberately out of scope —
add whatever your container needs, in your container.

## Permissions

The module declares **no permission codes of its own**. Its configuration is reached through the
generic Settings screen and is therefore gated by the core `settings:read` / `settings:write`
permissions, and audited by the Settings module.

## Not yet implemented

- **Serving `gtm.js` first-party from the server container.** Attractive for cookie lifetime and
  ad-blocker resilience, but a mis-provisioned server container would turn a delivery setting into a
  total tracking outage. It needs its own setting and its own acceptance test.
- **`user_id` and enhanced conversions in the relay** — each needs its own consent and hashing
  analysis.
