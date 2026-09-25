---
title: Meta Ads
description: Meta Pixel per sales channel, with the standard commerce events and optional custom events on top
---

# Meta Ads

Puts the **Meta Pixel** on the storefront per sales channel and reports Meta's standard commerce
events, with optional custom events on top.

Module id `meta_ads`.

## Configuration (Settings module)

All values live in the **Meta Ads** settings group and are overridable per sales channel.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `meta_ads.enabled` | boolean | `false` | Master switch for the channel. |
| `meta_ads.pixel_id` | string | `''` | Pixel ID from Events Manager. |
| `meta_ads.require_consent` | boolean | `true` | Gate all Meta behaviour on the cookie-banner decision. |

A channel is tracked only when the master switch is on **and** the Pixel ID is non-blank. A blank
Pixel ID is "not configured", never an error the visitor sees, so clearing it is a safe way to pause
a channel.

## Storefront behaviour

The Pixel loads asynchronously and never blocks the first paint. Nothing Meta-related runs — no
script, no cookie, no request — until the visitor accepts the cookie banner, unless the operator has
turned the consent requirement off. A visitor who accepts mid-session is tracked from that moment
without a reload.

Consent is the storefront's single decision, shared with Google Analytics and LinkedIn Ads, so there
is only ever one banner and one stored answer. Each platform gates independently: turning Meta on or
off does not affect the others.

## Standard events

These fire automatically for the storefront actions the platform already emits, with the parameters
Meta expects for catalogue matching and ROAS reporting:

| Storefront action | Meta event |
| --- | --- |
| Product viewed | `ViewContent` |
| Added to cart | `AddToCart` |
| Checkout started | `InitiateCheckout` |
| Order completed | `Purchase` |
| Added to quote request | `Lead` |
| Contact form submitted | `Lead` |
| Added to shopping list | *(none)* |
| Place Order clicked | *(none)* |

Names are fixed in code, not editable — Meta's optimisation and catalogue matching key off these
exact names, so renaming them would quietly downgrade your reporting.

## Custom events

Under **Admin → Meta Ads** you can report any of those storefront actions under your own event name
too — for example, "added to quote request" as `SubmitQuote` for a B2B-specific audience.

A custom event is **additive**: the standard event still fires, and yours fires beside it. It never
replaces the standard event, so adding an audience event cannot cost you your `Purchase` reporting.
The two actions with no standard event accept custom mappings, which is exactly what they are for.

A mapping can target one sales channel or all of them, and can be disabled without deleting it.

## Permissions

| Code | Grants |
| --- | --- |
| `meta_ads:read` | View custom events and the module page. |
| `meta_ads:write` | Create, edit, and delete custom events. |

Both appear on `/admin-roles`. Changes are audited with the acting operator.

## Not yet implemented

- **Conversions API (server-side reporting).** Browser pixels are heavily ad-blocked, so expect
  reported conversions to under-count until this lands. It needs an access token and an event ID
  shared with the browser event for deduplication, and is worth doing once for both ad platforms.
- **Conversion retraction** for refunded or cancelled orders.
