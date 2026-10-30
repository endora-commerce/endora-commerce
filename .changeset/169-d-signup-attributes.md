---
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-newsletter': minor
---

`newsletter.Signup` picks its topics from the newsletter's tags and can collect subscriber attributes.

- **Topics:** in the admin, a topic's tag is chosen by name from the newsletter's tags (`GET /api/v1/admin/newsletter/tags`); the block still stores the tag code. A stored code the list does not hold stays selected, and without the list (no `newsletter:read`, the module off) the code is typed as before.
- **Subscriber attributes (new, optional `attributes`):** up to 10 of the newsletter's custom fields, rendered after the e-mail field and before the topics — a yes/no field as a checkbox, a text, number or date field as the matching input (text at most 500 characters). Each item stores `key`, `type` and `fieldLabel` (picked together in the admin from `GET /api/v1/admin/newsletter/custom-fields`; typed as a key and a type select elsewhere), plus an optional `label`, `placeholder` (not for a yes/no field) and `required`. The form posts `attr.<key>` and one hidden `attrSpec` per attribute; a required attribute left empty is refused in the browser and by the storefront handler with the new `fields` reason, whose message is the block's `messages.fields`, else the page language's text (`CmsRenderProvider`'s new optional `newsletterSignupText`), else English. With no attributes the block's markup is unchanged.
- `@endora-commerce/page-builder-admin` exports `createNewsletterTagCodeField`, `createNewsletterCustomFieldField`, their controls and `withNewsletterAttributePick`; `mod-cms` swaps them into the block in its editor.
- `mod-newsletter` declares `attributes[].label`, `attributes[].placeholder` and `messages.fields` as translatable, and ships the new field labels in English and Polish.
