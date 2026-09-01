---
'@endora-commerce/mod-organizations': minor
---

The organization approval and rejection e-mails are sent in the recipient's language.

Both were composed as hard-coded Polish sentences inside
`OrganizationModerationService` and handed straight to `EmailMailerPort.send` with no
code, no template and no language, so a buyer on an English sales channel received
Polish unconditionally.

The module now declares two transactional e-mails, `organization_approved` and
`organization_rejected`, ships `en-US` and `pl-PL` content for both, and routes the two
messages through `templateEmailPort`, which resolves the language from the
system-default sales channel and falls back to `en-US`. English is the primary copy and
the fallback tier; the Polish is the copy these messages already shipped.

`OrganizationModerationService`'s constructor takes an eighth argument, the
`TemplateEmailPort` adapter. It is optional and defaults to the no-op, so an existing
caller keeps compiling and keeps sending — through the English in-code builders, which
remain as the tier reached when the platform holds no definition for a code.
