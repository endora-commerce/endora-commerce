# Contract: admin surfaces — permissions, palette, navigation, routes

Per `specs/conventions/module-admin-surfaces.md`. Everything is declared by `forms` in its own
manifest and admin layer; no shared list is edited.

## §1 Permissions (`manifest.permissions`; labels under `adminRoles.permission.<code>` in `i18n/{en,pl}.json`)

| Code | Label (en) | `requires` | Enforced on |
| --- | --- | --- | --- |
| `forms:read` | View forms | — | form list, detail, versions, preview |
| `forms:write` | Create and edit forms | `forms:read` | create, save, notifications, publish, close, reopen, duplicate, delete, retention-impact |
| `forms:entries_read` | View form entries | — | entries list, detail, mark-read |
| `forms:entries_write` | Process and delete form entries | `forms:entries_read` | status, notes, delete; with `forms:write` for deleting a form with entries and for retention |
| `forms:entries_export` | Export form entries | `forms:entries_read` | CSV export |

`permission-inventory.test.ts` must show both directions and both languages.

## §2 Palette actions (`manifest.actions`; keys relative to the module namespace)

| id | targetRoute | requiredPermission | icon | keywords (en) | keywordsKey |
| --- | --- | --- | --- | --- | --- |
| `open-forms` | `/forms` | `forms:read` | `ClipboardList` | forms, form builder, contact form, survey | `actions.openForms.keywords` |
| `new-form` | `/forms/new` | `forms:write` | `FilePlus` | form, new, create | `actions.newForm.keywords` |
| `open-form-entries` | `/forms/entries` | `forms:entries_read` | `Inbox` | form entries, submissions, responses | `actions.openFormEntries.keywords` |

Labels `actions.<id>.label` / `.description` in both bundles; Polish search words only in the
bundles (issue #560/#573). `check:action-route-permissions` must find each code on its own route.

## §3 Admin layer (`packages/modules/forms/src/admin/index.ts`)

```ts
routes: [
  { path: '/forms',              component: () => import('./pages/FormsListPage.js'),     requiredPermission: 'forms:read', index: true },
  { path: '/forms/new',          component: () => import('./pages/FormCreatePage.js'),    requiredPermission: 'forms:write' },
  { path: '/forms/entries',      component: () => import('./pages/EntriesListPage.js'),   requiredPermission: 'forms:entries_read' },
  { path: '/forms/entries/:id',  component: () => import('./pages/EntryDetailPage.js'),   requiredPermission: 'forms:entries_read' },
  { path: '/forms/:id',          component: () => import('./pages/FormBuilderPage.js'),   requiredPermission: 'forms:read' },
],
nav: [
  { to: '/forms',         labelKey: 'nav.forms.label',   icon: 'ClipboardList', section: 'content', weight: 260, requiredPermission: 'forms:read' },
  { to: '/forms/entries', labelKey: 'nav.entries.label', icon: 'Inbox',         section: 'content', weight: 261, requiredPermission: 'forms:entries_read' },
],
```

`/forms/entries` is declared before `/forms/:id` so the static path wins. Palette coverage
(`admin/test/unit/palette-coverage.test.ts`): `/forms` (landing), `/forms/entries` (sidebar) and
`/forms/new` are covered by actions; the two `:id` routes are detail screens. The exact sidebar place
is the designer's (A-17).

## §4 Screens (composition; the designer owns the layout)

- **Forms list** — `ResponsiveTable` (name, key, status badge, version, entries, updated, warning
  icons), `RowActionMenu` (open, duplicate, close/reopen, delete with `ModalDialog` stating entry
  deletion), create button.
- **Builder** — a content-language switch in the header (`ContentLanguageTabs` over the
  storefront languages, the form's default first; each incomplete language marked with its
  missing-text count from the contracts' `textCompleteness`, which takes the operator to the first
  missing text), shared by the tabs *Fields* / *Settings* (confirmation, restrictions, CAPTCHA,
  retention) / *Notifications* (recipients, per-channel lists, confirmation e-mail) / *Versions*;
  a *Form* card (internal name, title, description, send button text), the field palette, the
  canvas (`useGroupedReorder`; each section a card), the field inspector (a sticky card headed by
  the field type; groups *Basics* — texts, required, width, key with a rename warning, options with
  a stored value and a label, type settings —, *Validation*, *Conditional logic*
  (`ConditionRuleEditor`, new, R-19) and *Integrations* — "Share with integrations" with its
  disclosure), the live preview pane (`cms-components` `FormBlock`, in the content language),
  publish bar (`StickyFormActions`) showing refusal reasons next to the elements and the FR-018
  warnings. In another language than the default only texts are editable; every structural control
  is disabled or hidden with a note, and an empty text shows the default one as its placeholder.
  *(2026-11-03 owner review: this switch replaced the former Translations tab; the tab panels are
  cards of admin-kit `Section`s.)*
- **Entries list** — filters (form, status multi, date range, channel, search), `ResponsiveTable`,
  selection + bulk delete, export button (only with `forms:entries_export`, only with a form chosen).
- **Entry detail** — answers with version labels, consents with shown texts, page, language, channel,
  time, attribution, status control with *Undo*, notes.

All copy in the module bundle (`i18n:hardcoded` must stay at zero for new files).
