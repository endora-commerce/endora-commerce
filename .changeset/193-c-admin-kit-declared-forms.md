---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

Declared forms in the admin kit (issue #2006, `specs/193-admin-form-extensions/` WP-C). Additive only: no existing export changes.

- `./components`: `useDeclaredForm(options)`, `DeclaredFormProvider`, `DeclaredFormSection`, `DeclaredFormNotices` and `useDeclaredFormSubmission()`. A host renders the fields of a form declared with `defineAdminForm` through them. They apply the effective overrides (label, help and placeholder, hidden, read-only, `visibleWhen`, a replacing control), place the slot fields of present modules the operator may see, run the browser-side field rules over the server's held set, split the submission into `{ core, extensions }` and map a refused save onto the fields with `applyError(error)`. Also `PLATFORM_CONTROL_COMPONENTS`, `PlatformControl`, `isPlatformControlId` and the `DeclaredControlProps` type: the components behind the contracts' `PLATFORM_INPUT_CONTROLS`.
- `./lib`: `EffectiveFormsProvider`, `useEffectiveForms`, `useEffectiveForm` and `getEffectiveForms` (`GET /api/v1/admin/effective-forms`, fetched once a declared form mounts and again on every presence refresh). Also the pure half: `declaredFormLayout` and `declaredFormSections` (the contracts' `formLayout` over the server's order), `clientFieldViolations`, `isEffectivelyRequired`, `fieldValueChanged`, `checkPlatformFieldFormat`, `declaredFormSubmission` and `mapDeclaredFormError`.
- `./zones`: `AdminContributionsProvider` also carries an entry's `fields`, `controls` and `fieldBehaviours`, read with `useAdminFormContributions()`.
- `@endora-commerce/admin-shell` mounts `EffectiveFormsProvider` inside `ModulePresenceProvider`. It fetches nothing until a declared form renders.
- `@endora-commerce/mod-i18n` adds the `core` keys `declaredForm.control.choose` and `declaredForm.control.customColor` in `en` and `pl`.
- Additive props for the pickers the platform controls wrap: `CountrySelect` takes `ariaDescribedBy` and `invalid`, and `ColorPicker` takes `labelledBy`. A multiselect or colour field is a `FormField` group (`PLATFORM_GROUP_CONTROLS`), and its trigger is named by the label through `DeclaredControlProps.labelledBy`.
