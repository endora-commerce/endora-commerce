---
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/mod-i18n': patch
---

The API-key and webhook create forms offer their binding as a choice instead of explaining it
(issue #1551, UX audit SHELL-15). *New API key* opens on **Platform key** or **Organization
key**: the organization, sales channel and service account appear only for the second, and each
type offers only the scopes it may hold — no order scopes on a platform key, no `catalog:write`
on an organization key — so the three validation messages that restated the binding rule and the
two paragraphs explaining it are gone. *New webhook* asks **All organizations** or **One
organization**, with the organization picker only for the second. The remaining field help is
one line each, and the signing-secret screen has a one-line title with the receiver note beneath.
What a key or a subscription can do, and the API, are unchanged.

Removed translation keys (`mod-i18n`): `apiKeys.create.bindingHelp`, `bindingTitle`,
`modesHelp`, `scopesHelp`, `serviceAccountHelp`, `expiresHelp`;
`apiKeys.validation.bindingIncomplete`, `bindingRequiredForOrders`, `catalogWriteBound`;
`webhooks.create.organizationHelp`. A deployment overriding them should move the override to the
new `apiKeys.create.kind.*`, `apiKeys.create.{scopes,serviceAccount,expires}.hint`,
`webhooks.create.scope.*` and `webhooks.revealed.body` keys.
