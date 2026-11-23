# @endora-commerce/mod-customer-notifications

## 0.112.0

### Patch Changes

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- Updated dependencies [c878440]
- Updated dependencies [65f9a7b]
- Updated dependencies [3fdbe86]
- Updated dependencies [bfc68c7]
- Updated dependencies [9eaa409]
- Updated dependencies [1042e2a]
- Updated dependencies [3872f3d]
- Updated dependencies [bbfcd80]
- Updated dependencies [41b598c]
- Updated dependencies [467b075]
- Updated dependencies [a56109e]
- Updated dependencies [c15eb60]
- Updated dependencies [33db45a]
- Updated dependencies [074f500]
- Updated dependencies [cec9beb]
- Updated dependencies [90320fd]
- Updated dependencies [42febee]
- Updated dependencies [98c0411]
- Updated dependencies [a8261aa]
- Updated dependencies [f64646d]
- Updated dependencies [f6dda10]
- Updated dependencies [f6dda10]
- Updated dependencies [ee6062c]
- Updated dependencies [4e668b5]
- Updated dependencies [843ed42]
- Updated dependencies [6155f4b]
- Updated dependencies [5850aac]
- Updated dependencies [8a5725e]
- Updated dependencies [f915a24]
- Updated dependencies [8a06dc5]
- Updated dependencies [9eee781]
- Updated dependencies [bd47236]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [398e6d2]
- Updated dependencies [51c5072]
- Updated dependencies [2e287a5]
- Updated dependencies [9d6f006]
- Updated dependencies [49328cf]
- Updated dependencies [b3d4843]
- Updated dependencies [f74fe34]
- Updated dependencies [19eb7c0]
- Updated dependencies [0fbf186]
- Updated dependencies [27b977d]
- Updated dependencies [5e2a12a]
- Updated dependencies [5518a09]
- Updated dependencies [5e380e3]
- Updated dependencies [bfab5bd]
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0

## 0.111.0

### Minor Changes

