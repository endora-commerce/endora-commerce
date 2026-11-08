# @endora-commerce/mod-carts

## 0.110.0

### Minor Changes

- 0f1717c: Carts are gated by organization permissions, and cart approval is decided by the members' roles (`specs/170-organization-roles/`, OR-3). Breaking for a storefront or an integration that used the removed endpoints or reads the changed refusals:

  - `carts` declares three organization permissions: `carts.create` (member default), `carts.approve` and `carts.order_without_approval` (member default), with EN and PL labels.
  - `carts.create` gates `POST /api/v1/cart/items`, `PATCH`/`DELETE /api/v1/cart/items/:itemId`, `POST`/`DELETE /api/v1/cart/coupon` (a guest is not judged), `POST /api/v1/cart/from-quote-request/:quoteRequestId` and `POST /api/v1/cart/from-shopping-list/:shoppingListId`: a signed-in member whose role lacks it is refused `403 ORGANIZATION_PERMISSION_REQUIRED`. `GET /api/v1/cart` is not gated. The sign-in merge of a guest basket is skipped for such a member (`CartService.mergeAnonymousIntoCustomer` answers `skipped_permission`; the guest basket is kept).
  - Whether a basket must be approved is `!carts.order_without_approval` for its owner — for `primaryCta`, `POST /api/v1/cart/submit-for-approval` and the placement gate alike. `submit-for-approval` by a buyer holding the permission (an administrator included) answers `422 CART_APPROVAL_NOT_REQUIRED`; `CART_APPROVAL_SELF_SUBMIT` is no longer raised and is removed from the module's declared error codes, its bundles and `ERROR_CODES`.
  - `GET /api/v1/organization/carts`, `GET …/:id`, `POST …/:id/approve` and `POST …/:id/reject` need `carts.approve` (was: the `organization_admin` role; refused `403 FORBIDDEN`, now `403 ORGANIZATION_PERMISSION_REQUIRED`). Approving or rejecting one's own pending cart answers the new `422 CART_APPROVAL_SELF_APPROVE`, after the not-pending check. The "cart sent for approval" e-mail goes to every member whose role holds `carts.approve`.
  - A role gaining `carts.order_without_approval`, or a member moving to a role holding it, returns the affected `pending` carts to `not_required` (subscribers to `organization_role.permissions_changed.v1` and `customer_account.organization_role_changed.v1`, audited as `approval_policy_reset`).
  - Removed: `PATCH /api/v1/organization/policies/cart-approval`, `GET`/`PATCH /api/v1/admin/organizations/:id/cart-approval-policy`, the `organization.detail.after` zone contribution (`CartApprovalPolicy` / `CartApprovalPolicyPanel`) and its `policy.*` bundle keys, the `customers:manage` operator-permission declaration that backed the operator route, and `CartApprovalService`'s `getPolicyByAdmin`, `setPolicyByAdmin` and `setPolicyForOrganization`. `CartApprovalPolicyReads` is now `{ permissions }` (was `{ organizations, customerAccounts }`), and `organizationAdminRecipients(accounts, organizationId, submitterId)` is `approverRecipients(accounts, permissions, organizationId, submitterId)`.

- 9cc9aa0: Three cart routes are judged by the organization permissions other modules declare (`specs/170-organization-roles/` T137). Breaking for a storefront or an integration whose member's role lacks the code: the route now answers `403 ORGANIZATION_PERMISSION_REQUIRED`, naming the permission, where it reached the handler before.

  - `POST /api/v1/cart/items/:itemId/save-to-shopping-list` needs `shopping_lists.create`.
  - `POST /api/v1/cart/convert-to-quote-request` needs `quote_requests.create`.
  - `POST /api/v1/cart/from-shopping-list/:shoppingListId` needs `shopping_lists.convert`, judged before `carts.create`.

  All three codes are member defaults, so a migrated _Member_ role is unaffected.

- 9bfb0b8: The legacy two-value organization role is removed (`specs/170-organization-roles/`, WP-12). Breaking for every consumer that still names it. A member holds a role **id**, and what they may do follows from that role's permissions. Old → new:

  - `organizationRoleSchema` and `OrganizationRole` (`'organization_admin' | 'regular_user'`, from `common.ts`) are removed. Use `OrganizationRoleRef` (`{ id, name, kind }`) and `OrganizationRoleKind` (`administrator`, `member`, `custom`) instead.
  - `CustomerAccountRole` is removed, and so are `CustomerAccountRecord.role` and `CustomerAccountCreateInput.role`. Read and write `organizationRoleId` instead; it is required on create.
  - `CustomerAccountReadPort.countByOrganizationRole(organizationId, role, options)` is removed. Use `countAdministrators(organizationId, options)`, which takes the same options. `listByOrganization` still answers the Organization's _Administrator_ holders first, then by creation date.
  - `CustomerRolePort.changeRole(organizationId, customerAccountId, newRole)` is removed. Use `customerAccountRoleCommandPort.changeRole({ organizationId, customerAccountId, roleId })`, the `customer_account.change_role` Command. `customerRolePort` keeps `listMembers` and `removeMember`.
  - `RfqCustomerContext.isOrgAdmin` is removed. Ask `OrganizationPermissionPort.isAdministrator(subject)` instead (research R-30). `carts`, `orders`, `quick_order` and `shopping_lists` no longer pass it.
  - `OrganizationRecord.requiresCartApproval`, `OrganizationCartApprovalWritePort` (the container name `organizationCartApprovalWritePort` is no longer registered), `CartApprovalPolicyWriteResult`, `setCartApprovalPolicySchema` / `SetCartApprovalPolicy` and `cartApprovalPolicyResponseSchema` / `CartApprovalPolicyResponse` are removed, together with the `organization.set_cart_approval_policy` Command. Approval now follows the member's `carts.order_without_approval` permission (OR-3), and the policy endpoints were already removed.
  - On responses, `role` is no longer described on `customerAccountSchema`, `customerLoginResponseSchema`'s `customerAccount` or `impersonationStartResponseSchema`'s `impersonatedCustomerAccount`. `organizationRole` is now **required** on all three, and `permissions` is required on the first two: every producer sends them. `POST /api/v1/admin/organizations/:id/impersonate` (`admin_users`) no longer sends `role` and now sends `organizationRole`, read through `organizationRoleReadPort` (an acknowledged dependency on `organizations`); `POST /api/v1/admin/customers/:id/impersonate` (`customers`) always sends it.
  - The request schemas `inviteMemberRequestSchema` (`{ email, role? }`), `changeMemberRoleRequestSchema` (`{ role }`), `adminDirectMemberRequestSchema` (`role?`) and `adminPatchMemberRoleRequestSchema` (`{ role, expectedUpdatedAt? }`) are removed. Use `inviteMemberToRoleRequestSchema`, `assignMemberRoleRequestSchema`, `adminDirectMemberToRoleRequestSchema` and `adminAssignMemberRoleRequestSchema`, which take `roleId`. They stay strict, so a body that still sends `role` is refused with `400`.
  - The customers CSV export (`import_export`) carries `organization_role_name` (a predefined role's English label, or a custom role's name) and `organization_role_kind` (`administrator`, `member`, `custom`) in place of its `role` column. It reads them through `organizationRoleReadPort`, a new non-binding `degrades-without` edge on `organizations`. The export is export-only, so no import is affected.
  - `carts`' published bundles (`i18n/en.json`, `i18n/pl.json`) drop five unread keys that described the removed policy and the administrator-only approval: `approval.banner.pending`, `approval.banner.rejected`, `approval.banner.policy_on`, `approval.banner.policy_off` and `reject.email.body`.
  - The `CustomerAccount` entity loses `role`. `Organization` loses `requiresCartApproval`, and `OrganizationInvitation` loses `role`, so its `organizationRoleId` is now required. Nothing writes the legacy value any more.
  - New migrations `Migration20261104T094535OrganizationsDropLegacyRoleColumns` (M4) and `Migration20261104T094540CustomerAccountsDropLegacyRoleColumn` (M5):
    - M4 drops `organizations.requires_cart_approval`, `organization_invitations.role` and the invitation default trigger that read it.
    - M5 drops `customer_accounts.role` with its index.
    - M5 also redefines the account default: an account inserted without a role holds _Administrator_ in a personal Organization, else _Member_.
    - Each `down()` re-derives the dropped values from the role reference.

