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
  You can send a broadcast or targeted message from the admin, and order-status
  changes / quote-request updates notify subscribed customers automatically.
  The admin panel does not receive push in this version.

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
| `pwa.vapid_public_key` | string | served to the subscribe flow |
| `pwa.vapid_private_key` | secret | signs Web-Push (AES-256-GCM at rest) |
| `pwa.fcm_service_account` | secret | reserved for the token-based FCM provider |

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
   `pnpm --filter backend run migration:up` (applies `080_pwa_init`).
2. In **Settings → PWA**, set identity + upload an icon, toggle caching/push.
3. Click **Generate VAPID keys** (or `POST /api/v1/admin/pwa/vapid/generate`).
4. Set `NEXT_PUBLIC_BUILD_ID` / `VITE_BUILD_ID` in the deploy pipeline.
5. Device-test install + push over HTTPS.
