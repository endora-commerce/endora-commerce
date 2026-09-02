---
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-i18n': minor
---

`newsletter` and `transactional_emails` ship their admin surfaces.

**New `./admin` subpath on two packages.** `@endora-commerce/mod-newsletter` and
`@endora-commerce/mod-transactional-emails` each export `contributions` — an
`AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and nothing else.
Seventeen routes and nine sidebar entries between them, all at the paths and codes the
hand-written host registrations carried:

- `mod-newsletter` — `/newsletter/subscribers` (the landing route), `/newsletter/campaigns`,
  `/newsletter/campaigns/:id`, `/newsletter/campaigns/:id/stats`, `/newsletter/automations`,
  `/newsletter/automations/:id`, `/newsletter/tags` and `/newsletter/blocks` on
  `newsletter:read`; `/newsletter/campaigns/new`, `/newsletter/automations/new` and
  `/newsletter/provider` on `newsletter:write`, which is the code the API enforces on the
  `POST`s those three screens exist to make and the code the provider row already carried.
  Six sidebar rows, in the `newsletter` section at weights 100 through 600.
- `mod-transactional-emails` — `/transactional-emails` (the landing route),
  `/transactional-emails/blocks`, `/transactional-emails/blocks/:id`,
  `/transactional-emails/templates`, `/transactional-emails/templates/:id` and
  `/transactional-emails/:code`, all on `transactional_emails:read`. Three sidebar rows, in
  the `messaging` section at weights 100, 200 and 300.

Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

**Both packages declare `@endora-commerce/page-builder-admin` as a peer dependency**, and
that is what makes the two a batch rather than two rows. Their whole recorded admin debt was
six reaches into `admin/src/modules/_shared/email-builder/`; P5b published that directory as
`@endora-commerce/page-builder-admin/email`, so the six became bare specifiers into an
`exports` map and there was nothing left to repair. Three `newsletter` screens (the campaign
editor, the automation builder and the block editor) and three `transactional_emails` ones
(both fragment editors and the e-mail editor, through this module's own `EmailEditorPane`
adapter) mount `EmailEditorPane` and `EmailVariablesProvider` from it. `manifests:generate`
derives the peer from those specifiers; a consumer installing either package from a registry
must be able to resolve it.

**Two new components on `mod-transactional-emails`, both internal to its `./admin` layer.**
`EmailBlockEditorPage` and `EmailTemplateEditorPage` each render `EmailFragmentEditor` with
one `kind`. The admin host used to pass that as a prop from its route table
(`element={<EmailFragmentEditor kind="block" />}`), and an `AdminRouteDeclaration.component`
is a factory returning a module whose `default` is read — there is nowhere in a declaration
to put an argument.

**Three new palette actions**, replacing hand-written rows in the admin shell, with the same
destinations, codes and keywords:

- `mod-newsletter` — `open-newsletter-campaigns` → `/newsletter/campaigns` and
  `open-newsletter-automations` → `/newsletter/automations`, both `newsletter:read`.
- `mod-transactional-emails` — `open-email-blocks` → `/transactional-emails/blocks`,
  `transactional_emails:read`.

Both packages' `i18n/{en,pl}.json` gain the nav labels (`nav.subscribers.label` and its five
siblings; `nav.transactionalEmails.label`, `nav.emailBlocks.label`,
`nav.emailTemplates.label`) and the new actions' label and description keys, module-relative
and in both shipped languages.

**`@endora-commerce/mod-i18n` loses fifteen keys**: `appShell.nav.newsletter*` (six),
`appShell.nav.transactionalEmails`, `appShell.nav.emailBlocks`, `appShell.nav.emailTemplates`
and the six `appShell.palette.sub.*` keys the deleted palette rows named. Nothing renders
them after this change — the labels are the two modules' own now. `appShell.section.messaging`
and `appShell.section.newsletter` stay: the shell still owns the section taxonomy.
