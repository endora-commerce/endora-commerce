# @endora-commerce/mod-forms

## 0.111.0

### Minor Changes

- 13148d3: Issue #470 (D-288) — a form entry export's audit entry no longer carries the search text. `forms.entries.export` is recorded against the global form, but it writes about `@CustomerScoped` entries, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §2, §5).

  - `forms.entries.export` no longer records `filter.q`. With a search text, `filter` records `hasQuery: true` and `queryLength` instead; without one, neither. The statuses, submission dates, sales channel id, form id and row count are unchanged.
  - `FORMS_AUDIT_KEYS` and `FORMS_EXPORT_FILTER_AUDIT_KEYS`, constants in `src/backend/services/entry-audit-state.ts` (not on a published barrel), list every key the entry Commands' audit state may hold, held by a sentinel test.
  - No screen reads values back from the audit log, so no value store is added. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** See _A form entry export's search text leaves the platform audit log_ in the upgrade guide.

### Patch Changes

- f5db373: **A public form is read and submitted in the channel language `Accept-Language` asks for, read as a q-weighted list** (issue #1011). `GET /api/v1/storefront/forms/:formId` and `POST /api/v1/storefront/forms/:formId/entries` tried the header's tags in the order written, ignoring their `q` weights, and matched each only exactly, so `Accept-Language: en-US;q=0.2, pl-PL;q=0.9` was English and `pl` fell back to the channel default on a `pl-PL` channel. Without an offered `?language=`, the language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. That language picks the form's texts, the confirmation page and the language an entry is stored with. An offered `?language=` still wins, an unoffered one is still passed over, and a request with neither behaves as before.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- 4933779: The module's documentation page says that a form entry export's audit entry records whether a search text was used and its length, not the text. English and Polish.
- Updated dependencies [baa0dae]
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
- Updated dependencies [097b599]
- Updated dependencies [761d9c4]
- Updated dependencies [8e7f794]
- Updated dependencies [8e7f794]
- Updated dependencies [f39d37f]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [695636f]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [3f95d1c]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [f5caa4e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [8a4ca9c]
- Updated dependencies [c7ec2fa]
- Updated dependencies [52831b7]
- Updated dependencies [a2d306f]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
- Updated dependencies [2e603f7]
- Updated dependencies [73e8e8c]
- Updated dependencies [bf257b8]
- Updated dependencies [d591709]
- Updated dependencies [577e94c]
- Updated dependencies [e435bad]
- Updated dependencies [7bdf512]
- Updated dependencies [5c148de]
- Updated dependencies [e435bad]
- Updated dependencies [5c148de]
- Updated dependencies [036865c]
- Updated dependencies [0beb869]
- Updated dependencies [37532da]
- Updated dependencies [bfdbeaf]
- Updated dependencies [65f7abc]
- Updated dependencies [a998fee]
- Updated dependencies [54ae028]
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
  - @endora-commerce/admin-kit@0.111.0
  - @endora-commerce/contracts@0.111.0
  - @endora-commerce/platform@0.111.0
  - @endora-commerce/cms-components@0.111.0
  - @endora-commerce/email-components@0.111.0

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
