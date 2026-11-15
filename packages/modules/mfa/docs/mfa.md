---
title: Two-step verification and federated sign-in
description: TOTP two-step verification with recovery codes, Google and Microsoft sign-in, and their per-scope policies.
---

# Two-step verification and federated sign-in (`mfa`)

`mfa` adds two things to the customer and administrator sign-ins: a second
factor (TOTP authenticator apps, with single-use recovery codes) and federated
sign-in with Google or Microsoft. Both are switched on per surface — the
storefront and the Admin UI — and, on the storefront, per sales channel. An
organization can require a second factor of its own members, and a platform
administrator can reset a member's second factor.

The settings, permissions and palette actions the module declares are listed on
its generated reference page.

## Federated sign-in

A buyer or an administrator can sign in with a Google or Microsoft account
whose e-mail address the provider has verified. An existing account is matched
by that address; on the storefront a new account is created in a personal
organization where the sales channel allows registration without one. The same
second-factor decision as for a password sign-in follows: an account with an
active second factor is asked for its code, and one that must set a second
factor up first is sent back to the password sign-in.

A provider is offered only when it is **configured** (its client credentials
are in the backend environment) **and** **enabled** in the settings for the
surface — `mfa.storefront.google_enabled`, `mfa.storefront.microsoft_enabled`
per sales channel, `mfa.admin.google_enabled`, `mfa.admin.microsoft_enabled`
for the Admin UI.

### Configuring a provider

Register an OAuth client with each provider and give the backend its
credentials:

| Variable | Meaning |
| --- | --- |
| `MFA_OAUTH_GOOGLE_CLIENT_ID`, `MFA_OAUTH_GOOGLE_CLIENT_SECRET` | The Google OAuth client. |
| `MFA_OAUTH_MICROSOFT_CLIENT_ID`, `MFA_OAUTH_MICROSOFT_CLIENT_SECRET` | The Microsoft Entra ID application. |
| `MFA_OAUTH_MICROSOFT_TENANT` | The Entra ID tenant; `common` (the default) accepts work, school and personal accounts. |

The provider always returns to the **backend**, never to the storefront or the
Admin UI. Register these redirect URIs with the provider, where
`BACKEND_PUBLIC_URL` is the backend's public address:

```text
${BACKEND_PUBLIC_URL}/api/v1/auth/customer/oauth/google/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/customer/oauth/microsoft/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/admin/oauth/google/callback
${BACKEND_PUBLIC_URL}/api/v1/auth/admin/oauth/microsoft/callback
```

Register only the surfaces and providers you enable. The value must match
`BACKEND_PUBLIC_URL` exactly — scheme, host and port — or the provider refuses
the sign-in.

### The storefront address of each sales channel

A storefront sign-in returns the buyer to the storefront of the sales channel
it was started on: the channel's **Storefront URL** setting
(`sales_channels.storefront_url`), or `STOREFRONT_BASE_URL` when the channel
names none. That address must be the host the buyers of that channel actually
sign in on. A channel served on its own domain whose setting is empty sends its
buyers back to the `STOREFRONT_BASE_URL` storefront instead, where the sign-in
cannot finish because the browser's binding cookie belongs to the other host.

### How a storefront sign-in completes

The storefront and the backend may be on different hosts (for example
`shop.example.com` and `api.example.com`). A cookie set by the backend would
belong to the backend's host, and the storefront would never see it. So the
backend sets no sign-in cookie on the storefront's behalf:

1. The sign-in button links to the storefront's own `/auth/federated/start`. It
   keeps a random secret in a short-lived cookie on the storefront's host and
   sends the browser to the backend's `start` with the secret's digest.
2. The provider returns to the backend's `callback`. The backend checks the
   transaction, the account, the sales channel's access rule and the second
   factor, then stores a single-use code for sixty seconds and sends the
   browser to `/auth/federated/complete?code=…` on the channel's storefront.
3. The storefront redeems the code server-to-server with
   `POST /api/v1/auth/customer/oauth/exchange`, presenting the secret from its
   cookie. It receives the session (or the pending second step) and sets its
   own cookies, and the signed-out basket is carried over as after a password
   sign-in.

A code is redeemed once, only with the secret of the browser that began the
sign-in, and only on the sales channel it was started on. Any other attempt is
answered `400 MFA_FEDERATED_HANDOFF_INVALID`, and the storefront shows its
"sign-in expired" message.

The Admin UI is not affected: it talks to the backend directly, so its session
belongs to the backend's host and the callback sets it there.
