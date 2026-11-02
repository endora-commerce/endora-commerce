---
'@endora-commerce/mod-forms': minor
---

New module `forms` (`@endora-commerce/mod-forms`): a form builder whose forms are placed on CMS pages as the `forms.Form` Page Builder block, with stored entries, e-mail notifications, spam protection, retention and an outbound webhook event.

- **Tables** `forms`, `form_versions`, `form_entries`, `form_entry_notes` (migration `20261102T111501_forms_init`). A form is a working copy plus immutable published versions; every entry keeps the version it was submitted against. Entries are tenant-scoped (organisation of the signed-in submitter, or none for an anonymous one) and channel-scoped.
- **Admin API** under `/api/v1/admin/forms` (forms, versions, preview, publish, close, reopen, duplicate, delete, notifications, retention and `retention-impact`) and `/api/v1/admin/forms/entries` (list, read, mark read, status with undo, notes, delete one or many, CSV `export`). Permissions `forms:read`, `forms:write`, `forms:entries_read`, `forms:entries_write`, `forms:entries_export`; every write runs through the Command Bus and is audited without the submitted answers.
- **Public API** `GET /api/v1/storefront/forms/:formId` (the published definition, cache tag `forms:form:<id>`) and `POST /api/v1/storefront/forms/:formId/entries` (server-side validation with the shared evaluator, honeypot, 10 submissions per client address in 10 minutes, 256 KB body limit, optional CAPTCHA, availability window, entry limit, signed-in-only forms).
- **Queues** `forms-notifications` (shop message per recipient and an optional confirmation e-mail, retried with backoff; a job carries an entry id and a language only) and `forms-maintenance` (every 15 minutes: retention deletion, erasure of entries of anonymised customer accounts, counter repair).
- **Settings** `forms.enabled`, `forms.captcha_provider` (`none`, Cloudflare Turnstile or hCaptcha), `forms.captcha_site_key`, `forms.captcha_secret_key`. Palette actions `open-forms`, `new-form`, `open-form-entries`.
- **Event** `forms.entry.submitted.v1`, offered to outbound webhooks; it carries only the answers of fields marked *Share with integrations*.
- **Error codes** `FORM_NOT_FOUND`, `FORM_KEY_TAKEN`, `FORM_DEFINITION_INVALID`, `FORM_REVISION_CONFLICT`, `FORM_HAS_ENTRIES`, `FORM_NOT_ACCEPTING`, `FORM_SUBMISSION_TOO_LARGE`, `FORM_SUBMISSION_INVALID`, `FORM_ENTRY_NOT_FOUND`, `FORM_ENTRY_STATUS_CONFLICT`, `FORM_SCOPE_REQUIRED`, `FORM_CAPTCHA_FAILED`, `FORM_CAPTCHA_UNAVAILABLE`.
- Operator-toggleable: with `forms` off its routes, workers, subscribers, block, admin screens and webhook event type are absent; nothing is deleted, and erasure owed while it was off runs on the first maintenance tick after it is back.
