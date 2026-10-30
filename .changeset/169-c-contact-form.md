---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/contracts': minor
---

A **Contact form** Page Builder block (`cms.ContactForm`) that e-mails a visitor's message to the shop and stores nothing.

- **Block:** a fixed field set the server knows — name (shown by default), e-mail and message (always), phone, company, subject and a select with editor-defined options (on request), a required privacy consent and an optional marketing consent, both with inline rich labels. Per field: show, label, placeholder, required, and its width with two columns. Layout and look are presets: one or two columns, field look `boxed` / `underline` / `pill` from the colour scheme, label above or visually hidden, the submit button through the existing button look (no link) with its alignment, and editable "sent", "not accepted" and "unavailable" messages. Posts to the storefront's `/forms/contact` and works without JavaScript; with JavaScript it checks itself and shows the outcome inline. Unset words read the page language's defaults through the new optional `contactFormText` render-context entry.
- **`ButtonView`:** an additive `type="submit"` rendering (a `<button type="submit">` with the same classes) and `disabled`; every existing rendering is unchanged.
- **Endpoint:** `POST /api/v1/storefront/cms/contact-form` (public, rate limited to 10 submissions per client address in 10 minutes, honeypot field `website`) sends one e-mail per recipient through the platform mailer, Reply-To the visitor, written in the channel's default language, with a fixed subject and no `meta`, so nothing typed reaches the delivery record. Answers `400 VALIDATION_FAILED`, `409 CMS_CONTACT_FORM_UNAVAILABLE` (new error code: no recipients on the channel), `429`, `500`, and `503` with `cms` off.
- **Setting:** `cms.contact_form_recipients` (`string_list`, per sales channel, group "Contact form", at most 10 valid addresses, refused otherwise), with the palette action `open-contact-form-settings`. `cms` now depends on `email` and `_i18n` (both non-deactivatable).
- **Contracts:** `contactFormSubmissionSchema`, `contactFormSubmissionResponseSchema`, `contactFormEmailSchema`, `CONTACT_FORM_LIMITS`, `CONTACT_FORM_MAX_RECIPIENTS` and `ERROR_CODES.CMS_CONTACT_FORM_UNAVAILABLE`.
