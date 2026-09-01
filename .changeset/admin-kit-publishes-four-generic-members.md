---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-cms': major
---

`@endora-commerce/admin-kit` publishes four generic members that sat under a module's
admin directory and were rendered from another's (feature 091, P8).

**`./components` gains `ContentLanguageTabs` and `ScopePicker`.**

- `ContentLanguageTabs({ languages, activeLanguage, onChange })` — a tab strip over
  content language codes. Its props type is `ContentLanguageTabsProps`.
- `ScopePicker({ value, onChange })` — sales channels and the content languages inside
  them. Its props type is `ScopePickerProps` and its value type is **`ScopePickerValue`**,
  which is `CmsScopeValue` renamed: `{ salesChannelIds: string[]; languages: string[] }`,
  field for field. A consumer importing `CmsScopeValue` from `mod-cms`' admin code renames
  the type and changes nothing else.
- `listScopeSalesChannels(pageSize?)` and `fetchScopeSalesChannel(code)` come with it. The
  picker called `sales_channels`' admin API client; it now builds both `GET`s from the
  published `apiClient` and the contract's own `SalesChannelListResponse` /
  `SalesChannelDetail`, so the kit holds no module code.

**`./ui` gains `Section`** — `Section({ title, action?, className?, children })` and
`SectionProps`. A heading, an optional action beside it and a slot; it is a layout
primitive, which is why it is here and not on `./components`.

**`./lib` gains the three invoice e-mail-outcome helpers** — `invoiceEmailNotSentReason`,
`sendInvoiceEmailMessage` and `issueInvoiceNotice`, plus the `Translate` type they take.
Signatures are unchanged: each still receives the caller's scope-bound `t`.

**`@endora-commerce/mod-cms`' bundle loses six keys** and `@endora-commerce/mod-i18n`'s
gains them under new names, because the two components now render out of `core` (ruling
R-1: a translation namespace is module knowledge). None of the six had another reader.

| gone from `mod-cms` | arrives in `mod-i18n` |
| --- | --- |
| `languageTabs.empty` | `contentLanguageTabs.empty` |
| `languageTabs.ariaLabel` | `contentLanguageTabs.ariaLabel` |
| `scope.title` | `scopePicker.title` |
| `fields.languages` | `scopePicker.languages` |
| `scope.selectChannel` | `scopePicker.selectChannel` |
| `scope.loadingLanguages` | `scopePicker.loadingLanguages` |

Every value is carried across unchanged in both shipped languages. **A consumer that
supplies its own bundle has to move all six**: a key left in the `cms` scope does not fail
to compile and does not 404 — it renders `core.scopePicker.title` into the operator's screen
as a label.

The invoice e-mail helpers move no key. All twelve they read —
`invoices.emailNotSent.<reason>` (seven), `invoices.emailSent`,
`invoices.emailNotSentNotice` and three `orderDetail.issueInvoice.*` — were already
`mod-i18n`'s in both languages and in neither `mod-invoices`' bundle nor `mod-orders`'.