- bf1cc2d: The cart read answers its VAT per rate, the way the order computes it (issue #436).

  - `@endora-commerce/contracts`: new `cartVatSchema` / `CartVat` and `cartVatRowSchema` / `CartVatRow`. `cartFullPayloadSchema` gains `vat` (`CartVat | null`, default `null`): one row per rate (`taxRate`, `net`, `vat`, `gross`), `vatTotal`, `subtotalGross` and `grandTotalGross`. `cartViewLineSchema` gains the optional `taxRate` (a fraction) and `lineGross` (the line's own rounding of its gross, informational). All additive: a reply without them parses as before.
  - `@endora-commerce/mod-carts`: `GET /api/v1/cart` (the full view) answers `vat` and each line's `taxRate` and `lineGross`. The rates are resolved as placement resolves them — the product's tax class against the Organization's VAT status and registered country — and the VAT is the contracts' `vatByRate`: per rate, on the sum of the line nets, rounded half-up once; gross = net + VAT; the discount comes off the gross untaxed. For the same lines the cart's gross grand total equals the order total before delivery and the payment surcharge. The line-mutation replies answer `vat: null`, as does a read whose rate resolution failed; the mini view (`?view=mini`) is unchanged. The module now declares `taxes` as a dependency (it resolves `taxService`).

- 77b8c37: **Breaking:** `CartWritePort.clearForCustomer(ctx)` is removed from the published cart write port (`@endora-commerce/contracts`), and with it the adapter's `clearForCustomer` and `CartService.clearForCustomer` in the `carts` module. It deleted every line of the customer's active basket and marked the basket `completed` without an order, which reads as a finished basket that produced nothing (the defect issue #169 fixed); since #169 no code of the platform calls it.

  A module that called it does one of these instead:

  - **To place an order for a customer**, write the lines into a working basket — `const basket = await cartWritePort.addItems({ customer }, lines, { onLineError: 'throw', workingBasket: true })` — and place from it with `orderPlacementPort.placeOrder(ctx, request, { workingBasketId: basket.cart.id })`. The customer's active basket is not touched.
  - **To replace what is in the customer's basket**, call `cartWritePort.replaceItemsForCustomer(ctx, lines)`; the basket stays active. `replaceItemsForCustomer(ctx, [])` leaves it active and empty.

  A test that reset a buyer's basket with `clearForCustomer` needs a fixture of its own; the platform's tests delete the basket row (`delete from "carts" where "customer_account_id" = ? and "sales_channel_id" = ? and "status" = 'active'`, lines and audit entries cascade).

- 65104b8: **Breaking:** order placement now enforces cart approval (issue #648). In an Organization that requires cart approval (`requiresCartApproval`), a member's basket that is not `approved` — never sent for approval, awaiting the Organization administrator, or rejected — is refused by `POST /api/v1/orders` (and so by the storefront checkout page, which calls it) with `409 ORDER_CART_APPROVAL_REQUIRED`, before anything is reserved or written; the basket is kept as it was. Such baskets were placed until now: only the storefront's call to action stood in the way. An Organization administrator's own basket and every basket of an Organization without the policy are placed as before, and so are orders placed from a working basket (admin order creation, one-click buy, the external order API).

  - `@endora-commerce/contracts`: `ERROR_CODES.ORDER_CART_APPROVAL_REQUIRED`. Its `details` are `{ code, cartId, approvalStatus }`, with `code` one of `cart_approval_not_submitted`, `cart_approval_pending`, `cart_approval_rejected`; `orders` declares the code with English and Polish sentences per token.
  - `@endora-commerce/mod-carts`: `CartPlacementApplyPort` (`@endora-commerce/mod-carts/ports`) gains a required `awaitsApproval({ cart, organizationId })`, answering whether the basket still awaits its Organization's approval. A hand-written implementation of the port must add it; `CartPlacementApplyService` takes the reads it is judged from (`{ organizations, customerAccounts }`) as a new fourth constructor argument.
  - `@endora-commerce/mod-orders`: `OrderService.placeOrder` asks it for the customer's active basket and refuses as above.

  An instance whose members order without sending baskets for approval will see those orders refused once it upgrades: such a member now sends the basket for approval and the administrator approves it, or the Organization switches the policy off (`PATCH /api/v1/organization/policies/cart-approval`).

- 54fc8f1: After an approver rejects a member's basket, the member's next basket starts with the rejected basket's lines (issue #755).

  - **The lines come back once.** When a basket is opened for a member whose most recent basket on the channel was rejected (the rejection still in force, as `previousRejection` reads it), each of its lines (product, variant, packaging unit and quantity) is added as the member would add it now, so it is checked for availability and priced afresh. This happens only where a basket is created, so an existing basket is never touched. It does not run again after the member empties or abandons the restored basket, and it does not carry the coupon over. A member whose role lacks `carts.create` gets nothing restored. Each restored line lands its usual `line_added` audit row, and the restore itself lands `lines_restored_from_rejection` on the new basket, with the source basket, the restored count and the skipped lines in its metadata. The rejected basket is left as it was.
  - **The rejection notice says what was restored.** In `@endora-commerce/contracts`, `cartPreviousRejectionSchema` gains `restoredLineCount` (default `0`) and `skippedLines` (the `droppedLines` line shape, default `[]`), so a reply without them still parses. `CartPreviousRejection` now has both keys, so code that builds one must set them.
  - `CartAuditAction` gains `lines_restored_from_rejection`.

- c34b405: `carts` provides `cartAnonymizationPort` (issue #920). For every cart of an anonymised customer account it sets `Cart.rejectedReason` and the `reason` of the cart's `cart_audit_entries` rows to `null`; the cart's status, `rejectedAt`, `rejectedByActor` and every other column, and the history's actions, actors, states and metadata, are kept. Each cart it changed gets one `cart.anonymized` platform audit entry with a null actor and `stateBefore: { hadRejectedReason }` only. A cart with no reason left is not touched, so a repeat call writes and records nothing; no event is published. A cart the account only approved or rejected for a colleague is not its cart and is left alone. `cart_audit_entries` is append-only except for this one update.
- de01fbb: The cart-approval e-mails are sent (issue #651). `CartApprovalService` called an optional `CartEmailDispatch` that the `carts` composition never supplied, so nobody was told about a submit, an approve or a reject. The composition now supplies one, `createCartApprovalEmailDispatch` (`services/cart-approval-emails.ts`), which sends through `transactional_emails`:

  - `cart_approval_requested` — to every active, unblocked administrator of the buyer's Organization when a member sends a cart for approval;
  - `cart_approved` — to the buyer, naming who approved it;
  - `cart_rejected` — to the buyer, with the reason.

  Each is rendered in the default language of the cart's sales channel (`en-US` when it has none), with default subjects and bodies in `en-US` and `pl-PL` that an operator can edit or switch off on the e-mail templates screen. A message that does not go out is written to the log and never fails the approval step.

  The module now declares `transactional_emails` in `dependencies` and takes `@endora-commerce/email-components` as a peer dependency.

- 0801f69: Six refusals of `carts` have an error code of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish (issue #86). **A client that matches on `VALIDATION_FAILED`, or on
  the token that was the message, for these cases now sees the specific code**; the HTTP status of
  each is unchanged (`422`). Until now the message was a machine token, which the error envelope
  never replaces for `VALIDATION_FAILED`, so the buyer and the operator read the token in every
  language.

  | Route                                                       | Was (`422 VALIDATION_FAILED`, message) | Is (`422`)                        | `details`                  |
  | ----------------------------------------------------------- | -------------------------------------- | --------------------------------- | -------------------------- |
  | `POST /api/v1/cart/submit-for-approval`                     | `approval_not_required`                | `CART_APPROVAL_NOT_REQUIRED`      | —                          |
  | `POST /api/v1/cart/submit-for-approval`                     | `approval_already_initiated`           | `CART_APPROVAL_ALREADY_SUBMITTED` | `cartId`, `approvalStatus` |
  | `POST /api/v1/cart/submit-for-approval`                     | `org_admin_self_submit`                | `CART_APPROVAL_SELF_SUBMIT`       | —                          |
  | `POST /api/v1/organization/carts/:id/approve` and `/reject` | `approval_not_pending`                 | `CART_APPROVAL_NOT_PENDING`       | `cartId`, `approvalStatus` |
  | `POST /api/v1/admin/carts/:id/reject`                       | `already_terminal`                     | `CART_ALREADY_TERMINAL`           | `cartId`, `status`         |
  | `POST /api/v1/cart/from-quote-request/:quoteRequestId`      | `quote_request_empty`                  | `RFQ_EMPTY`                       | `quoteRequestId`           |

  `RFQ_EMPTY` is the existing code of `quote_requests`, answered with its sentence; the other five are
  new members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `carts` manifest. No
  setting, permission or migration changes.

- d1c0d13: Two additive reads for the storefront's cart-approval screens (issue #650).

  - **The buyer learns their basket was rejected.** A rejection closes the basket (`status = 'rejected'`), so the buyer's next `GET /api/v1/cart` was a new basket whose `approvalStatus` could never say `rejected_by_org_admin`, and the reason was shown nowhere. Every full cart answer (`GET /api/v1/cart` and the line, coupon and quantity answers) now carries `previousRejection: { cartId, rejectedAt, reason } | null`: the buyer's most recent rejected basket on the request's sales channel, while the current basket has not been sent for approval and no basket of theirs on that channel has been ordered or converted to a quote request since. It is `null` otherwise, and for an anonymous basket. In `@endora-commerce/contracts`, `cartFullPayloadSchema` gains the field as `cartPreviousRejectionSchema.nullable().default(null)`, so a reply without it still parses; `CartFullPayload` now has the key, so code that builds one must set it.
  - **The administrator sees what they approve.** `GET /api/v1/organization/carts/:id` now answers `items`: each line's `id`, `productId`, `variantId`, `displayName` (in the response language, the packaging unit appended), `productSku`, `quantity`, and `unitPrice` and `lineTotal` as stored. The new `orgCartDetailViewSchema` / `orgCartDetailViewResponseSchema` describe that route as it answers; the older `orgCartDetailPayloadSchema` never matched it and is left unchanged.

  `CartsOrganizationRoutesDeps` (the options of `registerCartsOrganizationRoutes`) gains a required `catalogProducts` member; the module's own composition provides it.

- bf1f8a3: **Behaviour break:** a cart awaiting approval that its member changes is no longer approvable as it
  is; the buyer must submit it again (issue #649, owner ruling 2026-11-03).

  A content change on a `pending` cart — `POST /api/v1/cart/items`, `PATCH` or `DELETE
/api/v1/cart/items/:itemId`, `POST` or `DELETE /api/v1/cart/coupon` — now returns it to
  `approval_status: 'not_required'`, the state it was submitted from, clears
  `submitted_for_approval_at`, and records an `approval_resubmission_required` audit entry
  (`pending` → `not_required`). Until now the cart stayed `pending`, so an Organization administrator
  could approve contents other than those the buyer submitted. After the change the cart is gone
  from `GET /api/v1/organization/carts?approvalStatus=pending`, `POST
/api/v1/organization/carts/:id/approve` and `…/reject` answer `422 CART_APPROVAL_NOT_PENDING`,
  and the cart answers give `primaryCta: 'submit_for_approval'` again. A client that relied on an
  edited cart staying `pending` must offer the submit again.

  The re-arm of an `approved` cart (back to `pending`) is unchanged, except that a quantity set to
  the value it already had is no longer a change and re-arms nothing. Both transitions are now
  written in the same transaction as the change they react to; they used to be a second write after
  it.

  `CartApprovalService.maybeReArm(cart, actor)` is replaced by the synchronous
  `reArmWithin(em, cart, actor)`, which stages the transition and its audit row on the caller's
  entity manager and flushes nothing — call it before the flush that writes the change.

### Patch Changes

- 0ab9c96: A signed-in member's cart answers (`GET /api/v1/cart`, every cart write's reply and `POST /api/v1/cart/submit-for-approval`) judge the cart-approval rule with the role the request's actor already carries, so the permission port no longer reads the member's account on each of them (`specs/170-organization-roles/` FR-080, SC-004). `CartsDeps.resolveCartActor`'s and `CartsOrganizationRoutesDeps.resolveCartActor`'s `customer`, `CartsDeps.cartApprovalPolicy`'s buyer and `ApproveActor` gain an optional `organizationRoleId`; a composition that does not pass it is served as before. No response changes.
- 8b5f126: `CartPlacementApplyPort.awaitsApproval` takes an optional `organizationRoleId`, the basket owner's organization role when the caller knows it (`specs/170-organization-roles/` FR-080). With it the cart-approval rule is judged from the role cache and the owner's account is not read; a caller that does not pass it is served as before.
- 3f020ba: Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
- 45c9893: The organization role form, on the storefront and in the admin Roles tab, heads the Addresses, Carts, Orders, Quote Requests and Returns permission groups in the reader's language. The five modules now ship `module.name` in English and Polish ("Adresy", "Koszyki", "Zamówienia", "Zapytania ofertowe", "Zwroty"); before this, Polish pages showed the English manifest name.
- 5e4dd48: The Organization cart surfaces name a cart's owner and the order a completed cart produced; the auto-created default shopping list gets a published marker (issue #751).

  - `orgCartSummarySchema` — and with it `orgCartDetailViewSchema` and `orgCartsListResponseSchema` — gains two required fields: `ownerEmail: string | null`, the owner's e-mail (`null` when the account can no longer be read), and `orderId: string | null`, the order a completed cart produced (`null` for any other cart). A consumer that builds these shapes by hand must now supply both.
  - `ownerDisplayName` on `GET /api/v1/organization/carts` and `GET /api/v1/organization/carts/:id` is now the owner's first and last name; it falls back to the e-mail for an owner with no name, then to the account id. It was the e-mail alone — read `ownerEmail` where the e-mail is what you need.
  - New `SHOPPING_LIST_AUTO_DEFAULT_NAME` (`'Default'`, the name `shopping_lists` stores on the default list it creates) and `isAutoDefaultShoppingList({ name, isDefault })`: whether a list is that default and still carries that name, so a storefront can name it in the shop language. `shopping_lists` creates the list with the constant; what it stores is unchanged.

- 75b053f: A customer record read by an id that is not a UUID answers `404` with the route's own not-found code, exactly as a well-formed id that names nothing does, instead of `500` (issue #753). This covers `GET /api/v1/orders/:id` (`ORDER_NOT_FOUND`), `GET /api/v1/returns/:id`, `GET /api/v1/quote-requests/:id`, `GET /api/v1/shopping-lists/:id` and `GET /api/v1/organization/carts/:id` (`NOT_FOUND`), and every other route that reads its record through the same lookup.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- 14fe4fb: A product's gross price uses that product's own VAT rate for the buyer, not a flat 23 % (issue #852).

  - `@endora-commerce/contracts`: `productSummarySchema` (and so `productDetailSchema`) gains the optional `vatRate` — the buyer's VAT rate for the product as a fraction, `null` where it could not be resolved. Additive: a reply without it parses as before. New `createProductTaxRateResolver` / `ProductTaxRateResolver`: the rate rule the cart applied since issue #436 — the product's tax class against the Organization's VAT status and registered country through `OrganizationTaxProfilePort` and `TaxServicePort`, `0` for a VAT-exempt or reverse-charge Organization, a buyer with no Organization a VAT payer in PL — moved here so the cart and the catalogue resolve one rule.
  - `@endora-commerce/mod-catalog`: `GET /api/v1/catalog/products` and `GET /api/v1/catalog/products/:idOrSlug` answer `vatRate` on every product. It depends only on the viewer's Organization, so it follows the price's cache rule: a reply for a caller naming an Organization is `private, no-store`, and the shareable anonymous reply carries the guest's rate. A failed resolution answers `vatRate: null` rather than refusing the listing. The module now declares `taxes` as a dependency (it resolves `taxService`) and acknowledges `organizations`' `organizationTaxProfilePort`.
  - `@endora-commerce/mod-carts`: the cart's rates come from the contracts' `createProductTaxRateResolver`; the module's own `cart-tax-rates.ts` is gone. No change to what the cart answers.
  - `@endora-commerce/mod-price-lists`: the display-mode documentation says how a gross price is derived.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
- 87bed2b: Cart approval works end to end (issue #619). For an Organization that requires cart approval:

  - `POST /api/v1/cart/submit-for-approval` now stores the cart as `pending`, with its audit entry, in one write. It used to answer `200 { approvalStatus: 'pending' }` and store nothing, so a second submit was accepted again; it is now refused with `422 CART_APPROVAL_ALREADY_SUBMITTED`.
  - An Organization administrator now reaches the carts of every member of their own Organization on `GET /api/v1/organization/carts`, `GET /api/v1/organization/carts/:id`, `POST …/:id/approve` and `POST …/:id/reject`. These read only the administrator's own carts before, so a member's cart answered `404 NOT_FOUND` and the list showed none. A cart of another Organization still answers `404`, and a member who is not an administrator is still refused with `403 FORBIDDEN`.
  - Switching the policy off through `PATCH /api/v1/organization/policies/cart-approval` now returns every member's pending or approved cart to `not_required`; it reset only the administrator's own before.
  - Changing an approved cart now stores it as `pending` again, as the re-arm rule says; the change was not stored before.
  - The cart answers (`GET /api/v1/cart` and the line, coupon and quantity answers) now give `primaryCta: 'submit_for_approval'` for a basket a member must send for approval. It was always `checkout`, so the storefront offered checkout instead of the submit.

  `CartsDeps` (the options of `registerCartRoutes`) gains a required `cartApprovalPolicy` member; the module's own composition provides it.

- Updated dependencies [18cce2e]
- Updated dependencies [18cce2e]
- Updated dependencies [9cfb28b]
- Updated dependencies [a206da9]
- Updated dependencies [34485ae]
- Updated dependencies [34485ae]
- Updated dependencies [0f1717c]
- Updated dependencies [86e8761]
- Updated dependencies [9bfb0b8]
- Updated dependencies [ed5cf6a]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [5303aab]
- Updated dependencies [16f85f4]
- Updated dependencies [270aa2b]
- Updated dependencies [3f020ba]
- Updated dependencies [3f020ba]
- Updated dependencies [b59e5d5]
- Updated dependencies [b59e5d5]
- Updated dependencies [bf1cc2d]
- Updated dependencies [ff60e93]
- Updated dependencies [6f19230]
- Updated dependencies [06cf85b]
- Updated dependencies [77b8c37]
- Updated dependencies [65104b8]
- Updated dependencies [7acaa33]
- Updated dependencies [7019c71]
- Updated dependencies [4eee98b]
- Updated dependencies [14ac256]
- Updated dependencies [248bf1b]
- Updated dependencies [b2db8c3]
- Updated dependencies [4cf529d]
- Updated dependencies [5e4dd48]
- Updated dependencies [75b053f]
- Updated dependencies [54fc8f1]
- Updated dependencies [dac5795]
- Updated dependencies [5bbb389]
- Updated dependencies [d69e765]
- Updated dependencies [dbc1cef]
- Updated dependencies [d69e765]
- Updated dependencies [a6bc891]
- Updated dependencies [8ad737c]
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [cea1470]
- Updated dependencies [d46d414]
- Updated dependencies [73e2eec]
- Updated dependencies [29d7e90]
- Updated dependencies [7f2fa6e]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
- Updated dependencies [e46d233]
- Updated dependencies [58a1632]
- Updated dependencies [b476f44]
- Updated dependencies [14fe4fb]
- Updated dependencies [76d89ab]
- Updated dependencies [5cbffb9]
- Updated dependencies [6bd2ab7]
- Updated dependencies [a3502c0]
- Updated dependencies [7a73cc8]
- Updated dependencies [5ff8302]
- Updated dependencies [fc7db4c]
- Updated dependencies [c34b405]
- Updated dependencies [5af8c25]
- Updated dependencies [48f055e]
- Updated dependencies [bf50b85]
- Updated dependencies [2c6fba0]
- Updated dependencies [0801f69]
- Updated dependencies [d1c0d13]
- Updated dependencies [6d1d284]
- Updated dependencies [974be57]
- Updated dependencies [99c075e]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0
  - @endora-commerce/platform@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0

## 0.109.0

### Minor Changes

- bdd04a7: The acquisition seams ask `catalogProductAvailabilityPort` (product data scopes per sales channel and language) instead of testing membership, audience or status themselves.

  - **Behaviour change for API clients — basket:** adding a product to the basket (single add and the batch add behind quick order, shopping-list and quote conversions) is refused with `404 PRODUCT_NOT_FOUND` — the answer an absent product gets — when the product is not effectively available at the basket's channel and the request's language (switched off there, outside its publication window, or outside the channel's audience rule). The add path used to test no status at all, so a `draft` member product could be put in a basket. A line whose product goes off after it was added stays in the basket and reads `unavailable` (`unavailableReason: 'not_purchasable'`); submitting the basket for approval and placing the order refuse it with `404 PRODUCT_NOT_FOUND` and its `cartItemIds`, and the checkout preview lists it as `product_unavailable`. The cart's up-sell strip shows only available products.
  - **Orders:** the admin order preview reports a member product that is not available in the chosen channel (at its default language) as `PRODUCT_NOT_IN_SALES_CHANNEL`. Reorder and quote conversion are unchanged (their lines are refused at placement as above).
  - **Quote requests:** a buyer's request (create, draft edit, resubmit) naming a product not available at the request's channel and language is refused with `404 PRODUCT_NOT_FOUND`. `POST /api/v1/admin/quote-requests` still accepts such a line and answers `warnings: [{ productId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]` beside `data` (only when there is one).
  - **Comparisons and shopping lists:** a product not available at the request's channel and language cannot be added or saved (`404 PRODUCT_NOT_FOUND`); a comparison column reads `available` from the same answer; a saved line whose product went off is skipped on conversion as `product_not_found`.
  - **Quick order:** a pasted SKU of a product not available in the request's channel is rejected as `product_not_found`; the operator's import arm is unchanged.
  - **Effective names (FR-017):** basket line names and batch below-minimum outcomes, quote-request line snapshots (buyer: request language; operator: channel default) and comparison names and compared values follow the channel's overrides at the request language.

- 3f046c8: A basket line ordered by a packaging unit, added by a caller that names the channel itself (`CartWritePort.addItem` / `addItems` with `salesChannelId`, an operator surface), snapshots the unit's name at that channel's default language — its translation there, else the global name — like the product name beside it. It used to take the global name. `CartService` takes the kernel's `salesChannelResolutionPort` as a new optional last constructor argument, read only when a unit is named.
- 22604fa: Attachments per sales channel and language, packaging-unit names per language (product data scopes, FR-078, FR-079).

  - **Attachments:** create and update (`POST` / `PATCH /api/v1/admin/catalog/products/:productId/attachments…`) accept `nameTranslations` and `descriptionTranslations` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). A newly hidden channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing is always allowed. The admin DTO carries all three. The product page leaves out an attachment hidden in the request's channel and serves its name and description in the request's language, else the global ones.
  - **Packaging units:** create and update accept `nameTranslations` (the admin schemas stay strict). The admin DTO and `CatalogPackagingUnitRecord` carry it. The product page's `packagingUnits[].name` is the name in the request's language, else the global name.
  - **Basket snapshot:** a basket line ordered by a packaging unit stores the unit's name in the basket's language (`effectivePackagingUnitName`) and keeps it after a rename; the order line copies it. A buyer's quote-request line (create and draft edit) appends the unit's name in the request's language on its channel, else the global name, and keeps it; a line naming its unit by name and base quantity is still matched on the global name.
  - **Auditing:** these writes run the existing Commands `product_attachment.create` / `.update` and `packaging_unit.create` / `.update`, one audit entry per request. The route-level `attachment.create`, `attachment.update` and `product_packaging_unit` rows are no longer written beside them. The projections carry `productId`, the translations and `hiddenInChannels`; re-sending `before` without `productId` restores the row. They emit `product.updated.v1` with `changedFields: ['attachments']` / `['packagingUnits']`; a request that changes nothing writes and emits nothing. EN/PL audit labels added.
  - **Scope overview:** lists `attachments:hidden` per channel and `attachments:name`, `attachments:description`, `packagingUnits:name` per language.
  - **Contracts:** `ATTACHMENT_DESCRIPTION_TRANSLATION_MAX`.
  - **Migration** `catalog` `attachment_packaging_translations`: columns `product_attachments.name_translations`, `.description_translations`, `product_packaging_units.name_translations`, table `product_attachment_channel_hidden`. No backfill.

- eba4fd8: A quote's validity date now binds order placement, not only the conversion into a basket (issue #167). A basket line filled by `convert-to-order` names its quote (`CartItemRecord.quoteRequestId`, column `cart_items.quote_request_id`, backfilled from the basket's `source_quote_request_id`), and placement refuses every line still priced at its agreement with `410 QUOTE_VALIDITY_ENDED` once that quote's `expiresAt` has passed (`details.code: 'lapsed'`), once it no longer applies — re-opened, cancelled, expired or gone (`'withdrawn'`) — or while `quote_requests` is off and nothing can confirm the prices (`'unavailable'`, fail-closed; this used to place the basket at the agreed prices). The order-total preview answers the same verdict as `quoteCommitmentRefusal` (`quoteCommitmentRefusalSchema` in `@endora-commerce/contracts`), `null` when nothing is refused. `QUOTE_VALIDITY_ENDED` declares the three reasons as refusal tokens, with sentences in English and Polish.
- b7baf8a: Admin order creation, one-click buy and the external order intake no longer empty and close the
  customer's active basket (issue #169). They place the order from a separate **working basket**
  written from the request's lines, through the same `placeOrder`; the customer's basket — one
  filled from an accepted quote request included — is left exactly as it was, whether the order is
  placed or refused.

  - **`@endora-commerce/contracts`** — `CartWritePort.addItems`' option `replaceExisting` is
    replaced by `workingBasket`. Old: `addItems(actor, lines, { onLineError: 'throw', replaceExisting: true })`
    emptied the active basket and wrote the lines into it. New:
    `addItems(actor, lines, { onLineError: 'throw', workingBasket: true })` writes them into a new
    cart in status `working` and returns it; the active basket is not touched. Pass the returned
    `cart.id` as `OrderPlacementPort.placeOrder`'s new option `workingBasketId` to place from it.
    `cartStatusSchema` gains `'working'`.
  - **`@endora-commerce/mod-carts`** — migration `cart_status_working` widens `carts_status_check`
    to `working`. `CartPlacementApplyPort` gains `readWorkingForPlacement(em, ctx & { cartId })` and
    `discardWorkingBasket({ cartId, customerAccountId })`; an implementation of the port has to
    provide both. A working basket ends `completed` with `completed_order_id` set, or is deleted
    when the placement is refused; it is never listed (admin carts list, organization carts list,
    the customer's carts panel) and never swept.
  - **`@endora-commerce/mod-orders`** — `OrderService.placeOrder` accepts `workingBasketId`; admin
    order creation and the external intake place from a working basket.
  - **`@endora-commerce/mod-quick-order`** — one-click buy places from a working basket.

### Patch Changes

- 07f3764: Minimum order quantity and "returnable" per sales channel (product data scopes, FR-100).

  - **Behaviour change:** a product's channel override of its minimum order quantity or its returnable flag (`product_channel_scopes`, written through `PATCH /api/v1/admin/catalog/products/:id/scopes`) now applies in that channel. Adding to the basket (single, batch and quick-order build), the basket view, submitting a basket for approval, the checkout preview, placement, the admin order preview, quote requests (create, draft edit, resubmit, the operator's per-line warning) and the buyer's quick-order import judge the minimum of the basket's, order's or request's channel; a channel minimum of 1 means no minimum there. Placement stamps `order_items.returnable_at_purchase` from the order channel's flag, so returns follow it. Without an override nothing changes.
  - **Storefront read model:** `minOrderQuantity` on the product detail and listing summaries is the request channel's value.
  - **Contracts:** new `withChannelOrderRules(records, rules)` puts the rules of `catalogProductAvailabilityPort.effectiveOrderRules` into a set of product records for one seam; `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning the global values.

- 473ef09: Storefront links on the basket, the search results, comparisons and the quick-order type-ahead use the product's effective URL key at the request's sales channel and language (product data scopes), as the product page and the catalogue listing already did.

  - **Behaviour change for API clients:** `productSlug` of a basket line and of an up-sell candidate, `slug` of a Meilisearch result card, of a comparison column and of a quick-order search hit is the channel × language key, else the language key, else the global key. A product with its own key in a language used to be linked by its global key, which answers 404 in that language when `seo` is off. A basket line whose product is unavailable still has `productSlug: null`.
  - **Also:** a Meilisearch result card and a comparison column report the request channel's `minOrderQuantity`.
  - `search` and `comparisons` resolve `catalogProductUrlKeyReadPort`; `catalog` is already a dependency of both.

- 9a38360: **BREAKING — `cartViewLineSchema.productSlug` is `string | null | undefined`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A basket line whose product is unavailable carries `productSlug: null`, so a reader that typed it as `string | undefined` must handle `null` (render the line without a product link); `productSku` is new beside it.

  Product data scopes reach the basket view and the two external API seams that did not follow them yet.

  - **Basket view:** a line whose product is no longer available at the basket's sales channel and language keeps its `productName` and `productSku`, reads `unavailable: true` (`unavailableReason: 'not_purchasable'`), and has `productSlug: null`, so the storefront shows it without a link to a product page that answers `404` there. Placing the order still refuses it. `cartViewLineSchema` types `productSlug` as nullable and gains `productSku`.
  - **External order intake** (`POST /api/v1/external/orders`): after the existing per-line checks, every line's product must be available at the key's sales channel (its default language) to the calling key's Organization — not switched off there, inside its publication window, admitted by the channel's audience rule. A product that is not answers what a product hidden from the bound Organization already answered: `404 PRODUCT_NOT_FOUND`, no name, nothing placed. An unknown or unpublished SKU keeps its per-line `422 VALIDATION_FAILED` (`SKU_NOT_IN_ASSORTMENT`), which takes precedence. The availability rule decides the status, so the SKU read no longer drops a product that is off globally: one that is on in the key's channel is orderable, one that is off there answers the `404`. `OrderApiIntakeService` takes `catalogAvailability`, and `place` takes the caller's `audience`.
  - **External bulk prices** (`POST /api/v1/external/catalog/prices`): a product not available to the calling key's Organization at the key's channel gets no price and reads `sku_not_in_assortment` — before, a product restricted away from that Organization was priced. `resolveBulkPrices` takes the caller's `audience`; the external catalogue namespace is mounted only with `catalog`'s own availability port.

- df0a90e: A buyer's quote line is judged at the request's scope language, as a basket line is. `CreateForCustomerOptions` gains `languageTag` — the request's first `Accept-Language` tag, resolved against the channel's own languages — and `RfqService.createForCustomer`, `patchDraft` and `resubmit` ask `catalogProductAvailabilityPort` and snapshot line and unit names at it; absent, at the channel's default language. `language` is now a message language only: it used to decide the scope too, so a buyer asking in a language the message bundles do not carry (`de-DE` answered in Polish) was quoted a product switched off in that language. The customer quote routes, the basket's conversion to a quote request (`CartConversionService.convertToQuoteRequest`'s options gain `languageTag`) and the buyer's quick-order build to a quote request (`QuickOrderBuildOptions.languageTag`) pass the tag.
- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- fdd026b: Every admin screen of these four modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords.

  - `@endora-commerce/mod-taxes` declares the `open-taxes` action for the tax-rule table (`taxes:read`).
  - `@endora-commerce/mod-blog` declares `open-blog-posts`, `open-blog-categories` and `open-blog-tags` (`blog.read`) beside the existing `new-post`.
  - `@endora-commerce/mod-carts` declares the `open-carts` action and a sidebar entry under _Sales_ for the platform-wide cart list (`carts:read`). The list was previously reachable only by typing its address.
  - `@endora-commerce/mod-mfa` declares the `open-security` action and a sidebar entry under _System_ for the signed-in admin's own two-factor authentication screen. Neither carries a permission code, like the screen itself: every admin manages their own second factor.

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 3174251: The cart-view serialisers are typed by the published contract (issue #128).

  The functions behind `GET /api/v1/cart`, `GET /api/v1/cart?view=mini` and the line-mutation replies returned inferred object literals, so the compiler held them to nothing. They now return `CartFullPayload` and `CartMiniPayload` from `@endora-commerce/contracts`, empty basket included: a required field that stops being emitted, or a value of the wrong type, is a compile error. No reply changed.

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
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
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

## 0.108.0

### Minor Changes

- 0bd5a2b: The cart enforces minimum order quantities and adds lines in batches.

  - **Behaviour change for API clients — add and edit are refused below a minimum.** `POST /api/v1/cart/items` and `PATCH /api/v1/cart/items/:itemId` judge the cart as the change would leave it (the product's total over every line and variant) and refuse with `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, message in the buyer's language, nothing written. An edit to `0` and `DELETE` still remove the line. Editing a line whose product no longer exists answers `404 PRODUCT_NOT_FOUND`.
  - **Cart view.** `GET /api/v1/cart` gives each line `minOrderQuantity` and `belowMinimum` (`{ kind, minimum, packagingUnitName? }` or `null`). A line whose product record was hard-deleted is reported `unavailable: true` (`unavailableReason: 'not_purchasable'`). **If the catalogue cannot be read the view now answers `5xx`** instead of a cart without these flags. `?view=mini` is unchanged.
  - **Behaviour change for API clients — submit for approval is refused below a minimum.** `POST /api/v1/cart/submit-for-approval` now judges the basket as placement judges it and refuses a basket with a line below a minimum with `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (every offending line in `details.lines` with its `cartItemId`, message in the request's language), or a line whose product no longer exists with `404 PRODUCT_NOT_FOUND` (`details.cartItemIds`); the cart stays `not_required`. A basket that cannot be ordered can no longer be sent for approval. **A quote-seeded line is exempt at submit only once its quote is confirmed still valid** — the submitter's organization's, `Approved`, not expired, not yet ordered, an agreed line still on the basket — through `mod-orders`' new `orderQuoteSourcePort`, the checkout preview's check; while `quote_requests` is off nothing is exempt. A basket whose quote has lapsed is therefore refused at submit although the cart view, which trusts the quote mark, does not flag it. `CartApprovalService` takes the catalogue read port and the `OrderQuoteSourcePort` as new constructor arguments, before the optional e-mail dispatch.
  - **Quote-seeded exemption, by state.** A line seeded from an accepted quote request is exempt from the minimums while its quantity equals the quote's — the quantity its agreed price holds at (`cart_items.agreed_quantity`; no new column); changing it makes it an ordinary line until it is set back. The cart takes the mark at face value; checkout and placement in `mod-orders` confirm the quote is still valid.
  - **Batch add: `CartWritePort.addItems`** (and `CartService.addItems`), up to 200 lines per call. Every line is resolved first with the single add's checks, then the resolved lines are judged together with the cart and only those that pass are added; the rest come back as `below_minimum` or `failed` outcomes. With `onLineError: 'throw'`, **a batch with an unknown or hidden product now fails before any line is added**.
  - **Batch add modes.** `addItems` takes `onBelowMinimum: 'throw'` — any line below a minimum refuses the whole batch with `422 PRODUCT_BELOW_MINIMUM_QUANTITY` / `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (`details.lines[]` by `index`) before anything is written — and `replaceExisting` (customers only, and only with `onLineError: 'throw'`), which judges the batch alone and clears the customer's active cart only after it has passed — with `onLineError: 'throw'`, after the write step's own pricing refusals (`CART_PRODUCT_UNPRICED`, `CART_PRODUCT_QUOTE_ONLY`) have been judged too — so a refused request leaves the basket exactly as it was.
  - **Behaviour change for API clients — product names follow the response language.** Minimum refusals and the cart view's line names use the language the response is answered in (`request.responseLanguage()`: the q-sorted `Accept-Language`, else the channel's default language), so `Accept-Language: en;q=0.2,pl;q=0.9` now names products in Polish, like the sentence around them. A `GET /api/v1/cart` without `Accept-Language` now names lines in the channel's default language, not English.
  - **Quote request → cart** now adds the quote's lines as one batch. A line below a product's minimum is dropped with reason `below_minimum` and its `minimum` (it was reported as `no_price_in_customer_list`); a product the buyer may no longer see is dropped as `not_purchasable`.
  - **Cart → quote request** sends each line's `packagingUnitId`; a line whose unit has since been deleted is sent as plain pieces.

- 897a759: Baskets can hold one product on several lines when an order is created for a customer.

  - **`addItems` `keepRepeatedLines`** (with `replaceExisting` only): every line of the batch is written as a line of its own — a repeated product, variant and packaging unit is not merged into the first — priced at its own quantity, and created in batch order a millisecond apart. Minimums are still judged on a product's total across the batch. The admin order creation uses it to place one product on lines of several groups (feature 159).
  - **Deterministic basket order.** `replaceItemsForCustomer` creates its lines a millisecond apart in seed order, and the placement read of the basket (`readActiveForPlacement`) now orders the lines by creation time like every other basket read — it carried no order before, so an order placed from a seeded basket could list its lines in any order.

- 14bcf1d: Every consumer prices on price books (feature 160, D-287 P1), through the one batched resolution chain.

  - **carts** — `cart_items.price_source` (migration `…_carts_cart_items_price_source`) records which tier priced a line (`agreed | base | catalogue | buyer | sale`). `CartLinePricing.orderablePrices` drops the product's own price step, passes the variant, and stores the source.
  - **orders** — `order_items.price_source` (migration `…_orders_order_items_price_source`) is copied from the cart line at placement. The admin order preview and the external order intake price through `resolveLinePrices` instead of one `resolveLinePrice` per line; a line no price book prices is refused, with no `defaultPrice` fallback.
  - **organizations** — the effective price lists of an organization are its effective **price books**: `PriceListReadPort.listForOrganization({ organizationChain, customerGroupId })` answers the books whose audience holds the organization, an ancestor or its group, each with `reason` and `depth`. Old: `listActive()` plus `evaluateApplicationRule` per list. New: one `listForOrganization` call.
  - **product_feeds** — a feed pinned to a price book publishes that book's rows over the channel's catalogue price (`namedListPrices` takes the feed's `salesChannelId`); a product the book does not price is absent.
  - **search** — hits and suggestions price through the batched listing resolution; suggestions pass the request currency.
  - **quote_requests** — reference prices are resolved in the request's currency; the RFQ create prefill and the reference probe call `POST /api/v1/admin/price-books/resolve` instead of `GET /api/v1/admin/products/:id/resolved-price`.

- 61a1188: A reorder reports the lines that no longer have a price (issue #166).

  - **Behaviour change — reorder.** `POST /api/v1/orders/:id/reorder` and the admin reorder seed every line at the price the buyer may order it at now, and leave out a line nothing prices for this buyer (or that is sold on request only), reporting it in `unavailableItems` with `reason: 'no_price'` beside the discontinued products. Such a line used to be seeded at the old order's price without being reported, and placement then refused the basket.
  - **`CartSeedOptions.dropUnorderable`** (contracts): `CartWritePort.replaceItemsForCustomer` leaves out the seed lines that have no orderable price and names them in the answer's new optional `unorderable` (`CartSeedUnorderableLine[]`: `productId`, `variantId`, `reason: 'unpriced' | 'quote_only'`). Ignored for an agreed seed. Absent, behaviour is unchanged.
  - **`CartService.repriceLinesForCustomer`** (carts) now answers the lines it could not price, by cart item id, with the reason; it still prices them all in one batched call.

- 9fbb437: Cart pricing is batched, on the customer's own group, and in the basket's currency (D-287 P0).

  - **Batched.** `CartLinePricing` takes `LinePricesPort` and gains `orderablePrices(ctx, lines)`; a basket's lines are priced in one `resolveLinePrices` call on the login/reorder reprice, the batch add and the placement price-drift check (each was one `resolveLinePrice` per line). `CartPricingRecompute` (the `GET /api/v1/cart` re-pricing) takes `LinePricesPort` and resolves every line in one call. `CartService`'s `pricingService` is now `LinePricesPort`.
  - **Customer group.** `CartLinePricing.contextFor` and `CartPricingRecomputeContext` accept `customerAccountId`; adds, quantity changes, the read re-pricing and the placement check price on the customer's own group.
  - **Behaviour change — currency of the own-price fallback.** A line priced from the product's own `defaultPrice` attribute is labelled with the basket channel's default currency, as the catalogue listing labels it; it was hard-coded `PLN` (issue #303's cart half). A basket whose channel no longer exists is now unpriced for such a product instead of being priced in `PLN`.
  - **Behaviour change — `GET /api/v1/cart` shows the price placement charges (issue #168).** The read re-prices every line through `CartLinePricing.orderablePrices`, the chain order placement's price-drift check runs, instead of a plain list price per line: a line seeded from an accepted quote shows its agreed price at the agreed quantity (it showed the list price), a product priced only by its own price attribute shows that price (it showed its stored snapshot), and a line placement would refuse — sold on request only, no price for this buyer, product gone — reads `unavailable: true` with `unavailableReason` `not_purchasable` / `no_price_in_customer_list` at its stored price (it read as orderable). Still one batched pricing call per read. `CartPricingRecompute`'s constructor now takes `(emFactory, linePricing: CartLinePricing, cache, catalogProducts)`; `RecomputeLineRequest` gains `agreed`, `RecomputedLinePrice` gains `refusal`, and cached entries carry it.

- 9b02fe7: A cart line carries its unit price at four decimal places, unrounded (owner ruling of 2026-10-25). The resolver's amount, an agreed quote price and a recomputed price are stored as `numeric(14,4)` (`cart_items.unit_price`, `recomputed_unit_price`, `agreed_unit_price`, widened by `Migration20261025T031727CartsUnitPriceFourPlaces`) instead of being rounded to two places half-up at intake; only the line value, `unit price × quantity`, is rounded to two. A screw priced 0.0125 was charged 0.01, so 10 000 pieces cost 100.00 instead of 125.00. Placement compares the stored price with the current one at four places, so a line priced at two places before the upgrade whose price has sub-cent places is repriced before it is ordered. The cart's string unit prices (`CartReadPort`, the placement drift's `storedUnitPrice`) are four-place decimal strings.

### Patch Changes

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

- 6865b14: Pricing strings (feature 160): the product editor's _Pricing_ tab label is translated (`productEditor.tab.pricing`, _Ceny_ in Polish); `price_lists`' Polish hint names the attribute flag _Reguły cennika_, as the catalogue's attribute screen does; a comment on the cart read's pricing chain no longer describes a product price of its own.
- 87ac085: A price is rounded to two places the same way everywhere: half-up on its decimal digits.

  - **`@endora-commerce/contracts`.** New `roundAmountHalfUp(value: string | number): string` — an amount at two places, half-up on its decimal digits (half away from zero when negative). A number is read as the shortest decimal that round-trips it.
  - **`@endora-commerce/mod-carts`.** The basket line stores the resolver's four-place amount through `roundAmountHalfUp`, and the placement drift check (`storedPriceDiffers`) compares with it. `Number(amount).toFixed(2)` rounded the binary double, so a 9.0450 price was stored and charged as 9.04 while the card showed 9.05, and 1.0050 as 1.00 against 1.01.
  - **`@endora-commerce/mod-orders`.** The admin order preview rounds its line prices the same way.
  - **`@endora-commerce/mod-quote-requests`.** A quote line's stored reference price is rounded the same way.
  - **`@endora-commerce/mod-product-feeds`.** Feed prices (`123.45 PLN`) are rounded the same way.

- fd4b8db: Cart amounts are computed in exact decimal arithmetic (issue #417): a line's `lineTotal`, the `subtotal` and the `grandTotal` of the cart view and the mini cart, the admin and organization cart totals, and the coupon minimum-spend check and its `shortfall`. On doubles, 3 × 9.05 was published as `27.150000000000002`, and a subtotal a binary residue below a coupon's minimum dropped the coupon. Each amount is still a number, now always the two-place decimal itself. New `services/cart-money.ts` (`cartLineAmount`, `cartSubtotal`, `cartTotalAfterDiscount`, `cartShortfall`).
- 24c2005: `cartTotalsByCart` groups the lines by cart in linear time (issue #417, review of PR #423).
- 849ed50: The admin and organization cart lists compute each cart's line count and total with one helper, `cartTotalsByCart`, which groups the lines by cart and sums each cart once, exactly (issue #417, review of PR #423). It replaces a running total folded through a synthetic line, copied in both services.
- e6f3a78: Unit prices are shown by the one rule of the owner ruling of 2026-10-25: two places when the third and fourth are zero, otherwise the significant places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`); line values and totals keep two.

  - `@endora-commerce/mod-invoices`: the invoice PDF's unit net price column (new `unitMoney` beside `money` in the PDF sections), the admin invoice screen and the template preview.
  - `@endora-commerce/mod-carts`, `@endora-commerce/mod-customers`: the admin cart and the customer's cart history.
  - `@endora-commerce/mod-comparisons`: a compared product's price on the screen, the canvas and the PDF (`1.50 PLN`, `0.0125 PLN`), where it was rounded to two places.
  - `@endora-commerce/mod-crm`: an Opportunity's value of a linked Quote Request adds the quote's line values, each rounded to the cent once, as the quote desk does; it rounded only the sum.
  - `@endora-commerce/cms-components`: the CMS product card's price; the package now depends on `@endora-commerce/contracts` for the rule.

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
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
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

## 0.107.0

### Minor Changes

- 70bb5e5: Converting a cart into a quote request no longer records the cart's unit prices as the customer's proposed prices. Each cart line's unit price is passed to `RfqCustomerPort.createForCustomer` as that line's reference price instead (`options.lineReferencePrices`), so the resulting quote lines carry no proposal and conversion keeps working for a customer who may not propose prices.
- 34f97ae: The basket belongs to the sales channel it is used on (`specs/154-sales-channel-access/`, User
  Story 6). It used to be created on the system-default channel and priced there whatever
  storefront it was used on.

  - A customer holds one active basket per channel; every storefront cart route addresses the
    basket of the request's channel, and a line of another channel's basket answers 404.
  - An anonymous cookie token whose basket is another channel's names no basket on this one: reads
    answer the empty cart, and the first write replaces the `b2b_cart_anon` cookie with a new token.
  - Line prices, the "sold on request only" decision, the read-time recompute and the placement
    price check resolve on the basket's own channel; the system-default fallback is gone.
  - Merge at sign-in merges the anonymous basket of the sign-in channel into the customer's basket
    of that channel; an anonymous basket of another channel is left alone (`noop_no_anon`).
  - `cartPlacementApplyPort.readActiveForPlacement` reads the basket of `ctx.salesChannelId`.
  - New migration `Migration20261019T043854CartsChannelBackfill` records baskets with no channel on
    the system-default channel.
  - Composition-facing API: `CartService.getOrCreateForAnon(em, token, salesChannelId)` returns
    `Cart | null`; `CartService` methods take a `CartActor` whose customer context carries
    `salesChannelId`; `CartLinePricing.contextFor` takes `salesChannelId`;
    `CartShoppingListBridge.appendShoppingListToCart` receives `salesChannelId`.

- 31175b7: `CartsDeps.cartCouponService`, `cartConversionService`, `pushLineToShoppingList` and `appendShoppingListToCart` are required. A composition that left one out made the matching cart route answer `503` with the `NOT_FOUND` code and an untranslated token as its message (`promotions_unavailable`, `quote_requests_unavailable`, `shopping_lists_unavailable`). Those branches are gone. The module's own `registerModule` already wires all four, so a deployment using it sees no change: a cross-module owner that is off still answers `503 MODULE_DISABLED` naming the module, with the translated sentence. Code calling `registerCartRoutes` directly must now pass all four.

### Patch Changes

- 649fe8d: Documentation for sales-channel access (`specs/154-sales-channel-access/`), shipped in each
  package's `docs/` directory, English and Polish.

  - `@endora-commerce/mod-sales-channels`: the access rule (anonymous visitors only on channels open
    to them, customers only on channels assigned to their Organization), the _Open to anonymous
    visitors_ option, `GET /api/v1/storefront/sales-channel/access`, and a corrected multi-storefront
    section. The developer guide tells module authors to declare
    `config: { salesChannelAccess: 'open' }` on every provider callback their module receives
    (payment gateway notifications, carrier webhooks, provider return URLs) — such requests arrive
    without a session and are refused on a store closed to anonymous visitors otherwise — and
    describes `SalesChannelAccessPort`.
  - `@endora-commerce/mod-organizations`: the _Sales channels_ panel, the _New organization_ screen,
    which channel a new Organization gets, and that invitations change no channel.
  - `@endora-commerce/mod-carts`: one basket per store, and the `ORDER_SALES_CHANNEL_MISMATCH`
    refusal at order placement.

- 3d5a203: A product sold on request only is refused by the cart whether or not a price list holds it. `CartService.addItem` read the display mode off the resolved list price, so a product no price list prices — priced from the catalogue attribute — resolved nothing, the `CART_PRODUCT_QUOTE_ONLY` guard was skipped, and `POST /api/v1/cart/items` added the line with `200`. It now answers `400 CART_PRODUCT_QUOTE_ONLY` for it too.

  `@endora-commerce/contracts` publishes `ProductDisplayModePort` — `resolveDisplayMode({ productId, organizationId, salesChannelId, customerKind })` — and `@endora-commerce/mod-price-lists` provides it as `productDisplayModePort`, over the same Product → Category → Organization → Settings chain its storefront display-mode route answers with. `CartService` takes it as a new required constructor argument, after `channelMembership`; the module's own composition wires it.

- edac0be: `POST /api/v1/admin/orders` now honours the sales channel the operator chose for the order.

  - A `salesChannelId` that names no sales channel is refused with `404 NOT_FOUND` before anything is written; the customer's basket is left as it was. It used to be accepted and the order was placed on the system-default channel.
  - The ordered products are checked against the assortment of the order's channel rather than the channel the admin request itself resolved (the system default, unless a channel header is sent). A product the chosen channel sells is now accepted even when the default channel does not sell it, and a product the chosen channel does not sell is refused with `404 PRODUCT_NOT_FOUND` even when the default channel sells it.

  `CartWritePort.addItem` accepts an optional `salesChannelId` in its input: the channel whose assortment decides whether the product may be added. Without it the request's resolved channel decides, as before. Buyer-facing cart, shopping-list and quick-order paths do not pass it and behave exactly as before.

- 7d2d00f: A cart line's stored unit price is now always the price for its current quantity.

  - Adding more of a product already in the cart, changing a line's quantity, merging an
    anonymous cart at login and seeding a basket from a past order
    (`CartWritePort.replaceItemsForCustomer` without `sourceQuoteRequestId`) store the price for the
    resulting quantity, so a quantity-tier bracket applies to the quantity actually ordered and a
    reorder is priced at today's prices.
  - A product that no price list and no price of its own (`defaultPrice` attribute) applies to is
    refused with `422 CART_PRODUCT_UNPRICED` instead of being added at `0.00`.
  - A line seeded from an accepted quote request (`CartWritePort.replaceItemsForCustomer` with
    `sourceQuoteRequestId`) records the quantity its price was agreed for in three new nullable
    `cart_items` columns (`agreed_quantity`, `agreed_unit_price`, `agreed_currency`; one migration).
    It keeps the agreed price only at that quantity and is priced from the list at any other.
  - `CartPlacementApplyPort` (`./ports`) gains `findPriceDrift(em, { cartId, organizationId })` and
    `refreshLinePrices({ cartId, organizationId })`, which order placement uses to refuse and then
    bring up to date a cart whose stored prices are no longer current. An implementation of the port
    outside this package has to add both.
  - Two new error sentences in the `carts` bundles: `errors.CART_PRODUCT_UNPRICED` and
    `errors.CART_PRICE_CHANGED`.

  A cart converted from an accepted quote before this release carries no agreed quantity; its lines
  are priced from the list at placement, and converting the quote again restores the agreed prices.

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
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

## 0.105.0

### Minor Changes

- 3383720: Two refusals of a cart line have an error code of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish. **A client that matches on `VALIDATION_FAILED` for these two cases
  now sees the specific code**; the HTTP status of each is unchanged.

  - `CART_PRODUCT_QUOTE_ONLY` (`400`) — the product's price is withheld from this buyer (the resolved
    price display mode is `none`), so it is quoted rather than added to a cart. It was
    `400 VALIDATION_FAILED` with the identifier `product_quote_only` as its message, which is what
    the buyer read, in every language. `details.productId` names the product. Besides
    `POST /api/v1/cart/items`, every flow that fills a cart line by line can answer it: quick order,
    one-click buy, a shopping list added to the cart, an order created in the admin and an order
    taken in through the API.
  - `CART_QUANTITY_INVALID` (`422`) — the quantity is below the minimum a cart line may hold. It was
    `422 VALIDATION_FAILED` with the English message `Quantity must be > 0.`, held by no bundle.
    `details.minimum` and `details.quantity` carry the values, and both sentences name the minimum.
    No HTTP route reaches it — every request schema in front of the cart already refuses such a
    quantity as a malformed request, which is still `400 VALIDATION_FAILED` — so it is what a module
    calling the cart write port (`CartWritePort.addItem`) in-process is answered.

  `@endora-commerce/contracts` gains the two members of `ERROR_CODES`. The `price_lists` documentation
  page, which names the first refusal, names the new code. No setting or permission changes.

### Patch Changes

- 1807ab0: Four customer routes answer a request without a customer session with `401` before they
  validate its body.

  `PATCH /api/v1/organization/policies/cart-approval`, `POST /api/v1/organization/carts/:id/reject`,
  `POST /api/v1/cart/convert-to-quote-request` and
  `POST /api/v1/cart/items/:itemId/save-to-shopping-list` checked the session inside the handler,
  which runs after schema validation, so an anonymous request with a malformed body was answered
  `400` with the field details. Each now declares `auth`'s `requireCustomer` guard on the route,
  which the platform runs ahead of validation. The `401` message for these four is the guard's,
  `Customer session required.`; the code stays `UNAUTHORIZED`. A signed-in customer gets the same
  `400` as before, and the organisation-administrator and cart-ownership rules are unchanged.

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

## 0.104.0

### Minor Changes

- 85793d6: A basket remembers the accepted quote request it was seeded from.

  - **One new nullable column, `carts.source_quote_request_id`**, arriving with the next
    migration run (`Migration20261008T061751CartsCartSourceQuoteRequest`). No backfill, no
    foreign key, no index; existing baskets hold `null`.
  - `cartWritePort.replaceItemsForCustomer` accepts `{ sourceQuoteRequestId }` as an optional
    third argument and stores it; a call without it clears the mark. Nothing a buyer can reach
    sets it. Adding a line, removing one or changing a quantity keeps it, as it keeps the unit
    prices the seed wrote; **removing the last line clears it**.
  - `CartRecord`, as answered by `cartReadPort`, `cartWritePort` and `cartPlacementApplyPort`,
    carries `sourceQuoteRequestId`.
  - **Fixed:** `replaceItemsForCustomer` did not write the basket's `lastActivityAt` — it set it
    on a row another `EntityManager` managed. A basket seeded by a reorder, an
    administrator-created order or a quote conversion now has its activity time moved, which
    the abandonment sweep reads.

  No route, no response shape and no manifest edge changes.

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
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
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
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.9.7

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
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.9.5

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
  - @endora-commerce/platform@0.13.1

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.9.1

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
  - @endora-commerce/platform@0.11.1

## 0.9.0

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

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

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

## 0.7.0

### Minor Changes

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

- f2ffa45: `carts` refuses a row that names a customer account and no organisation.

  A new migration adds
  `check ("customer_account_id" is null or "organization_id" is not null)` to the
  `carts` table, after deriving the missing organisation from the account that
  owns the cart and refusing — with the count and up to twenty ids, deleting
  nothing — anything left over.

  **Why it matters to anything writing this table.** `Cart` is `@CustomerScoped`
  and carries its own `organization_id`, and the tenant filter's `allowed-set` arm
  reads that column: a sales representative sees the carts of the organisations
  they are assigned to. MikroORM applies no filter to `INSERT`, so until now a
  cart written with an account and a null organisation was simply invisible to
  that representative, with nothing anywhere reporting it. The database is the
  only place that refusal can live.

  **What can break.** An insert or update that sets `customer_account_id` without
  setting `organization_id` now fails with a check violation instead of writing a
  row nobody can attribute. Every write path in this package already stamps it —
  `CartService`'s owned-create branch does, its anonymous branch legitimately
  leaves both columns null, and the anonymous→customer merge completes the
  anonymous cart rather than re-owning it — so no call site changes. A fixture or
  an external writer that built a cart by hand is the case to look at.

  The constraint is an **implication**, not an equivalence: an ownerless cart is a
  representable state and needs no organisation. No foreign key is added.

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

- 184fa9f: Two detail-screen zone members, four contributors, and the end of two live component
  duplications.

  `@endora-commerce/contracts` adds two members to `AdminZoneNameSchema`, each with its entry
  in `AdminZonePropsMap`:

  | Member                      | Props                                            | Rendered by                                         |
  | --------------------------- | ------------------------------------------------ | --------------------------------------------------- |
  | `organization.detail.after` | `OrganizationDetailZoneProps { organizationId }` | the end of the organization detail screen, **once** |
  | `customer.detail.after`     | `CustomerDetailZoneProps { customerId }`         | the end of the customer detail screen, **once**     |

  `OrganizationDetailZoneProps` and `CustomerDetailZoneProps` are new exported interfaces. The
  second is not an alias of the first: the prop is named for the entity the mount carries, and
  the two members are two places.

  **One mount per screen is a rule, not a layout choice.** Neither member carries a prop that
  could tell two mounts apart, so a second mount of either renders every contribution twice
  and nothing in the renderer can distinguish them.

  `@endora-commerce/mod-quick-order` gains an `./admin` subpath — its first — with two zone
  contributions and `DefaultPreferencesPanel`, which moves into the package. The panel's two
  preference calls are rebuilt from the published `apiClient`; `quick-order-client.ts` stays in
  the admin application, where the on-behalf-of screen still uses it.

  ```tsx
  // Both contributions declare `orders:write`, which is the code every admin
  // route this module owns enforces. There is no `quick_order:*` permission.
  zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
    weight: 300,
    requiredPermission: 'orders:write',
  });
  ```

  `@endora-commerce/mod-carts` gains its first zone contribution and a new route,
  `GET /api/v1/admin/organizations/:id/cart-approval-policy`, gated on `customers:manage` and
  answering `cartApprovalPolicyResponseSchema` — the same code and the same shape as the
  `PATCH` that has been there since feature 027. `CartApprovalService` gains `getPolicyByAdmin`.
  The contribution reads its own initial state through that route instead of taking the
  `initialRequiresCartApproval` prop the old panel took, because a zone's props cannot carry a
  value only one of four contributors wants.

  That panel had been imported by nothing, and the copy it rendered was in no bundle under any
  spelling — `t('carts.policy.title')` under the `carts` namespace resolves to
  `bundle['carts']['carts.policy.title']`, which never existed. Ten `policy.*` keys are added to
  this package's own bundle in both shipped languages, and the capability reaches an operator
  for the first time.

  `@endora-commerce/mod-price-lists` and `@endora-commerce/mod-sales-channels` each gain a
  second contribution over a component they already ship, and each loses its duplicate:
  `DisplayModeOverrideRow` and `EntityChannelMembership` existed twice in the tree for the
  length of the previous release, because the organization detail screen still imported the
  `admin/src` copy. Both copies are gone and nothing imports them.

  **Operator-visible copy change.** The organization detail's pricing card is now
  `price_lists`' own: the screen used to pass `organizations.detail.pricingLabel` and
  `organizations.detail.pricingHint` into a control it does not own and wrap it in a card
  titled `organizations.detail.pricingCard`. A host cannot hand copy to a contributor it does
  not know, so the control renders `priceLists.displayMode.rowLabel` and its own hint, and all
  three host keys are removed from the `core` bundle in both languages. Two further `core` keys
  go with them — `priceLists.linked.displayModeLabel` and `priceLists.linked.displayModeHint`,
  which the previous release left unread.

  No contribution declares a `match`, and each says why in its own file: `match` narrows the
  mounts of one place, and each of these members has one host and one mount. Every zone test
  asserts it absent.

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- 98ef35e: `carts` declares the three error codes it owns, and the seven refusal tokens under one of them.

  The module's `manifest.ts` gains an `errorCodes` array
  (`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
  sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
  changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
  chain routes here today, so a consumer sees the identical envelope for `CART_EMPTY`,
  `CART_LINE_CAP_EXCEEDED` and `CART_COUPON_REJECTED`.

  `CART_COUPON_REJECTED` is the first declaration in the migration to carry `tokens` — the seven
  `errors.CART_COUPON_REJECTED.<token>` discriminators the envelope reads from `details.code`.
  They are the members of `couponDropReasonSchema` in `@endora-commerce/contracts`, which is the
  type of the value the raise site produces, rather than the seven keys the bundle happens to hold.

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
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
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
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
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
  - @endora-commerce/platform@0.7.0
