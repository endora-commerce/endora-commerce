# Contract: changes outside `packages/modules/forms/`

The implementer touches a file outside the new module only if it is listed here (or is a generated
artefact / ledger named in `tasks.md` § standing rules). Each change is additive; stored data and
stored pages render byte-identically (FR-006, SC-005).

## §1 `customer_accounts` — the anonymisation event (research R-17)

- `packages/contracts/src/customer-accounts.ts`: `CUSTOMER_ACCOUNT_ANONYMIZED_EVENT`,
  `CustomerAccountAnonymizedEventV1Schema` (events-and-webhook.md §3).
- `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts`:
  `anonymize` emits the event after flush + audit, only on the transition; the service receives an
  `emitAnonymized(payload)` callback (bound in `index.ts` to `eventBus.run(() => eventBus.emit(…))`,
  read per call — never a captured bus).
- `packages/modules/customer_accounts/src/backend/index.ts`: the binding.
- Test beside the service. No migration, no manifest change (an event needs no dependency edge).

## §2 `@endora-commerce/contracts`

- New `src/forms.ts`, `src/forms-logic.ts`, `src/forms-logic.fixtures.ts` (+ tests); `src/index.ts`
  exports; `src/errors.ts` gains the 13 `FORM_*` codes (each in the change adding its first raise
  site); `src/storefront-cache-tags.ts` gains
  `FORMS_STOREFRONT_CACHE_TAGS = { form: (id) => \`forms:form:${id}\` }`.

## §3 `@endora-commerce/cms-components`

- `src/components/forms/` (new: `FormBlock.tsx`, `FormField.tsx`, `FormErrorSummary.tsx`,
  `form-block-state.ts`, `captcha-loader.ts` + tests); `src/index.ts` registers `forms.Form`
  (one entry after `newsletter.Signup`); `src/schema/component-types.ts` `FormBlockProps`;
  `src/utils/block-data.ts` the `form` kind (§3 of blocks-and-storefront.md);
  `src/hooks/use-block-data.ts` the `fetchForm` branch; `src/components/render-context.tsx` the
  optional `forms` entry; `styles/cms-components.css` a `cmsc-pb-form` section, then rebuild
  `dist/cms-components.css` with the package build (never hand-merged).

## §4 `@endora-commerce/page-builder-admin`

- `src/chrome/FormPickers.tsx` (new) and one export line in `src/index.ts`.

## §5 `cms` module (admin only)

- `packages/modules/cms/src/admin/components/FormBlockFields.tsx` (new), one loop line in
  `PageBuilderEditor.tsx`, `AdminCatalogPreviewProvider.tsx` gains `fetchForm`; labels of the swapped
  fields in `packages/modules/cms/i18n/{en,pl}.json` under `blocks.form.*`. No backend change; `cms`
  gains no dependency on `forms` (the picker reads `forms`' admin API over HTTP, as
  `NewsletterPickers` reads `newsletter`'s).
- T109/T111 (US10-1): `block-contributions.ts` gains `withoutWithdrawnBundledBlocks`, applied once
  to the bundled renderers in `PageBuilderEditor.tsx`'s `mergeConfig`: a bundled block owned by a
  module other than `cms` that the served (presence-filtered) descriptor does not declare is
  withdrawn, so a stored one shows the missing-block note. Generic — it holds for `newsletter.Signup`,
  `catalog.*` and `blog.*` as well; nothing names `forms`. Test in
  `admin/test/modules/cms/block-contributions.test.tsx`.

## §6 Storefront

- `app/forms/submit/route.ts` (new); `app/reserved-segments.ts` — comment on `forms` names both
  handlers (no new segment); `lib/api/forms.ts` (new); `lib/page-builder/forms-context.ts` (new);
  `lib/page-builder/block-data.ts` `fetchForm`; `components/CmsPageRenderer.tsx` one prop;
  `lib/i18n/messages/forms.ts` (new namespace, `en-US` + `pl-PL` via `defineMessages`) and its
  registration in `lib/i18n/messages.ts`.

## §7 Admin app

- Nothing hand-edited: `admin/src/modules.generated.ts`, `admin/src/tailwind.generated.css` and
  `admin/package.json` are written by `composer:generate` / `manifests:generate`.

## §8 Backend application and test harness

- Generated: `backend/src/**/manifest-index.generated.ts`, `migrations-registry.generated.ts`,
  `entities-registry.generated.ts`, composer artefacts, `backend/package.json` dependency — by
  `composer:generate` / `manifests:generate`.
- Ledgers/fixtures: `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
  (`MINTED_ERROR_CODES`), `backend/test/helpers/package-entities.ts`,
  `backend/test/fixtures/openapi-baseline.json` (regenerated).

## §9 Docs

- `packages/modules/forms/docs/forms.md` (module-owned page); Polish mirror under
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/forms.md` + its cache entry in
  `docs/translation-cache/pl/`; the generated module reference (`docs/docs/module-reference/forms.md`)
  and its Polish counterpart + cache entry; `packages/modules/cms/docs/cms/…` gains no edit (the
  block is documented on the forms page; no cross-module relative link — `foreign-module-link`).
