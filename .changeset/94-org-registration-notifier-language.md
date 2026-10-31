---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': patch
---

The new-organization notification is no longer Polish on every installation.

- `@endora-commerce/contracts` exports `supportedLanguageOf(tag)`: the shipped language
  (`'en'` or `'pl'`) a BCP-47 tag such as a sales channel's `defaultLanguage` is written in,
  `LANGUAGE_FALLBACK` for any other.
- `mod-organizations`: the admin bell entry recorded when an organization registers carries an
  English `title`/`body` and a `titleMessage`/`bodyMessage` key, so each administrator reads it
  in their own language (a Polish administrator sees the same text as before). The fallback
  e-mail sent when no `new_org_registration` template is defined, and the `statusLabel`
  variable passed to that template, are written in the system-default sales channel's
  language from the module's bundle, English when the bundle cannot answer. On a channel whose
  default language is Polish the e-mail is unchanged. New bundle keys:
  `notifications.newRegistration.*`. `OrgRegistrationNotifier` takes two optional
  dependencies, `translate` and `resolveLanguage`.
