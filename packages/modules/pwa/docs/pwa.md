---
title: PWA (Progressive Web App)
description: Progressive-Web-App capabilities for the storefront and admin — installability, opt-in asset caching, a controlled update path and opt-in push
---

# PWA (Progressive Web App)

The `pwa` module adds Progressive-Web-App capabilities to the
storefront and admin: home-screen installability, a Settings-driven per-Sales-
Channel installable identity, opt-in static-asset caching, a controlled service-
worker update path, and opt-in push notifications behind a provider-agnostic
abstraction.

## For the Product Owner

- **Install to home screen** — buyers can add the storefront to their phone's
  home screen; it launches like a native app with your configured name and icon.
  Staff can likewise install the admin panel as a separate app.
- **Configure from Settings** — set the app name, short name, theme/background
  color, upload an icon, and turn caching and push on/off in **Settings → PWA**.
  Each value can be global or overridden per Sales Channel. Changes apply within
  about a minute, no deploy needed.
- **Faster, offline-resilient storefront** — with caching on, repeat visits load
  the shell from the device and a clear offline page shows when the network drops.
  Prices, stock and cart are never cached — they always reflect live data.
- **Push notifications** — when enabled, buyers can opt in to notifications.
  You can send a broadcast or targeted message from the admin. On top of that,
  customers are notified automatically about their own orders and quotes:
  - **Order status changes** — whenever one of the customer's orders moves to
    a new status. The notification names the order number and the status the
    way your shop labels it, and opens that order.
  - **Quote status changes** — when a quote is prepared for the customer by
    your staff, when its offer is revised, approved or cancelled, and when it
    expires. The notification names the quote number and opens that quote. A
    customer's own submission does not notify them.

  Only the customer who placed the order or requested the quote is notified,
  on the devices they subscribed on that sales channel. Notifications are
  written in the sales channel's language (Polish or English; English for any
  other language).
- **Choosing which status changes notify** — in **Settings → PWA**, under the
  push switch, *Notify on order status changes* and *Notify on quote status
  changes* each turn one category on or off, globally or per Sales Channel.
  Both are on by default. They are greyed out while push is off, the quote one
  is not offered while the Quote Requests module is off, and neither affects
  messages you send by hand. The screen is also reachable from the command
  palette (⌘K / CTRL+K → *PWA settings*).
- **Customers' own choices** — on their account profile, under *Push
  notifications*, a signed-in customer can untick *Order status updates* or
  *Quote updates*. The choice applies to every device they have turned
  notifications on, and both are on until they change them. *Notifications on
  this device* is still where they turn notifications on or off in one
  browser; signing out stops them in that browser, so a shared or handed-on
  device does not keep receiving the account's messages.
- The admin panel does not receive push in this version.

## For developers

### Configuration

All identity + toggles live in the Settings module, group `pwa`, resolved per
Sales Channel via the standard global + override chain:

| Setting | Type | Notes |
|---------|------|-------|
| `pwa.app_name`, `pwa.short_name` | string | manifest identity |
| `pwa.theme_color`, `pwa.background_color` | string | hex |
| `pwa.display_mode` | string | `standalone` / `fullscreen` / `minimal-ui` |
| `pwa.icon_asset_id` | string | assets-library source id |
| `pwa.caching_enabled`, `pwa.push_enabled` | boolean | default off |
| `pwa.push_order_status_enabled`, `pwa.push_quote_status_enabled` | boolean | default on; automatic status pushes per category, effective only while `pwa.push_enabled` is on |
| `pwa.vapid_public_key` | string | served to the subscribe flow |
| `pwa.vapid_private_key` | secret | signs Web-Push (AES-256-GCM at rest) |
| `pwa.fcm_service_account` | secret | reserved for the token-based FCM provider |

### Automatic status pushes

One module-private composer (`status-push-composer.ts`) serves both triggers
and applies its gates in a fixed order: the subject (an order placed by a
customer account, or a quote request) → its channel (a quote raised outside a
channel uses the system default) → `pwa.push_enabled` and the category setting
for that channel → the account (missing, deleted or anonymised accounts are
skipped) → the customer's preference. It renders `notification.*` from this
module's own bundle through `_i18n`, in the channel's default language, and
enqueues one message per event with `audience.customers = [account]` and
`sourceEventId = eventId`, so a redelivered event produces no second message.
The whole sequence runs in a system scope: the expiry sweep emits with no
tenant context at all.

