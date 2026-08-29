---
'@endora-commerce/mod-admin-notifications': minor
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-linkedin-ads': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-shopping-lists': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-prompt-actions': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-returns': minor
---

Fourteen new packages: the **second** batch of modules to leave `backend/src/modules/`
(feature 080, T040b). Five moved one at a time, then ten together; these fourteen are the
same shape as the ten, and the properties below hold fourteen times over.

**One changeset, not fourteen**, for the reason batch one gives: a changeset is written for
the consumer of a package, and a package that did not exist a moment ago has no upgrader to
instruct. What genuinely differs per package is its layer inventory, and that is the table.

Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
its `manifest.ts`, where the generated manifest index reads the module's identity, its
`dependencies`, its permission codes, its command-palette actions, its settings and its
activation control.

| Package | Subpaths | Entities | Migrations | Ships |
| --- | --- | --- | --- | --- |
| `@endora-commerce/mod-admin-notifications` | `.`, `./backend`, `./migrations` | `AdminNotificationRead`, `AdminNotification` | 1 | `dist` |
| `@endora-commerce/mod-api-keys` | `.`, `./backend`, `./migrations` | `ApiKey` | 1 | `dist` |
| `@endora-commerce/mod-linkedin-ads` | `.`, `./backend`, `./migrations` | `LinkedInConversionMapping` | 1 | `dist`, `i18n` |
| `@endora-commerce/mod-sales-channels` | `.`, `./backend` | — | — | `dist`, `i18n` |
| `@endora-commerce/mod-shopping-lists` | `.`, `./backend`, `./migrations` | `ShoppingListItem`, `ShoppingList` | 2 | `dist` |
| `@endora-commerce/mod-delivery-methods` | `.`, `./backend`, `./migrations` | `DeliveryMethod` | 2 | `dist` |
| `@endora-commerce/mod-prompt-actions` | `.`, `./backend`, `./migrations` | `PromptActionRequest` | 1 | `dist`, `i18n` |
| `@endora-commerce/mod-mfa` | `.`, `./backend`, `./migrations` | `MfaEnrolment`, `MfaOrganizationPolicy`, `MfaRecoveryCode`, `MfaSocialIdentity` | 1 | `dist`, `i18n` |
| `@endora-commerce/mod-webhooks` | `.`, `./backend`, `./migrations` | `WebhookDelivery`, `Webhook` | 3 | `dist` |
| `@endora-commerce/mod-transactional-emails` | `.`, `./backend`, `./migrations` | `EmailBlockSalesChannel`, `EmailBlock`, `EmailTemplateSalesChannel`, `EmailTemplate`, `TransactionalEmailContent`, `TransactionalEmail` | 2 | `dist`, `i18n` |
| `@endora-commerce/mod-cms` | `.`, `./backend`, `./migrations` | `CmsBlock`, `CmsHookBlockAttachment`, `CmsHook`, `CmsPage`, `CmsTemplate` | 2 | `dist`, `i18n` |
| `@endora-commerce/mod-pwa` | `.`, `./backend`, `./migrations` | `PushMessageDelivery`, `PushMessage`, `PushSubscription`, `PwaIconRendition` | 1 | `dist`, `i18n` |
| `@endora-commerce/mod-newsletter` | `.`, `./backend`, `./migrations` | `NewsletterAutomationRun`, `NewsletterAutomation`, `NewsletterCampaignSubscriber`, `NewsletterCampaign`, `NewsletterCustomField`, `NewsletterEmailBlockSalesChannel`, `NewsletterEmailBlock`, `NewsletterEngagementEvent`, `NewsletterSendRecord`, `NewsletterSubscriberTag`, `NewsletterSubscriber`, `NewsletterSuppression`, `NewsletterTag` | 1 | `dist`, `i18n` |
| `@endora-commerce/mod-returns` | `.`, `./backend`, `./migrations` | `Refund`, `ReturnCaseAttachment`, `ReturnCaseComment`, `ReturnCaseItem`, `ReturnCase`, `ReturnDeliveryMethod`, `ReturnListSavedView`, `ReturnReason`, `ReturnShipment`, `ReturnStatusTransition`, `ReturnStatus` | 2 | `dist`, `i18n` |

**`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
name** (D-168) — type-only exports included, which this batch measured rather than assumed:
two packages published their entities' row types so the dev seed could name them, and
`module-package-entity-surface.test.ts` refused both, in as many words — *"that is the one
thing that makes a foreign module's `import type { … }` compile"*. The exports are gone and
the seed takes each class off the published array by name.

**One of the fourteen owns no table and says so with an empty array rather than by
omission.** `@endora-commerce/mod-sales-channels` exports `entities: readonly never[] = []`.
The distinction is not cosmetic: the platform's package loader answers a *missing* export
with `[]`, so "this module has no table" and "somebody forgot the array" would otherwise
arrive as one silence, whose only symptom is a query against a table nobody created.

**One package publishes a type on `./backend` that is not an entity**, and it is there
because a composition root has to name a contribution it supplies:
`@endora-commerce/mod-shopping-lists` re-exports `ShoppingListService`. A root cannot reach
a package's internal file — `rootDir` makes a relative specifier into `packages/` TS6059
even for an `import type` — so a contribution shape has to be on a published subpath or it
is unnameable.

**Two packages declare a `@fastify/*` dependency nothing imports.**
`@endora-commerce/mod-mfa` peers on `@fastify/cookie` and `@endora-commerce/mod-pwa` on
`@fastify/multipart`, because `reply.setCookie`, `request.isMultipart()` and
`request.file()` are declaration-merging augmentations rather than imports. Inside the
application those arrived ambiently through the host's own dependency; a package compiles
against its own manifest, where an unnamed dependency does not exist. Both write
`import type {} from '@fastify/…'`, which is type-only: the plugin is still the host's to
register.

**`@endora-commerce/mod-newsletter` and `@endora-commerce/mod-pwa` also carry a companion
`@types/*` in `devDependencies`** — `@types/nodemailer` and `@types/web-push` — which the
manifest generator now derives. Nothing imports a `@types` package; the compiler finds it
through `node_modules/@types`, which inside a package is the package's own declaration, so
a module importing a JS-only library did not build until this landed.
