# @endora-commerce/mod-related-payers

## 0.112.0

### Minor Changes

- 33db45a: `GET /api/v1/admin/related-payers/requests` pages (UX audit DS-05, issue #1439). `adminRelatedPayerRequestsQuerySchema` takes `page` (default 1) and `pageSize` (1–200, `ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE`), and `adminRelatedPayerRequestsResponseSchema` now carries `meta: { page, pageSize, total }`. The order is unchanged: oldest first, with the request's id as the tie-break. A caller that names no `pageSize` still gets the first 500 entries, the queue's old cap, with `meta.pageSize` 500. `RelatedPayerRequestService.listQueue()` answers `{ rows, page, pageSize, total }` instead of an array. `AdminRelatedPayerRequestsQueryInput` is the query a caller sends (`page` optional).

  - **Payer requests (admin)**: the queue is the kit `ListPage` with the kit pager (DS-05). The state and reason filters are a labelled `ListToolbar`, with _Clear all filters_ while the queue is narrowed (DS-06, #1440). A row's _Approve_ is an outline button, never filled, and only on a request whose organization is settled; _Assign organization_, _Create organization_, _Send invitation_ and _Reject_ (last) are in the row's menu (DS-07, #1441). An empty queue and a filtered-out one are two empty states, the second with _Clear filters_ (DS-15, #1448). The results card is the kit's, so the `p-0` override is gone (SHELL-18, #1502). Each decision's result is said above the list in a status line, not a banner; a refusal in a dialog stays in the dialog. The page's description is one line, and the rest moved behind its ⓘ.
  - The module now declares `lucide-react` as an optional peer.

  Removed unused translation keys (`related_payers`): `queue.loading`, `queue.empty`, `queue.retry`, `queue.column.actions`.

- 8b29aae: New module `@endora-commerce/mod-related-payers` (`related_payers`): a buyer Organization places orders that another Organization of the store pays for and is invoiced for. It owns the buyer → payer link (state, allowed billing addresses, validity window, buyer's or payer's commercial terms), its operator surface (the _Payers_ section of the organization card and the _Payer requests_ queue), customer requests and payer invitations with an enumeration-safe reply, the account's _Payers_ and _Orders we pay for_ screens, eight transactional e-mails, and the ports `relatedPayerWritePort` (for overlays: `addPayer` / `revokePayer`, audited as `automation` with a `source`) and `relatedPayerPolicyPort` (read by `orders`, `carts` and `payment_methods`). It ships switched off (`related_payers.module_enabled`) and disabled on every sales channel (`related_payers.enabled`), so installing it changes nothing until an operator turns it on. `GET /api/v1/related-payers/availability` tells a signed-in customer's storefront whether the capability is on for the request's channel, so the account screens appear only where their routes answer.

  `@endora-commerce/contracts` exports the module's schemas and port types from `related-payers.ts` (`RelatedPayerWritePort`, `RelatedPayerPolicyPort`, `addPayerInputSchema`, the link, request and invitation DTOs, `relatedPayersAvailabilityResponseSchema`, `RELATED_PAYERS_SETTING_CODES`, `RELATED_PAYERS_HOOKABLE_ACTIONS`) and five error codes in `ERROR_CODES`: `RELATED_PAYER_NOT_USABLE`, `RELATED_PAYER_REQUEST_LIMIT`, `RELATED_PAYER_REQUEST_DECIDED`, `RELATED_PAYER_LINK_EXISTS`, `RELATED_PAYER_INVALID_PAIR`.

### Patch Changes

- 204b98c: The organization detail screen is one card with tabs instead of sixteen stacked cards and five more from other modules (issue #1515, UX audit 2026-11-17 SALES-02).

  - **Overview**: moderation, registered address, hierarchy, custom fields. **Members & roles**: the members and the roles. **Commerce**: sales channels, order-confirmation e-mails, restrictions, fulfilment, the price books that apply, and every `organization.detail.after` panel. **Tax**: the tax ID and VAT status with _Change tax ID…_, _Change VAT status…_ or _Convert to company…_, then VAT validation. **Sales**: the sales representatives, offered only with `organizations:assign-sales-rep`. `?tab=` opens a tab. A tab holding unsaved changes says so, and switching tabs keeps them.
  - Every panel is a section of the tab's card, not a card of its own; `organization.detail.after` is mounted in the Commerce tab without `chrome="card"`, so its contributions render as sections. The related-payers panel is an `EditorSection` now, like the other contributions.
  - The header holds _Back_ and the page Save, the one primary. The tax corrections moved to the Tax tab, and their result is said beside them.
  - Moderation offers only the transitions the status allows (issue #1541, SALES-15): Approve and Reject while pending, Block while active, Unblock while blocked, none once rejected. The registry-divergence notice's link opens the Tax tab at the VAT validation.
  - The sales-representative remove button has an accessible name, and its result is said beside _Assign_ instead of an info banner.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

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
- Updated dependencies [d908737]
- Updated dependencies [1042e2a]
- Updated dependencies [3872f3d]
- Updated dependencies [bbfcd80]
- Updated dependencies [41b598c]
- Updated dependencies [f5b8275]
- Updated dependencies [467b075]
- Updated dependencies [a56109e]
- Updated dependencies [84b89ed]
- Updated dependencies [b2cd2d3]
- Updated dependencies [e5b17ae]
- Updated dependencies [e78d27d]
- Updated dependencies [596ce81]
- Updated dependencies [b2b41eb]
- Updated dependencies [932821f]
- Updated dependencies [28181ed]
- Updated dependencies [c15eb60]
- Updated dependencies [33db45a]
- Updated dependencies [cec9beb]
- Updated dependencies [d4bda8d]
- Updated dependencies [8e7684c]
- Updated dependencies [87fb9c3]
- Updated dependencies [998ac87]
- Updated dependencies [d0a6c2c]
- Updated dependencies [35e0829]
- Updated dependencies [3f66b6f]
- Updated dependencies [61bdc2a]
- Updated dependencies [649d662]
- Updated dependencies [38adf84]
- Updated dependencies [7329865]
- Updated dependencies [84ed7b6]
- Updated dependencies [1064839]
- Updated dependencies [d2d9d79]
- Updated dependencies [f687479]
- Updated dependencies [074f500]
- Updated dependencies [7624db6]
- Updated dependencies [cec9beb]
- Updated dependencies [7be07f6]
- Updated dependencies [2614e4f]
- Updated dependencies [90320fd]
- Updated dependencies [bb21b86]
- Updated dependencies [79a17a3]
- Updated dependencies [3dab0be]
- Updated dependencies [e22b612]
- Updated dependencies [cb75825]
- Updated dependencies [a4455db]
- Updated dependencies [f3b2ec8]
- Updated dependencies [f093a02]
- Updated dependencies [d5a077f]
- Updated dependencies [86b9b39]
- Updated dependencies [42febee]
- Updated dependencies [447e829]
- Updated dependencies [2040ae9]
- Updated dependencies [fc7f669]
- Updated dependencies [40b76aa]
- Updated dependencies [eeed5c8]
- Updated dependencies [63a657b]
- Updated dependencies [0ecb287]
- Updated dependencies [9a27b93]
- Updated dependencies [2f0b69f]
- Updated dependencies [87b9b60]
- Updated dependencies [50d451b]
- Updated dependencies [98c0411]
- Updated dependencies [9f4eae3]
- Updated dependencies [a8261aa]
- Updated dependencies [f64646d]
- Updated dependencies [306a659]
- Updated dependencies [7ea72af]
- Updated dependencies [f6dda10]
- Updated dependencies [f6dda10]
- Updated dependencies [f6dda10]
- Updated dependencies [bfbcac2]
- Updated dependencies [ee6062c]
- Updated dependencies [820f089]
- Updated dependencies [f33ffed]
- Updated dependencies [4e668b5]
- Updated dependencies [843ed42]
- Updated dependencies [0d4c134]
- Updated dependencies [3f7b5ae]
- Updated dependencies [b98739c]
- Updated dependencies [6155f4b]
- Updated dependencies [bdcc9a4]
- Updated dependencies [5850aac]
- Updated dependencies [c042024]
- Updated dependencies [8a5725e]
- Updated dependencies [f915a24]
- Updated dependencies [8688a1f]
- Updated dependencies [95e5082]
- Updated dependencies [31c0430]
- Updated dependencies [0686447]
- Updated dependencies [691414b]
- Updated dependencies [8a06dc5]
- Updated dependencies [e118ee4]
- Updated dependencies [5fb3cd3]
- Updated dependencies [9eee781]
- Updated dependencies [bd47236]
- Updated dependencies [bd47236]
- Updated dependencies [79d15cf]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [398e6d2]
- Updated dependencies [51c5072]
- Updated dependencies [0e81803]
- Updated dependencies [2e287a5]
- Updated dependencies [fbc6c7c]
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
- Updated dependencies [8a0ec92]
- Updated dependencies [81fcc3f]
- Updated dependencies [12c63fa]
- Updated dependencies [2d6d031]
- Updated dependencies [72637e0]
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/email-components@0.112.0
