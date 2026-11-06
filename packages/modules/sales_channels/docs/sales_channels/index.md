---
title: Sales channels
sidebar_label: Sales channels
sidebar_position: 1
description: Channel registry, request resolver, bidirectional membership for every channel-scoped entity
---

# Sales channels

The Sales Channels module is the platform's stable handle for "where the sale happens". Every channel-scoped piece of platform data — products, categories, customers, orders, quotes, prices, promotions, CMS pages — is bound to one or more Sales Channels and is filtered through the channel context of the incoming request. The module owns the channel registry, the bidirectional membership service, the resolver middleware that maps every HTTP request onto exactly one channel, and the lifecycle guards that keep the platform from ending up with channel-less data.

## Concepts

- **Sales Channel** — a named place of sale (web storefront, marketplace, brick-and-mortar location, distributor portal). Carries a unique `code`, a multilingual display name, an optional logo and theme code, an ordered list of supported languages with a default, an ordered list of supported currencies with a default, and an `active` flag. Exactly one channel platform-wide carries `system_default = true` (enforced by a partial unique index).

- **System default channel** — the bootstrap channel created by the boot-time reconciler. It is the implicit owner of every channel-scoped entity created without an explicit channel selection. It is non-deletable and non-deactivatable. The env var `DEFAULT_SALES_CHANNEL_CODE` (default `default`) names the channel.

- **Membership** — the M:N relationship between a channel and a channel-scoped entity. Nine entity types are tracked: `product`, `category`, `payment-method`, `delivery-method`, `organization`, `tax`, `customer`, `promotion`, `cms-page`. (`inventory-location` is reserved for when the inventory module introduces that table.)

- **Open to anonymous visitors** — a per-channel flag (`anonymousAccess`, on by default). When it is off, the store serves signed-in customers only. Whether anonymous visitors see *prices* on an open store is not a channel flag: it is the pricing display mode for anonymous visitors (`pricing.unauthenticated_display_mode`), which can be set for one channel — `none` hides prices until sign-in. The channel's former `isPublic` flag, which hid prices from signed-in customers as well, was retired in its favour.

- **Customer access** — the Organizations a channel serves (the `organization` membership) are the channels that Organization's members may sign in to and shop in. No assignment means no access.

- **Attribution** — the M:1 relationship for Orders and Quote Requests. Each row is bound to exactly one channel at placement, and the binding is immutable for audit purposes.

- **At-least-one-channel invariant** — every channel-scoped entity is bound to at least one channel at all times. Removing the last membership of an entity is refused unless the caller passes `fallbackToDefault=true`, in which case the entity is rebound to the system default in the same transaction.

## Resolver — request → channel

A Fastify `onRequest` hook runs on every `/api/v1/*` request and resolves it to exactly one channel. Resolution order:

1. **`X-Sales-Channel: <code>` header** — explicit signal, always wins.
2. **`?salesChannel=<code>` query parameter** — storefront / integration paths only; ignored on `/api/v1/admin/*` to prevent cross-channel admin bleed.
3. **Host-based mapping** — env-configured `SALES_CHANNEL_HOST_MAP` (e.g. `serwisA.com=channel-a,serwisB.com=channel-b`).
4. **Fallback to the system default** — for storefront / integration paths only. Admin paths refuse with `MISSING_SALES_CHANNEL_CONTEXT` when `strictAdmin` is on (off by default during the initial rollout).

If a step matches a code that doesn't exist or whose channel is `active=false`, the request is refused with `UNKNOWN_SALES_CHANNEL` / `INACTIVE_SALES_CHANNEL`. The fallback never applies in those cases.

Every response carries `X-Sales-Channel: <resolvedCode>` so HTTP caches can `Vary` on it.

## Who may use a channel

Once a request is resolved to a channel, one rule decides whether the caller may use it:

| Caller | Accepted when | Otherwise |
|---|---|---|
| Anonymous visitor | the channel is open to anonymous visitors | `403 SALES_CHANNEL_SIGN_IN_REQUIRED` |
| Signed-in customer (also when an administrator is acting as the customer) | the channel is assigned to the customer's Organization | `403 SALES_CHANNEL_NOT_PERMITTED` |
| Administrator, API key | always — admin paths are not storefront calls, and an API key is already bound to its channel | — |

The refusal names the channel in `details.channelCode`, and the response still carries `X-Sales-Channel`, so a client can tell which store refused it. An unknown or inactive channel is refused first, as before.

A few routes stay reachable on every active channel, because their caller is not a shopper of the store or has to reach them to become one: sign-in, sign-out, password reset, e-mail verification, business registration, invitations, the channel identity reads, language configuration, the robots policy, product feeds and the newsletter links in e-mails. Individual (B2C) self-registration is not one of them: it signs the new account in at once, so on a store closed to anonymous visitors it is refused.

A sign-in is checked against the same rule after the password (or the external identity provider) has confirmed the account and before a session is created, so a customer whose Organization may not use the store is told so on the sign-in form and is not signed in. The storefront shows the three outcomes as a sign-in page with a notice, a sign-in form error, and a "No access to this store" screen listing the stores the account can use.

Assignments are kept in the channel's `organization` membership and are managed on the Organization's page in the admin. A change applies at once on the server that made it and on every server within 30 seconds. A new Organization gets the channel of the store it registered on; one created in the admin gets the channels chosen on its create form; any other creation path gets the system default. Accepting an invitation changes no assignment.

When this rule was introduced, every existing Organization was assigned the system-default channel and every channel it already had orders on, so existing customers kept their access.