- aaa50ff: `customer_notifications`: new storefront route `GET /api/v1/storefront/notifications/:id` (issue #238, `specs/179-rfq-and-customer-notifications/`). It answers one entry as `{ data: CustomerNotification }`, rendered in the request's language like the list, under the same visibility as the list — the caller's own entry, of the request's sales channel or of no channel, from a producing module that is present — and `404 NOT_FOUND` for any other id. It is read-only: it marks nothing, and it answers normally under impersonation. `Cache-Control: private, no-store`; `503 MODULE_DISABLED` while the module is off.
- 1d0df64: New module `customer_notifications` (`@endora-commerce/mod-customer-notifications`): a notification centre in the buyer's storefront account (issue #238, `specs/179-rfq-and-customer-notifications/`). This release ships the module; `quote_requests` starts recording into it in a later change, and the storefront page and unread indicator follow.

  - **Table** `customer_notifications` (migration `customer_notifications_init`): one entry per customer account, stamped with its Organization (`@CustomerScoped`), with the sales channel it concerns or none, the producing module and its idempotency key (unique together), a kind, an optional subject, an English title and optional body beside their translatable messages, an optional storefront-relative link, and the read time. No foreign key to another module's table.
  - **Port** `customerNotificationRecordPort` (`CustomerNotificationRecordPort` in `@endora-commerce/contracts`): `recordWithin(em, input)` persists into the caller's unit of work without flushing it; `record(input)` writes on its own and answers the existing entry for a repeated `(sourceModule, sourceKey)`. Both refuse an absolute or protocol-relative link, a `bodyMessage` without a `body`, and message params that are not strings or finite numbers. The port fails closed while the module is off.
  - **Storefront API**, for a signed-in buyer, `Cache-Control: private, no-store`: `GET /api/v1/storefront/notifications` (newest first, `limit` 1–50, default 20, keyset `cursor`, with the unread count), `GET /api/v1/storefront/notifications/unread-count`, `POST /api/v1/storefront/notifications/:id/read` (`204`, `404` for an entry that is not the caller's) and `POST /api/v1/storefront/notifications/read-all` (`{ updated }`). Each shows only the caller's own entries of the request's sales channel and of no channel, and only entries whose producing module is present; entries are rendered in the request's language with the English sentence as fallback. Under impersonation the reads answer and the two writes change nothing.
  - **Queue** `customer_notifications.retention.sweep`, once a day: deletes entries older than the retention period, in batches, and the entries of customer accounts that were deleted or anonymised. An idle tick enters no tenant scope.
  - **Settings** `customer_notifications.enabled` (activation, on by default) and `customer_notifications.retention_days` (90 by default, 7–730, platform-wide).
  - Operator-toggleable: while off its routes answer `503 MODULE_DISABLED`, its port refuses, its sweep does nothing and its retention setting is read-only; nothing is deleted, and entries recorded before reappear when it is switched back on.

### Patch Changes

- 0f96ced: The module page (English and Polish) now documents the storefront side of the notification
  centre (issue #238, `specs/179-rfq-and-customer-notifications/` WP-11): the unread count on the
  account entry at every screen width, the _Notifications_ page with its paging, opening, _Mark all
  as read_, empty and error states, the account navigation item and overview line, behaviour under
  impersonation and while the module is off, the two settings, the retention queue and the
  storefront files.
- Updated dependencies [ee0698d]
- Updated dependencies [9c8efbe]
- Updated dependencies [3de70b4]
- Updated dependencies [2ee4923]
- Updated dependencies [e9df6b5]
- Updated dependencies [1937bed]
- Updated dependencies [3254098]
- Updated dependencies [7616ef1]
- Updated dependencies [ed57923]
- Updated dependencies [cffa0bf]
- Updated dependencies [644739b]
- Updated dependencies [c58acd1]
- Updated dependencies [fc91398]
- Updated dependencies [feaa40b]
- Updated dependencies [d2f179f]
- Updated dependencies [d16b343]
- Updated dependencies [34b3387]
- Updated dependencies [e283396]
- Updated dependencies [4ecb155]
- Updated dependencies [ff7bd10]
- Updated dependencies [761d9c4]
- Updated dependencies [8e7f794]
- Updated dependencies [8e7f794]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [695636f]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [3f95d1c]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [8a4ca9c]
- Updated dependencies [c7ec2fa]
- Updated dependencies [a2d306f]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
- Updated dependencies [73e8e8c]
- Updated dependencies [bf257b8]
- Updated dependencies [e435bad]
- Updated dependencies [5c148de]
- Updated dependencies [036865c]
- Updated dependencies [37532da]
- Updated dependencies [bfdbeaf]
- Updated dependencies [65f7abc]
- Updated dependencies [a998fee]
- Updated dependencies [20cda0c]
- Updated dependencies [48b2505]
- Updated dependencies [c24bd3c]
- Updated dependencies [6b664cd]
- Updated dependencies [cd05402]
- Updated dependencies [91272e6]
- Updated dependencies [eb4dbc6]
- Updated dependencies [e2669cd]
- Updated dependencies [aec841a]
- Updated dependencies [da2b459]
- Updated dependencies [77904b3]
- Updated dependencies [4ab926c]
- Updated dependencies [a3b1da5]
- Updated dependencies [28fc1c7]
- Updated dependencies [2b12d58]
- Updated dependencies [9110863]
- Updated dependencies [2905024]
- Updated dependencies [ae1cedf]
- Updated dependencies [6f0debc]
- Updated dependencies [d6e7a55]
- Updated dependencies [62d3e2d]
- Updated dependencies [0b2f558]
- Updated dependencies [dc9bbea]
- Updated dependencies [1acf873]
- Updated dependencies [edf46c9]
- Updated dependencies [ef656f9]
- Updated dependencies [71ec1f8]
- Updated dependencies [7a3673f]
- Updated dependencies [1c3366d]
- Updated dependencies [ea965bb]
- Updated dependencies [fc08f90]
- Updated dependencies [d34fe02]
- Updated dependencies [59b5246]
- Updated dependencies [c55dcf5]
- Updated dependencies [3e7b0b6]
- Updated dependencies [d68aa70]
- Updated dependencies [0b991d6]
- Updated dependencies [9af7a64]
- Updated dependencies [ecbebe2]
- Updated dependencies [e61a12b]
- Updated dependencies [d362c3c]
- Updated dependencies [ef9630f]
- Updated dependencies [b7a9c8e]
- Updated dependencies [75f89d2]
- Updated dependencies [ca66684]
- Updated dependencies [b6fd6df]
- Updated dependencies [6658f0f]
- Updated dependencies [877477b]
- Updated dependencies [767d5de]
- Updated dependencies [d0c5dc8]
- Updated dependencies [ac094f5]
- Updated dependencies [61a6edf]
- Updated dependencies [dd869ee]
- Updated dependencies [ff6b599]
- Updated dependencies [ac65359]
- Updated dependencies [49b43de]
- Updated dependencies [5f8eede]
- Updated dependencies [de28088]
- Updated dependencies [44529a4]
- Updated dependencies [af88938]
- Updated dependencies [9aff446]
- Updated dependencies [42a9a4b]
- Updated dependencies [8ae3f58]
- Updated dependencies [65cdd0e]
  - @endora-commerce/contracts@0.111.0
  - @endora-commerce/platform@0.111.0
