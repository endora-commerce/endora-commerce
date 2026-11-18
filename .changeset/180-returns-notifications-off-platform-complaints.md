---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-returns': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/admin-kit': minor
---

**Returns: notifications, and complaints about goods bought elsewhere, with attachments and clauses.**

**Breaking for API callers: `attachmentAssetIds` and the JSON `{ assetId }` attachment body are removed.** They linked any asset id without checking that it existed, belonged to the caller or was a file a case may hold, and nothing displayed the link. Files are now uploaded and stored by `returns` itself.

- Old: `POST /api/v1/returns` with `{ …, attachmentAssetIds: [assetId] }`, and `POST /api/v1/returns/:id/attachments` with the JSON body `{ assetId }` (`addReturnAttachmentRequestSchema`).
- New: upload each file first with `POST /api/v1/returns/uploads` (multipart: `file`, `type` = `photo` | `proof_of_purchase` | `other`), which answers `{ uploadId, … }`. Then file the case with `{ …, attachments: [{ uploadId }] }`. To add a file to a case already filed, post it as multipart (`file`, `type`) to `POST /api/v1/returns/:id/attachments`. Download with `GET /api/v1/returns/:id/attachments/:attachmentId/file` (customer) or `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` (admin).
- `returnAttachmentSchema` no longer carries `assetId`. It now carries `type`, `filename`, `mimeType` and `sizeBytes`. `addReturnAttachmentRequestSchema` is gone; `returnUploadSchema`, `returnAttachmentUploadFieldsSchema` and `RETURN_ATTACHMENT_LIMITS` are new. Limits: JPEG, PNG, WebP or PDF, judged by content; 10 MB per file, 30 MB per submission, 10 files per case. A refused file answers `422 RETURN_ATTACHMENT_REJECTED`.
- **Upgrade note:** attachment rows written by the old API keep their `asset_id`. The migration fills in their `organization_id` from their case and types them `other`. They stay in the database but are not listed on the case and cannot be downloaded, because no stored file stands behind them.

**`@endora-commerce/mod-returns`**

- **Notifications.** Four transactional e-mails, editable and switchable under *Transactional emails* (group `returns`), in English and Polish:
  - `return_new_case`, to the new setting `returns.new_case_recipients` (`string_list`, up to 10 addresses, per sales channel).
  - `return_submitted`, to the filer.
  - `return_comment_added`, for a customer-visible comment posted with `notifyCustomer: true`.
  - `return_status_entered`, for a status marked `notifyCustomerOnEntry`.
  - Administrators holding `returns:read` also get a bell entry per new case, while `admin_notifications` is present.
  - Delivery runs on the `returns-notifications` BullMQ queue, after commit.
  - `GET /api/v1/admin/returns/notification-health` reports channels whose new-case e-mail goes to nobody.
- **Who authorized a case.** `return_cases.authorized_by_admin_user_id` is recorded on entering *Authorized*. Existing cases are back-filled from the audit log. The admin list, the detail and the CSV export (`reference`, `authorizedBy`) show it. Every case has a `reference`: the RMA number, else `#` and the first eight characters of the id.
- **Complaints without a platform order.** Switched on per channel with `returns.off_platform_complaints_enabled` (default off); `returns.proof_of_purchase_required` makes a proof-of-purchase file mandatory.
  - `POST /api/v1/returns` accepts `createOffPlatformComplaintRequestSchema`: lines naming a catalogue product or a model name, a purchase date, a contact and a return address. `createReturnCaseRequestSchema` is now the union of the order and the no-order shapes.
  - Both shapes take an optional `submissionKey`, which makes a repeated submission answer the case already filed (`200` instead of `201`).
  - Such a case has `orderId: null` and `offPlatform: true`, and is settled by `replacement`, `repair` or the new `settled_outside` (with a mandatory `resolutionNote`). Refund, credit and a corrective invoice answer `422 RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.
  - New refusals: `403 RETURN_OFF_PLATFORM_DISABLED` and `422 RETURN_PROOF_OF_PURCHASE_REQUIRED`.
  - Admin list filter `origin` (`platform` | `off_platform`).
  - Summaries carry `offPlatform`, `productLabel`, `lineCount` and `purchaseDate`.
- **Clauses.** `GET|POST /api/v1/admin/returns/clauses` and `PATCH|DELETE …/clauses/:id`, plus the *Return and complaint terms* screen and palette action.
  - A clause is `must_accept` or `inform_only`, per language, for returns, complaints or both, on one channel or all.
  - `GET /api/v1/returns/form-config` serves the clauses with the toggles and limits.
  - A filed case stores the clauses shown with it (`acceptedClauses`, `clausesAcceptedAt`). A missing or outdated acceptance answers `422 RETURN_CLAUSES_NOT_ACCEPTED`.
- **Erasing personal data.** On `customer_account.anonymized.v1` the account's cases lose their contact, return address and files (`personalDataErasedAt`). The daily `returns-maintenance` pass catches up on an anonymisation missed while the module was off, and deletes uploads never filed after 24 hours.
- **Event** `return_case.created.v1` (`ReturnCaseCreatedEventV1Schema`) is emitted after a case is filed. `ReturnStatusEvent.orderId` may now be `null`.
- **Dependencies.** New binding dependencies: `_i18n`, `admin_users`, `assets_library` and `catalog`. `admin_notifications` is a `degrades-without` edge. The package now has a peer dependency on `@fastify/multipart` `^10`.
- **Migrations.**
  - `20261113T145001_returns_authorizer_status_notifications` adds the authorizer and the per-status e-mail flag.
  - `20261113T155433_returns_off_platform_complaints` makes `return_cases.order_id` nullable, adds the purchase, contact, address, clause, note, submission-key and erasure columns, reshapes `return_case_attachments`, and creates `return_case_clauses`. Rolling it back is refused while a case without a platform order exists.

**`@endora-commerce/mod-transactional-emails`** publishes `transactionalEmailStatePort` (`TransactionalEmailStatePort.isActive(code)` in contracts). It reports whether a transactional e-mail is switched on, and `false` for an unknown code.

**`@endora-commerce/admin-kit`** resolves the palette icon `FileCheck`, which `KnownIconNameSchema` now accepts.