## Language in storefront URLs {#language-in-urls}

A storefront URL names its language as its first path segment: `/pl/p/wiertarka`,
`/en/p/drill`, `/en/c/tools`. A URL therefore means one language for every visitor and every
search engine, whatever their browser or cookie says.

- **Prefixes are derived, never typed.** Each channel language gets the lower-case primary
  subtag (`pl`, `en`); when the channel has two variants of one language (`en-US`, `en-GB`)
  both get their full tag (`/en-us`, `/en-gb`), and the short `/en` keeps working by
  redirecting to one of them.
- **Prefix the default language in URLs** (per channel) decides whether the default
  language is prefixed too. **On** — every URL is prefixed and a URL without a prefix is
  redirected (307) to the language chosen by `?lang=`, then the `lang` cookie, then the
  browser's languages, then the default. **Off** — a URL without a prefix is the default
  language and is never redirected for language; `/<default prefix>/…` answers a permanent
  redirect (308) to the unprefixed URL; every other language is prefixed.
- New channels start **on**. Channels that existed when the platform was upgraded to this
  behaviour were set **off**, so their addresses did not move.
- Old links keep working: unprefixed links and the former `?lang=` product links are
  redirected to the right page in the right language.
- Canonical and `hreflang` links, the sitemaps, product feeds and e-mails all use the
  prefixed addresses; `x-default` is the unprefixed address.

## Storefront theme

A channel's `themeCode` selects which set of design tokens the storefront renders in — colour, typography, spacing, corner radius, elevation. It is chosen from a list on the channel's identity form, and the list holds the themes the storefront actually implements; a channel that names none renders in the default theme.

The storefront reads it through the public channel endpoint:

```text
GET /api/v1/storefront/sales-channel
```

which returns the **resolved** channel for the request — code, display name, language and currency scopes, `themeCode`, `logoUrl` and `anonymousAccess` — and no admin-only field (`id`, `active`, `systemDefault`, `version`). It answers on every active channel, including one closed to anonymous visitors.

A second read answers for the viewer rather than for the store:

```text
GET /api/v1/storefront/sales-channel/access
```

It returns whether the caller may use this channel and why not (`sign_in_required` or `not_permitted`), and — for a signed-in customer — the active channels their Organization may use, each with its name and, when the channel's **Storefront URL** setting is filled in, its address. It is never cached (`Cache-Control: private, no-store`). The storefront applies the theme server-side, on the first render, so the first HTML a buyer's browser parses already carries the channel's brand.

The theme changes how the storefront looks, not what it is made of: every channel renders the same pages with the same components. A per-channel page *template* is a larger question, and is deliberately not answered here.

A channel configured with a theme code the storefront does not implement renders in the default theme and logs the code it was given. The page is never refused for a buyer, and no other theme is substituted by guesswork.

## Bidirectional membership

Memberships can be managed equivalently from either side:

```text
GET    /api/v1/admin/sales-channels/:code/:entityType
PUT    /api/v1/admin/sales-channels/:code/:entityType/:entityId
DELETE /api/v1/admin/sales-channels/:code/:entityType/:entityId?fallbackToDefault=true
GET    /api/v1/admin/sales-channels/by-entity/:entityType/:entityId
```

Both sides delegate to `SalesChannelMembershipService`, which is the single mutator for every bridge table. Operators reach the same data whether they're editing a Sales Channel's membership panel or a Product's "Sales channels" widget on the entity edit page.

## Lifecycle guards

| Operation | Refused when… | Error code |
|---|---|---|
| `deactivate(default)` | always | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(default)` | always | `CANNOT_MODIFY_SYSTEM_DEFAULT` |
| `delete(channel)` | any Order or Quote refers to it | `SALES_CHANNEL_HAS_ATTRIBUTIONS` |
| `delete(channel)` | any membership entity would orphan AND `fallbackToDefault=false` | `ENTITY_WOULD_HAVE_ZERO_CHANNELS` |
| `update(channel)` | submitted `expectedVersion` is stale | `STALE_SALES_CHANNEL_WRITE` |
| `create / update(channel)` | unknown language / currency code | `UNKNOWN_LANGUAGE_CODE` / `UNKNOWN_CURRENCY_CODE` |
| `create / rename(channel)` | code already in use | `DUPLICATE_SALES_CHANNEL_CODE` |

Hard-delete with `?fallbackToDefault=true` rebinds orphaned entities to the system default inside the same transaction before the channel row is removed; the bridge tables' `ON DELETE CASCADE` is the safety net for any membership that doesn't need explicit rebinding.

## Audit trail

Every identity change, lifecycle change, and membership change writes one `audit_log_entries` row synchronously inside the same transaction. The action codes live in `@endora-commerce/contracts` as `SALES_CHANNEL_AUDIT_ACTIONS`:

- `sales_channel.identity.changed` — create + update.
- `sales_channel.lifecycle.changed` — deactivate / activate / delete / system-default-promoted.
- `sales_channel.membership.changed` — add / remove (no-op writes are not audited).

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `DEFAULT_SALES_CHANNEL_CODE` | `default` | Code of the channel the boot reconciler creates / promotes as `system_default = true`. |
| `SALES_CHANNEL_HOST_MAP` | empty | Comma-separated `host=channelCode` pairs used by the resolver when no `X-Sales-Channel` header is provided. Example: `serwisA.com=channel-a,serwisB.com=channel-b`. |

See [admin-usage](./admin-usage.md) for the day-to-day operator workflow and [developer-guide](./developer-guide.md) for cross-module integration.