| Event (owner) | Notification |
|---------------|--------------|
| `order.status_changed.v1` (`orders`) | order number + the status label from `orderReadPort.findStatusDefinition(to)` (language name → default name → code); opens `/orders/<id>` |
| `rfq.created_by_admin.v1` (`quote_requests`) | *prepared for you*; opens `/quote-requests/<id>` |
| `rfq.modified.v1` | *revised offer waiting* |
| `rfq.approved.v1` | *approved* |
| `rfq.canceled.v1` | *cancelled* |
| `rfq.expired.v1` | *expired* |

`rfq.created.v1` (the customer's own submission) is not consumed. The quote
half reads `quoteRequestReadPort` through a **`degrades-without`** non-binding
dependency on `quote_requests`: it asks whether that module is present before
calling the port, so with Quote Requests off order pushes keep working and the
quote switch and choice are simply not offered. A failure while producing a
push is logged (`pwa.push_enqueue_failed`), a refusal by a switched-off owner
is logged distinctly (`pwa.push_skipped_module_disabled`), and neither ever
affects the status change that announced it.

### Customer preferences

`push_notification_preferences` holds one row per customer account
(`order_status_enabled`, `quote_status_enabled`, the account's
`organization_id` stamped at every write). **No row means both on.**

- `GET /api/v1/storefront/pwa/preferences` → `{ data: { orderStatus, quoteStatus } }`
- `PUT /api/v1/storefront/pwa/preferences` with `{ orderStatus?, quoteStatus? }`
  (at least one; unknown keys refused) → the full resulting choices.

Both require a signed-in customer (401 otherwise) and only ever read or write
that customer's own row. The write runs as the `pwa.push_preference.update`
Command, so every change is in the audit log with the customer as the actor.
`GET /api/v1/storefront/pwa/config` carries `orderStatusPushEnabled` and
`quoteStatusPushEnabled` — whether each category is currently offered on the
channel — which is what the storefront shows the two choices from.

### Push abstraction

`PushProvider` (in `@endora-commerce/contracts`) is the swappable delivery seam. The default
`WebPushProvider` sends standard Web-Push signed with VAPID via the `web-push`
library (on Chrome the endpoints ride Google's free FCM). A token-based
`FcmProvider` (`firebase-admin`) and `OneSignalProvider` are drop-in extension
points — register them in the composition root and set the registry default;
the storefront subscription flow is unchanged.

Delivery fan-out is a BullMQ consumer (`pwa.push.deliver`) with idempotent
`(message_id, subscription_id)` deliveries; dead endpoints (`404`/`410`) are
pruned automatically.

### Service-worker updates

Cache names are keyed by the build id. Set `NEXT_PUBLIC_BUILD_ID` (storefront)
and `VITE_BUILD_ID` (admin) per deploy. The storefront SW does not `skipWaiting`
on its own — `PwaRegister` shows a "new version available" prompt and only
activates on the user's click, so an update never discards in-progress work.

## App-store wrapping checklist

The storefront PWA is built to be wrappable for Google Play (Trusted Web
Activity) and the App Store (WKWebView wrapper). Producing/submitting the native
binaries is out of scope; the technical readiness is:

- [x] Complete web manifest: `name`, `short_name`, `start_url`, `scope`,
  `display: standalone`, `theme_color`, `background_color`, and icons including a
  512×512 `maskable` icon (served per channel from `/manifest.webmanifest`).
- [x] Registered service worker with a `fetch` handler and an offline fallback.
- [x] HTTPS-only (secure context) in production.
- [x] No install-blocking patterns; graceful degradation on unsupported browsers.
- [ ] **Android TWA**: host `/.well-known/assetlinks.json` (Digital Asset Links)
  with the wrapper app's signing-key fingerprint. *(Operator step at packaging.)*
- [ ] **iOS**: web push only works after the user installs the PWA to the home
  screen — the opt-in already accounts for this ordering.

## Operator runbook

1. Set `SETTINGS_SECRET_ENCRYPTION_KEY` (for VAPID/FCM secrets) and run
   `pnpm run migrate` in the root of the instance (applies this module's
   migrations, including `push_notification_preferences`). In a checkout of the
   Endora Commerce repository the same step is
   `pnpm --filter backend run migration:up`.
2. In **Settings → PWA**, set identity + upload an icon, toggle caching/push,
   and choose whether order and quote status changes notify customers.
3. Click **Generate VAPID keys** (or `POST /api/v1/admin/pwa/vapid/generate`).
4. Set `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` in the deploy pipeline.
5. Device-test install + push over HTTPS.
