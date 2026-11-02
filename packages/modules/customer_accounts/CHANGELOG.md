# @endora-commerce/mod-customer-accounts

## 0.109.0

### Patch Changes

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 5038a3a: Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings) and error codes are unchanged.

  - `@endora-commerce/mod-mfa`: the four TOTP setting names (now "Admin UI — allow two-step verification", "Admin UI — enforce two-step verification", "Storefront — allow two-step verification", "Storefront — enforce two-step verification"; the `MFA_DEACTIVATION_BLOCKED` sentence quotes the new name), the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
  - `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
  - `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
  - `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
  - `@endora-commerce/contracts`: the validation message of the MFA disable request body.
  - `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.

- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [04fa275]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/mod-organizations@0.109.0

## 0.108.0

### Minor Changes

- 14bcf1d: Feature 160 (D-287 P1) on the edges of pricing.

  - **customer_accounts** — demo data of its own: the _VIP_ customer group (code `demo-vip`) of the owner's E3 pricing scenario; `demo reset` withdraws it by its code.
  - **import_export** — the products import refuses a file carrying a `default_price`, `defaultPrice`, `price`, `price_override` or `priceOverride` column with `400 PRICE_SET_IN_PRICE_BOOKS` and imports nothing: a product has no price of its own, so the column would otherwise be dropped without a word. Adapters may declare such columns with the new `refusedHeader`.
  - **demo-composition** — the price-list backfill step (`DefaultPriceListMigrator` over each product's `defaultPrice`) is replaced by _base prices and price books over the demo catalogue_, which calls `price_lists`' `seedDemoPriceBooks` with the demo's ids, and _demo organisation joins the VIP customer group_; the `color` attribute is flagged as a price-rule attribute.

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [8d62ff8]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/mod-organizations@0.108.0

## 0.107.0

### Minor Changes

- bf9881f: `customerAccountAdminSearchPort.search` honours the two new optional criteria of
  `CustomerAccountAdminSearchCriteria`: `qFields` matches `q` only against the e-mail and/or the first
  and last name, literally, ordered by an exact e-mail, then one starting with `q`, then the most recent
  change; `excludeDeleted` leaves out deleted and anonymized accounts. Without either, the search — and
  the admin Customers list built on it — behaves exactly as before.
- ac24f80: Customer password sign-in follows the sales-channel assignment of the customer's Organization.
  After a correct password and a non-blocked account, a sign-in on a channel the Organization is not
  assigned to answers 403 `SALES_CHANNEL_NOT_PERMITTED` with `details.channelCode`, and sets no
  cookie, creates no session, starts no second factor and leaves `lastLoginAt` unchanged. A wrong
  password is still answered 401 first. This holds with the `mfa` module switched off.

  Individual self-registration assigns the new personal Organization the channel of the store the
  visitor registered on. An account created by a federated sign-in does the same:
  `customerSocialLoginPort.autoCreate(email, { salesChannelId })` takes the channel the sign-in was
  started on, which `mfa` carries in the OAuth transaction, and gives the new personal Organization
  exactly that channel, so the session issued next is accepted there. Without a channel the system
  default applies.

### Patch Changes

- 1525d86: Customer sign-in, the customer second factor and password-reset requests are now limited per
  account, the way administrator sign-in already was.

  - `@endora-commerce/platform/kernel` publishes `AuthenticationAttemptThrottle`, the attempt
    counter administrator sign-in used, with the profile types an owner of accounts builds one
    over (`AttemptThrottleProfile`, `AttemptPolicy`, `AttemptCounterStore`, `ThrottledAttempt`,
    `ThrottledCheckResult`, `ThrottledCredentialState`) and `ADDRESS_POLICY`, `ACCOUNT_POLICY`,
    `ABANDONED_AFTER_SECONDS`, `DEFAULT_STORE_DEADLINE_MS`, `addressOrigin`. `admin_users`' own
    throttle is now a profile over it; its keys, cookie values, codes and audit rows are unchanged.
  - `@endora-commerce/contracts` adds `CustomerAuthenticationThrottlePort` (container name
    `customerAuthenticationThrottlePort`, owner `customer_accounts`) with
    `CustomerAuthenticationAttempt`, `CustomerAuthenticationCheckResult`,
    `CustomerAuthenticationOrigin` and `CustomerAuthenticationFactor`; the error codes
    `CUSTOMER_AUTHENTICATION_THROTTLED` (429, with `Retry-After`) and
    `CUSTOMER_AUTHENTICATION_UNAVAILABLE` (503); the cookie name
    `CUSTOMER_KNOWN_DEVICE_COOKIE_NAME` (`b2b_customer_device`) and its lifetime. Optional
    additions: `CustomerLoginInput.knownDevice`, `CustomerLoginResult.knownDevice`, and a second
    `context` argument on `CustomerPasswordResetPort.requestReset`.
  - `customer_accounts` counts wrong passwords per folded e-mail address (50 in 30 minutes from a
    device the account has not signed in on, 10 from a known one), and password-reset requests per
    address (5 an hour). There is no per-address counter: the storefront signs shoppers in from its
    own server. A completed sign-in sets the signed `b2b_customer_device` cookie, and an attempt
    carrying it is held to that device's own budget. Asking for a new reset link retires the
    earlier unused ones.
  - `mfa` checks customer second-factor codes inside the customer throttle (20 in 30 minutes,
    10 from a known device) and sets the customer known-device cookie when a customer sign-in
    completes there.
  - `organizations` reads and sets the customer known-device cookie on
    `POST /api/v1/auth/customer/login` and reads it on `POST /api/v1/auth/password-reset/request`.

- 30c61d9: Two ports answer more about the account they read:

  - `customerSocialLoginPort.resolveByEmail` answers `{ id, organizationId, blocked }` (was `{ id }`), and `autoCreate` answers `{ id, organizationId }`. A blocked account is still returned — it is the account the address belongs to — so federated sign-in refuses it instead of creating a second one.
  - `customerOrgResolver` answers `{ organizationId, active }`, or `null` for an account that does not exist (was the organisation id, or `null`). `active` is `false` for a blocked or deleted account. Its one consumer is `@endora-commerce/mod-auth`'s request hook; upgrade the two packages together.

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [ac24f80]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [649fe8d]
- Updated dependencies [248a9df]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/mod-organizations@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/mod-organizations@0.106.0

## 0.105.0

### Minor Changes

- 560f2e3: More credential changes withdraw the sessions and pending sign-ins obtained before them.

  - **`admin_users create` run again for an existing account** replaces the password, so it now
    ends every session of that account and withdraws its pending second-factor challenges and
    setup tickets, through the same path as a peer reset. The write is audited as
    `admin_user.change_password` with `via: 'cli'` and no acting administrator. Creating a new
    account is unchanged.
  - **Removing a second factor.** Disabling your own two-factor authentication
    (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`) ends every other
    session of the account and keeps the one the request was made from. An administrator's reset of
    a customer's second factor (`POST /api/v1/admin/customers/:customerId/mfa/reset`, and the bulk
    route for each account it actually resets) ends every session of that customer. Both withdraw
    the account's pending challenges and setup tickets. Enrolling a factor ends no session, and a
    disable or reset that removes nothing ends none either.
  - **Customer password change** (`POST /api/v1/me/customer/change-password`,
    `POST /api/v1/me/password`) ends every other session of the account and keeps the calling one.
    **Redeeming a reset token** (`POST /api/v1/auth/password-reset/confirm`) ends all of them. Both
    mark every other outstanding reset token of the account as consumed and withdraw its pending
    second-factor challenges and setup tickets.

  In every case the new state is persisted first and the sessions are revoked after it.

  Port changes, all additive: `AuthSessionPort.destroyAllForCustomer` takes an optional
  `{ exceptSessionId }` (`AuthDestroyAllForCustomerOptions`), mirroring `destroyAllForAdmin`;
  `CustomerAuthPort.changePassword` takes an optional fourth argument
  `{ sessionCookieValue }` (`CustomerChangePasswordContext`) naming the session to keep — a caller
  that omits it keeps none. No port member was removed or changed incompatibly.

  Not ports, but changed for anyone constructing these classes directly: `PasswordResetService`'s
  constructor takes the session port as its second argument (the audit port moved to third), and
  `MfaEnrolmentService.disable` returns whether a factor was removed.

### Patch Changes

- 38e8818: Sign-in does the same password-hash work whether or not the address belongs to an account.

  Administrator and customer sign-in looked the account up first and verified the password only when
  there was one. An address nobody holds, a deleted customer and an inactive administrator were
  therefore refused tens of milliseconds sooner than a wrong password for a real account, and the
  difference told a caller which addresses have an account. Both now verify the submitted password
  once in every case — against a dummy hash made once per process with the parameters of a stored
  hash when there is no usable account — and answer exactly as for a wrong password.

  `@endora-commerce/platform/kernel` exports `verifyPasswordOrDummy(hash, password)` for this.

  **Behaviour change for customer sign-in.** `403 ACCOUNT_BLOCKED` used to be answered before the
  password was looked at, so it told anybody that the address has an account and that it is blocked.
  It is now answered only when the password is correct; a wrong password for a blocked account is
  `401 INVALID_CREDENTIALS` like any other.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/mod-organizations@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/mod-organizations@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/mod-organizations@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [f2a2dca]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/mod-organizations@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/mod-organizations@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/mod-organizations@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-organizations@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
- Updated dependencies [54c7417]
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-organizations@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/mod-organizations@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [4b1844c]
- Updated dependencies [2ffcda5]
  - @endora-commerce/mod-organizations@0.11.4
  - @endora-commerce/platform@0.14.0

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/mod-organizations@0.11.3
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/mod-organizations@0.11.2
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/mod-organizations@0.11.1
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b8ad861]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/mod-organizations@0.11.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/mod-organizations@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-organizations@0.10.2

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/mod-organizations@0.10.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/mod-organizations@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-organizations@0.9.1
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Two tables are created by the packages that own them: `api_keys` and `customer_groups`
  (`specs/120-migration-closure-bridge-ownership/` Phase 3, FR-014 and the owner's ruling of
  2026-09-12).

  Both were created by whichever module needed them first rather than by the one that owns them. That
  is normally harmless — 27 such creations stay where they are, because a consumer who omits the
  creating module gets an empty table and nothing worse — and these two were not, because each also
  produced a reference from outside the referencing module's dependency closure: a fresh database
  could not be migrated by a member set that omitted the creator.

  **They move between two already-applied migration bodies, and that is the whole design.** The
  ordinary repair — take the statement out and re-add it in a new migration — is right for a
  _reference_, which can only move later in the computed order. It is wrong for a _creation_: a new
  migration runs after the entire frozen historical prefix, and both tables are referenced by
  migrations inside it, so the creation would have landed after its own consumers and broken a fresh
  database. Each creation therefore moves into the frozen body that carries the **earliest** reference
  to it, so no position in between is affected.

  **No class is renamed.** `mikro_orm_migrations` persists the class name and holds no checksum
  (measured on `@mikro-orm/migrations@6.6.13`), so neither edited body is re-offered to a database
  that has applied it, and nothing is pending anywhere from this change.

  **`create table if not exists`, and it is load-bearing rather than defensive.** A database that
  applied the _donating_ migration and has not yet reached the _receiving_ one — anything a release or
  more behind — already has the table while the receiving migration is pending. A verbatim creation
  fails there; the guarded one is a no-op. Both spellings were measured against a fully migrated
  database: guarded skips, unguarded raises `relation already exists`.

  **`@endora-commerce/mod-api-keys`** — `Migration20260724T173916ApiKeysDistributorBinding` now creates
  `api_keys` and its `key_hash` index, above its own `alter table`, and drops the table in `down()`.
  Its position already preceded both frozen references — its own `alter`, and `orders`' foreign key.

  **`@endora-commerce/mod-webhooks`** — `Migration20260425T091359WebhooksUs7Init` no longer creates
  `api_keys`. The two modules were one surface until the US7 split and the creation stayed behind;
  this package names `api_keys` in no statement of its own. A consumer installing `mod-webhooks`
  without `mod-api-keys` no longer receives the table, which is the point: it is not this package's.

  **`@endora-commerce/mod-customer-accounts`** — `Migration20260611T140403CustomerAccountsLifecycle`
  now creates `customer_groups`, above the foreign key it already had to it, and drops the table in
  `down()`. This package's `CustomerGroup` entity has always owned the table.

  **`@endora-commerce/mod-price-lists`** — `Migration20260426T075235PriceListsPricingInit` no longer
  creates `customer_groups`. Tiered pricing needed customer groups first and created them where it
  needed them; nothing in this package references the table — `price_list_assignments.customer_group_id`
  is a nullable column with an index and no foreign key.

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/mod-organizations@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- 6e037cd: The module declares `demo: false` — a decision recorded rather than a field filled in.

  The demo shop does have a buyer and it is not this module's demo data:
  `customer_accounts.organization_id` is `NOT NULL` (Principle XI), so there is no account to
  create before an `organizations` row exists to hold it and "create the account, then join it"
  cannot be written at all. The account and its organisation are created in one statement, which
  makes them two modules' rows and the instance composition's.

  Absent and `false` are different states, so this changes no behaviour: it says the module owes
  nothing rather than leaving it undecided.

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [6e037cd]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/mod-organizations@0.8.0

## 0.7.0

### Minor Changes

- 73d0887: Publish `MfaEnrolmentStatePort`, and make `twoFactorEnabled` the live enrolment.

  `activeSubjectIds(subjectType: MfaSubjectType, subjectIds: readonly string[]):
Promise<string[]>` answers which of the given subjects hold an active second
  factor, on the `mfaEnrolmentStatePort` container. Batched rather than per row,
  because every caller is a list surface; the answer is plain ids, because
  `MfaEnrolment` carries the encrypted TOTP secret and no consumer has business
  holding it.

  New surface on `mfa` — nothing is removed there. A consumer resolves it with
  `lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort')` and declares the
  edge; both consumers in this repository declare it `degrades-without`, because
  `mfa` is deactivatable and a locked consumer binding it would make the operator's
  MFA switch a dead one.

  **Two mappers gained a required parameter, and that is a breaking change to a
  call, not to a wire shape.** `toAdminUserRecord(admin, twoFactorEnabled)` and
  `toCustomerAccountRecord(account, twoFactorEnabled)` no longer derive the field
  themselves; each package also exports a batching helper
  (`toAdminUserRecords` / `toCustomerAccountRecords`, plus
  `toOneCustomerAccountRecord`) that takes the reader and does one `mfa` read per
  response. The parameter has no default deliberately: it replaces a derivation
  that was silently wrong, and a default would let the next call site reintroduce
  it. Two service constructors take the reader as a new argument —
  `CustomerAccountReadService(emFactory, twoFactorEnrolments)` and
  `AdminUserReadService(emFactory, twoFactorEnrolments)`, with the same addition on
  `CustomerAccountMemberWriteService`, `CustomerAccountLifecycleWriteService` and
  `CustomerAccountAdminSearchService`.

  `twoFactorEnabled: boolean` is unchanged on every response and on both published
  records; what changed is where the value comes from. It was
  `Boolean(x.twoFactorConfirmedAt)` — a column with no writer on either identity
  table, whose last non-null writer was the superseded customer TOTP path deleted
  on 2026-08-25 — so the field was a provably constant `false`. `/admin-users`
  reported no second factor for an administrator who had enrolled an hour earlier,
  and `GET /api/v1/me/customer` told a buyer their own account was unprotected
  while it was not.

  `two_factor_confirmed_at` is now read by nothing on either table. Dropping the
  two columns is a separate migration and is not in this change.

- 4013a8b: `promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
  surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
  icon map the glyph behind it.

  Each of the four module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
  and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
  `/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
  ten `/product-feeds*` paths.

  Six things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
    dependencies of all four.** They were backend-only packages before this. The kit is where
    every screen's design-system import now resolves, and React is peered rather than depended on
    so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
    for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
    `product_feeds:read` — in each case the code the screen's own API enforces on its entry
    handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
    operator without the code now gets the admin's not-found treatment where the screen used to
    render and its API answered 403. The write codes each of these modules also owns
    (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
    `product_feeds:write`) gate controls **inside** a screen and are unchanged.
  - **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
    `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
    `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
    name rather than substituting one already on the allowlist.
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
    producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
    in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
    `Rss` are already on the list, each added by an earlier palette action of that same module.
  - **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
    `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
    `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
    own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
    `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
    deliberate, because the only place two modules could share it is the admin kit and the kit
    holds no module knowledge.
  - **`product_feeds`' download anchors now read the API origin from
    `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
    directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
    and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
    variable is set the two are identical, so this is a repair to the unset case and not a change
    to any configured one.

  Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
  own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
  `nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
  key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
  breadcrumb trails the admin holds for the payment-gateway settings screens.

  Nothing is removed and no existing export changes shape, so a consumer of any of the four
  `./backend`, `./migrations`, `./ports` or root subpaths is unaffected.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

- 44d0ec3: `customer_accounts` and `inventory` become workspace packages (feature 080,
  T040b, batch six). Each ships `dist` and resolves through its own `exports`
  map — the root for its manifest, `./backend` for `registerModule` plus the
  `entities` array, `./migrations` for its migration classes, and, for
  `inventory`, a type-only `./ports` — exactly as the fifty-nine packages before
  them.

  **`./backend` publishes the `entities` array and no entity class by name**
  (D-168). A consumer that needs `CustomerAccount`, `CustomerGroup` or
  `PasswordResetToken` as a runtime class takes it off that array by name:

  ```ts
  import { entities } from '@endora-commerce/mod-customer-accounts/backend';
  import { entityNamed } from '<host>/packages/package-entity-lookup.js';

  const CustomerAccount = entityNamed<CustomerAccountRow>(
    entities,
    'CustomerAccount',
    '@endora-commerce/mod-customer-accounts/backend',
  );
  ```

  The `CustomerAccountsCradle` type moves with it and is named at
  `@endora-commerce/mod-customer-accounts/backend`.

  **This is the first package to declare another module package as a
  devDependency.** `@endora-commerce/mod-organizations` is reached only by
  `import type` at `@endora-commerce/mod-organizations/ports`, whose emitted
  module exports no runtime binding, so the manifest generator renders it into
  `devDependencies` at `workspace:*` and leaves `peerDependencies` alone (R4 as
  narrowed for contract surface). Nothing of `organizations` appears in this
  package's emitted `.js`; the implementation is still resolved at runtime through
  the container name `personalOrganizationProvisionPort`, so the gate that answers
  503 `MODULE_DISABLED` when `organizations` is switched off is the registration
  and not a call anybody has to remember to write.

  No exported symbol changed shape. What changed is where a consumer names it.

  **`@endora-commerce/mod-inventory` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `InventoryReservationApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { InventoryReservationApplyPort } from '@endora-commerce/mod-inventory/ports';
  ```

  **It also publishes two runtime bindings by name on `./backend`**, beside the
  `entities` array: `WarehouseChannelReconciler` and `DEFAULT_WAREHOUSE_ID`. D-168
  keeps entity classes off that door; a service and a constant are not entities,
  and the development catalog seed must hold the _same_ reconciler the platform
  composed rather than a second copy evaluated from source (D-160.6.1) — the shape
  `price_lists` already ships as `DefaultPriceListMigrator` / `DEFAULT_PRICE_LIST_ID`.

  No exported symbol changed shape. What changed is where a consumer names it.

### Patch Changes

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [94e8f3f]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [d7dca40]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [73da94f]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [cf97e05]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [efa4111]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/mod-organizations@0.7.0
  - @endora-commerce/platform@0.7.0
