---
title: Sales Channels
sidebar_position: 1
---

# Sales Channels

The Sales Channels module is the platform's stable handle for "where the sale happens". Every channel-scoped piece of platform data — products, categories, customers, orders, quotes, prices, promotions, CMS pages — is bound to one or more Sales Channels and is filtered through the channel context of the incoming request. The module owns the channel registry, the bidirectional membership service, the resolver middleware that maps every HTTP request onto exactly one channel, and the lifecycle guards that keep the platform from ending up with channel-less data.

## Concepts

- **Sales Channel** — a named place of sale (web storefront, marketplace, brick-and-mortar location, distributor portal). Carries a unique `code`, a multilingual display name, an optional logo and theme code, an ordered list of supported languages with a default, an ordered list of supported currencies with a default, and an `active` flag. Exactly one channel platform-wide carries `system_default = true` (enforced by a partial unique index).

- **System default channel** — the bootstrap channel created by the boot-time reconciler. It is the implicit owner of every channel-scoped entity created without an explicit channel selection. It is non-deletable and non-deactivatable. The env var `DEFAULT_SALES_CHANNEL_CODE` (default `default`) names the channel.

- **Membership** — the M:N relationship between a channel and a channel-scoped entity. Nine entity types are tracked: `product`, `category`, `payment-method`, `delivery-method`, `organization`, `tax`, `customer`, `promotion`, `cms-page`. (`inventory-location` is reserved for when the inventory module introduces that table.)

- **Attribution** — the M:1 relationship for Orders and Quote Requests. Each row is bound to exactly one channel at placement, and the binding is immutable for audit purposes.

- **At-least-one-channel invariant (FR-008)** — every channel-scoped entity is bound to at least one channel at all times. Removing the last membership of an entity is refused unless the caller passes `fallbackToDefault=true`, in which case the entity is rebound to the system default in the same transaction.

## Resolver — request → channel

A Fastify `onRequest` hook runs on every `/api/v1/*` request and resolves it to exactly one channel. Resolution order:

1. **`X-Sales-Channel: <code>` header** — explicit signal, always wins.
2. **`?salesChannel=<code>` query parameter** — storefront / integration paths only; ignored on `/api/v1/admin/*` to prevent cross-channel admin bleed.
3. **Host-based mapping** — env-configured `SALES_CHANNEL_HOST_MAP` (e.g. `serwisA.com=channel-a,serwisB.com=channel-b`).
4. **Fallback to the system default** — for storefront / integration paths only. Admin paths refuse with `MISSING_SALES_CHANNEL_CONTEXT` when `strictAdmin` is on (off by default during the initial rollout).

If a step matches a code that doesn't exist or whose channel is `active=false`, the request is refused with `UNKNOWN_SALES_CHANNEL` / `INACTIVE_SALES_CHANNEL`. The fallback never applies in those cases.

Every response carries `X-Sales-Channel: <resolvedCode>` so HTTP caches can `Vary` on it.

## Storefront theme

A channel's `themeCode` selects which set of design tokens the storefront renders in — colour, typography, spacing, corner radius, elevation. It is chosen from a list on the channel's identity form, and the list holds the themes the storefront actually implements; a channel that names none renders in the default theme.

The storefront reads it through the public channel endpoint:

```text
GET /api/v1/storefront/sales-channel
```

which returns the **resolved** channel for the request — code, display name, language and currency scopes, `themeCode` and `logoUrl` — and no admin-only field (`id`, `active`, `systemDefault`, `version`). The storefront applies the theme server-side, on the first render, so the first HTML a buyer's browser parses already carries the channel's brand.

The theme changes how the storefront looks, not what it is made of: every channel renders the same pages with the same components. A per-channel page *template* is a larger question and is measured, not answered, in `specs/storefront-composability-measure.md`.

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

## Audit trail (FR-019)

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
