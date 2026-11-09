# @endora-commerce/mod-forms

## 0.110.0

### Minor Changes

- 2da23d2: New module `forms` (`@endora-commerce/mod-forms`): a form builder whose forms are placed on CMS pages as the `forms.Form` Page Builder block, with stored entries, e-mail notifications, spam protection, retention and an outbound webhook event.

  - **Tables** `forms`, `form_versions`, `form_entries`, `form_entry_notes` (migration `20261102T111501_forms_init`). A form is a working copy plus immutable published versions; every entry keeps the version it was submitted against. Entries are tenant-scoped (organisation of the signed-in submitter, or none for an anonymous one) and channel-scoped.
  - **Admin API** under `/api/v1/admin/forms` (forms, versions, preview, publish, close, reopen, duplicate, delete, notifications, retention and `retention-impact`) and `/api/v1/admin/forms/entries` (list, read, mark read, status with undo, notes, delete one or many, CSV `export`). Permissions `forms:read`, `forms:write`, `forms:entries_read`, `forms:entries_write`, `forms:entries_export`; every write runs through the Command Bus and is audited without the submitted answers.
  - **Public API** `GET /api/v1/storefront/forms/:formId` (the published definition, cache tag `forms:form:<id>`) and `POST /api/v1/storefront/forms/:formId/entries` (server-side validation with the shared evaluator, honeypot, 10 submissions per client address in 10 minutes, 256 KB body limit, optional CAPTCHA, availability window, entry limit, signed-in-only forms).
  - **Queues** `forms-notifications` (shop message per recipient and an optional confirmation e-mail, retried with backoff; a job carries an entry id and a language only) and `forms-maintenance` (every 15 minutes: retention deletion, erasure of entries of anonymised customer accounts, counter repair).
  - **Settings** `forms.enabled`, `forms.captcha_provider` (`none`, Cloudflare Turnstile or hCaptcha), `forms.captcha_site_key`, `forms.captcha_secret_key`. Palette actions `open-forms`, `new-form`, `open-form-entries`.
  - **Event** `forms.entry.submitted.v1`, offered to outbound webhooks; it carries only the answers of fields marked _Share with integrations_.
  - **Error codes** `FORM_NOT_FOUND`, `FORM_KEY_TAKEN`, `FORM_DEFINITION_INVALID`, `FORM_REVISION_CONFLICT`, `FORM_HAS_ENTRIES`, `FORM_NOT_ACCEPTING`, `FORM_SUBMISSION_TOO_LARGE`, `FORM_SUBMISSION_INVALID`, `FORM_ENTRY_NOT_FOUND`, `FORM_ENTRY_STATUS_CONFLICT`, `FORM_SCOPE_REQUIRED`, `FORM_CAPTCHA_FAILED`, `FORM_CAPTCHA_UNAVAILABLE`.
  - Operator-toggleable: with `forms` off its routes, workers, subscribers, block, admin screens and webhook event type are absent; nothing is deleted, and erasure owed while it was off runs on the first maintenance tick after it is back.

### Patch Changes

- dbc1cef: `GET /api/v1/storefront/forms/:formId` answers a malformed id (one that is not a UUID) with `200 { formId, availability: 'unavailable' }`, the body an unknown id gets, instead of `400 VALIDATION_FAILED` (owner ruling of 2026-11-05, issue #781), so the read no longer tells a malformed id from a form that does not exist. `formId` echoes the requested value. To match, the `unavailable` arm of `publicFormDefinitionSchema` in `@endora-commerce/contracts` types `formId` as a non-empty string rather than a UUID; the available arm still requires a UUID. `POST /api/v1/storefront/forms/:formId/entries` still answers a malformed id `400`.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
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
- Updated dependencies [cc1496f]
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
  - @endora-commerce/cms-components@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0
