---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-i18n': patch
---

**A quote an operator creates for a customer stays unshared until it is shared** (`specs/192-quote-request-draft-share/`). `POST /api/v1/admin/quote-requests` now creates a `Created from admin` quote the customer cannot see: it is left out of every customer list and every customer read and action answers `404`, as for a quote that does not exist. No customer notification is recorded, and the quote never expires. Lines may be saved without a price. The operator shares it with `POST /api/v1/admin/quote-requests/:id/share`, the audited Command `quote_request.share`, which makes it visible, writes its validity date and sends the existing *quote prepared* notification (`quote_request_customer_prepared`), which no longer goes out on create. A share is refused with `409` when a line has no price (`QUOTE_INCOMPLETE`, `details.code: 'share'`), when the customer account is `not_member`, `inactive` or `blocked` (`RFQ_SHARE_CUSTOMER_UNAVAILABLE`) and when the quote is already shared (`RFQ_ALREADY_SHARED`). While a quote is unshared, `POST …/:id/pdf/send` answers `409 RFQ_NOT_SHARED`. Quotes that exist when the migration runs are marked shared, so customers keep seeing them. Customer-submitted requests, *Clone to quote* and the quick-order build are unchanged.

**Validity counts from the share.** The new setting `quote_requests.default_validity_days` (0–3650, default `0` = no deadline, read globally) prefills a new operator quote's days, and `GET /api/v1/admin/quote-requests/create-defaults` answers it. `0` and `null` now mean no deadline on every write; an absent `expiresInDays` keeps the current value on a patch and takes the default on a create. **Behaviour change:** a revision with `expiresInDays: 0` used to make the quote expire at once; it now removes the validity date. To close an offer, cancel it. `expiresInDays` above `3650` is now refused with `400 VALIDATION_FAILED`.

**Other changes:**

- The customer's quote list is ordered by the share moment, falling back to the creation moment.
- The customer's history of a shared quote starts at the share.
- The admin list takes `sharing=unshared|shared`.

`@endora-commerce/contracts`:

- **Validity:** `QUOTE_VALIDITY_DAYS_MAX` (3650) and `quoteValidityDaysSchema`, which now types `expiresInDays` on the admin create and patch bodies.
- **Hookable action:** `QUOTE_REQUEST_HOOKABLE_ACTIONS.share` (`quote_request.share`, `beforeCommit` only) and its data type `QuoteRequestShareHookData` (`quoteRequestId`, `organizationId`, `customerAccountId`, `salesChannelId`, `currentRevisionNumber`, `expiresAt`). A hook may refuse a share. It runs while the quote is locked: budget one second, and the refusal text must be safe to show an administrator.
- **Schemas:** `adminShareQuoteRequestSchema`, and `adminQuoteRequestCreateDefaultsSchema` with the type `AdminQuoteRequestCreateDefaults`.
- **Error codes:** `ERROR_CODES.RFQ_ALREADY_SHARED`, `RFQ_SHARE_CUSTOMER_UNAVAILABLE` and `RFQ_NOT_SHARED`.
- **Admin replies:** `sharedWithCustomer`, `sharedAt`, `sharedByAdminUserId` and `shareValidityDays`. Customer replies never carry them.
- **Admin list:** the query field `sharing` and the row field `sharedWithCustomer`.
- **History:** the event type `'shared'` and the change kind `validity_days`.
- **Create lines:** `agreedUnitPrice` may now be absent or `null` on `adminCreateQuoteRequestLineSchema`.
- **Required field:** `QuoteRequestRecord.sharedWithCustomer` is a new **required** field. An implementation of `quoteRequestReadPort` outside this repository must supply it.

`@endora-commerce/mod-carts`: `POST /api/v1/cart/from-quote-request/:id` answers `404` for a quote that is not shared with its customer, before reading its lines.

`@endora-commerce/mod-i18n`: the Admin UI strings for the share history entry, the *Validity after sharing* change and the create screen (*Save without sharing*, *Open quote*) are added; the history entry `rfq.detail.history.entry.created` now reads *Request created*. `rfqCreate.field.expiresInDays` and `rfq.detail.validity.help.previewImmediate` are removed; a deployment that overrides either drops it.
