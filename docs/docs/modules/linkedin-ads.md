---
title: LinkedIn Ads
description: LinkedIn Insight Tag per sales channel, reporting storefront actions against Campaign Manager conversion rules
---

# LinkedIn Ads

Puts the **LinkedIn Insight Tag** on the storefront per sales channel and reports storefront
actions against conversion rules defined in LinkedIn Campaign Manager.

Feature `063-linkedin-ads`. Module id `linkedin_ads`.

## Configuration (Settings module)

All values live in the **LinkedIn Ads** settings group and are overridable per sales channel.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `linkedin_ads.enabled` | boolean | `false` | Master switch for the channel. |
| `linkedin_ads.partner_id` | string | `''` | Insight Tag Partner ID from Campaign Manager. |
| `linkedin_ads.require_consent` | boolean | `true` | Gate all LinkedIn behaviour on the cookie-banner decision. |
| `linkedin_ads.server_side_enabled` | boolean | `false` | Reserved for Conversions API reporting (not yet implemented). |
| `linkedin_ads.access_token` | secret | `''` | Conversions API token. Encrypted at rest, write-only — it is never returned by any API. |

A channel is tracked only when the master switch is on **and** the Partner ID is non-blank. A blank
Partner ID is treated as "not configured", never as an error the visitor can see, so clearing the
field is a safe way to switch a channel off.

## Storefront behaviour

The Insight Tag is injected client-side, after interaction, so it never blocks the first paint.
Nothing LinkedIn-related runs — no script, no cookie, no request — until the visitor accepts the
cookie banner, unless the operator has turned the consent requirement off for that channel. A
visitor who accepts mid-session is tracked from that moment without a page reload.

Consent is the storefront's single decision, shared with Google Analytics, so there is only ever
one banner and one stored answer.

## Conversion mappings

Define your conversions in Campaign Manager first; each gets a numeric conversion ID. Then map
storefront actions to those IDs under **Admin → LinkedIn Ads**.

Supported actions: product viewed, added to cart, added to quote request, added to shopping list,
checkout started, Place Order clicked, order completed, contact form submitted. The list is exactly
what the storefront emits — you cannot map an action that could never fire.

A mapping can target one sales channel or all of them, and can be disabled without deleting it. An
action with no enabled mapping simply reports nothing — that is a normal state, not a
misconfiguration. One action may map to several conversion IDs; each reports once.

Mappings are served to the storefront through a cached per-channel config; creating, editing, or
deleting one revalidates that cache immediately rather than waiting for the TTL.

## Permissions

| Code | Grants |
| --- | --- |
| `linkedin_ads:read` | View conversion mappings and the module page. |
| `linkedin_ads:write` | Create, edit, and delete conversion mappings. |

Both appear on `/admin-roles`. Mapping changes are audited with the acting operator.

Conversions are reported from the browser via `lintrk`, and only when the visitor has consented.
An action mapped more than once reports once per mapping.

## Not yet implemented

- **Server-side reporting through the Conversions API.** Specified and settings-ready, so enabling
  it later needs no contract change; `linkedin_ads.server_side_enabled` stays off. When it is
  turned on, the browser path for mapped conversions is suppressed so each conversion has exactly
  one transport. See `specs/063-linkedin-ads/tasks.md` Phase 5.
- **Conversion retraction** for refunded or cancelled orders.
