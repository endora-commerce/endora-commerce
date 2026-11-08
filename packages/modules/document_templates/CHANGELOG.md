# @endora-commerce/mod-document-templates

## 0.110.0

### Patch Changes

- 6459048: Polish invoice PDFs no longer print English labels (issue #437). The invoice document type's built-in layout carried English literals in its label props (_Issue date_, _Sale date_, _Payment due_, _Payment method_, _Seller_, _Buyer_, the VAT summary's _Total_, and the totals block's _Paid_, _Amount due_, _Total_ and _In words_) and in its footer text (_Thank you for your business._). A label prop wins over the translation, so an invoice, proforma or correction printed with that layout said _Paid_ where it should say _Zapłacono_. Every one of these props is empty in the built-in layout now (`GENERIC_INVOICE_TEMPLATE_SEED_REVISION` 3), and an empty prop is drawn in the document's language. The footer follows the labels: an empty or blank footer text prints the default footer in the document's language. Until now it printed an empty footer, while the editor's canvas already showed the default.

  `Migration20261107T110328DocumentTemplatesInvoiceSeededLabels` (`mod-document-templates`) does the same to stored invoice templates. In every language layout of every `invoices.invoice` template, it empties a prop only where the prop holds **exactly** the English literal the built-in layout seeded, and it advances `version` on each template it changes. Every other value stays as it is: a translated label, a reworded one, or a footer with a line added. Other document types are untouched.

  **Behaviour change on upgrade.** If an invoice template kept a seeded English label because you wanted English on Polish invoices, the label prints in Polish after the upgrade. Type the English label into the block again to keep it. The same applies to the English sample footer.

- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
- 2fd4bde: The invoice template editor's canvas draws what the PDF prints (#888). A label the template leaves empty is shown in the language of the tree being edited, from the invoices bundle's `pdf.*` keys. That covers the header title and dates, seller and buyer, the tax ID rows, the line-item and VAT-summary column headers, the totals and the default footer. A label the operator typed is shown as typed. The document-template editor now wraps its canvas in `BlockRenderEnvironmentProvider` with the edited language and `preview: true`, so a contributed block's `useBlockRenderEnvironment().language` is the edited tree's language and no longer always `en`.
- Updated dependencies [18cce2e]
- Updated dependencies [18cce2e]
- Updated dependencies [9cfb28b]
- Updated dependencies [a206da9]
- Updated dependencies [34485ae]
- Updated dependencies [34485ae]
- Updated dependencies [0f1717c]
- Updated dependencies [86e8761]
- Updated dependencies [9bfb0b8]
- Updated dependencies [ed5cf6a]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [5303aab]
- Updated dependencies [16f85f4]
- Updated dependencies [270aa2b]
- Updated dependencies [3f020ba]
- Updated dependencies [3f020ba]
- Updated dependencies [b59e5d5]
- Updated dependencies [b59e5d5]
- Updated dependencies [bf1cc2d]
- Updated dependencies [ff60e93]
- Updated dependencies [6f19230]
- Updated dependencies [77b8c37]
- Updated dependencies [65104b8]
- Updated dependencies [7acaa33]
- Updated dependencies [7019c71]
- Updated dependencies [4eee98b]
- Updated dependencies [14ac256]
- Updated dependencies [248bf1b]
- Updated dependencies [b2db8c3]
- Updated dependencies [4cf529d]
- Updated dependencies [5e4dd48]
- Updated dependencies [75b053f]
- Updated dependencies [54fc8f1]
- Updated dependencies [dac5795]
- Updated dependencies [5bbb389]
- Updated dependencies [d69e765]
- Updated dependencies [dbc1cef]
- Updated dependencies [d69e765]
- Updated dependencies [a6bc891]
- Updated dependencies [8ad737c]
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [cea1470]
- Updated dependencies [d46d414]
- Updated dependencies [73e2eec]
- Updated dependencies [29d7e90]
- Updated dependencies [7f2fa6e]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
- Updated dependencies [e46d233]
- Updated dependencies [58a1632]
- Updated dependencies [b476f44]
- Updated dependencies [14fe4fb]
- Updated dependencies [76d89ab]
- Updated dependencies [5cbffb9]
- Updated dependencies [c01aaa3]
- Updated dependencies [6bd2ab7]
- Updated dependencies [a3502c0]
- Updated dependencies [7a73cc8]
- Updated dependencies [5ff8302]
- Updated dependencies [fc7db4c]
- Updated dependencies [c34b405]
- Updated dependencies [5af8c25]
- Updated dependencies [48f055e]
- Updated dependencies [bf50b85]
- Updated dependencies [2c6fba0]
- Updated dependencies [0801f69]
- Updated dependencies [d1c0d13]
- Updated dependencies [6d1d284]
- Updated dependencies [974be57]
- Updated dependencies [99c075e]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0
  - @endora-commerce/platform@0.110.0
  - @endora-commerce/page-builder-admin@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/page-builder-core@0.110.0

## 0.109.0

### Patch Changes

- 0e33ca9: The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

  - `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
  - The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- df95f59: The manifests now declare the refusal tokens of every error code they raise with a computed `details.code`. `mod-tasks` declares `TASK_WORKFLOW_INVALID`'s ten rule tokens and `TASK_STATUS_IN_USE_TOO_MANY`'s `priority`; `mod-custom-fields` (`CUSTOM_FIELD_OPTION_IN_USE`, `CUSTOM_FIELD_STORED_VALUES_EXIST`, `CUSTOM_FIELD_VALUE_TYPE_LOCKED`), `mod-document-templates` (`DOCUMENT_TEMPLATE_INVALID`) and `mod-projects` (`PROJECT_MOVE_NOT_PERMITTED`) declare `tokens: []`, stating that those raises never carry a token. Every token already had its sentence in English and Polish, so no rendered message changes.
- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [eeed924]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/page-builder-admin@0.109.0
  - @endora-commerce/page-builder-core@0.109.0

## 0.108.0

### Minor Changes

- 1df7a5e: The Line items table prints a document's groups.

  - **Contracts.** `DocumentCollectionDeclaration` gains an optional `sections(data)` answering `DocumentItemSection[]` (`{ key, kind: 'group' | 'ungrouped', label, itemIndexes, summary }`, with `documentItemSectionSchema` and `DOCUMENT_UNGROUPED_SECTION_KEY`); `isValidSectionPartition(sections, itemCount)` checks one. `itemsTableGroupingSchema` is now a union of `{ by: 'sections', otherItemsLabel, showItemCount }`, `{ by: 'none' }` and the existing field shape (with `by: 'field'` optional) — `itemsTableSectionsGroupingSchema`, `itemsTableNoGroupingSchema`, `itemsTableFieldGroupingSchema`; `itemsTableGroupingMode(raw)` reads a stored value. `documentCollectionDetailSchema` gains `sampleSections` (default `[]`). `documentSectionTexts(language)` answers the default _Other items_ heading and the plural item count in English and Polish.
  - **Changed meaning of a stored `grouping: null`.** It meant _No grouping_; it now means **the document's groups**, which is also what an absent setting means. A document with no group prints exactly as before (the flat definition is unchanged), so this changes nothing until a document has groups — then every template, including those saved before this release, prints them without being edited. A table that must stay flat whatever the document says stores `{ by: 'none' }` (_No grouping_ in the editor).
  - **Document templates.** In that mode, a document holding a group prints per section a heading row (the group's name, the item count when enabled), its rows and one subtotal row per totals row of the table over the section's totals, then _Other items_ and the document's totals. The renderer reads `sections()` once per collection per render; a host that throws, or answers a partition that does not cover its lines, is logged and the table prints flat. Route 2 serves `sampleSections`; the editor's _Grouping_ field offers _Document's groups_, _By field_ and _No grouping_, the _Other items_ heading and _Show item count_, and the canvas draws the sample's groups.
  - **Quote requests.** The quote's `lines` collection declares its sections (`quoteLineSections`), each with the quote's totals rule over its own lines; the editor's sample quote has two groups and an ungrouped line.

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/page-builder-admin@0.108.0
  - @endora-commerce/page-builder-core@0.108.0

## 0.107.0

### Minor Changes

- dd939be: New module `document_templates` (`specs/152-compare-pdf-template/`): operator-designed Page
  Builder layouts for the PDF documents the platform produces.

  - Table `document_templates` (one migration): templates per document type and scope (all sales
    channels or one), at most one default per scope, one layout per language, optimistic versions.
  - `documentTypeRegistry` — a contribution registry a module pushes its document type into from a
    contribution-only boot hook; a type and each contributed block are answered only while their
    module is present.
  - `documentRenderPort` — the gated Page Builder → pdfmake engine:
    `render({ documentType, salesChannelId, language, data, templateId? })` resolves the channel
    default, the global default, then the built-in layout; `templateId` is honoured only for
    `selection: 'per_document'` types. Images come from the assets library only; pdfmake's URL
    access is denied.
  - Six general-purpose blocks (`document_templates.Heading`, `Text`, `Image`, `Spacer`, `Divider`,
    `PageBreak`), offered to types that opt in.
  - Admin API `/api/v1/admin/document-templates` (12 routes; `document_templates:read` /
    `document_templates:write`), every write a Command with one audit row.
  - Admin: _Document templates_ list and editor (palette = the template's document type), sidebar
    entry and the `open-document-templates` palette action.
  - Activation `document_templates.enabled` (default on). It cannot be switched off while
    `invoices` is on.

- d571d8c: The **Line items table** (`document_templates.ItemsTable`, `specs/153-quote-request-pdf-template/`).

  - A document type that declares a line collection is offered the table: columns chosen from the
    collection's field catalogue (1–16, each with header, width, alignment, format, empty text and a
    visibility rule _always_ / _only if any line has a value_ / _never_), an optional detail row,
    totals and grouping with subtotals. It is printed as a real table that repeats its header row on
    every page and never splits a line's row; its settings are validated when a template is saved
    (`DOCUMENT_TEMPLATE_INVALID` naming the setting).
  - The admin editor gains the table's column, detail row, totals and grouping editors, with
    **Internal** badges on fields customers do not otherwise see, and a canvas drawn with the same
    formatting as the PDF.
  - `GET /api/v1/admin/document-templates/types/:code` answers the type's `collections` (fields in
    the asked language, sample lines and totals).
  - `documentRenderPort.listChoices` answers the templates a person may pick for one document of a
    per-document type.
  - The command palette entry is also found by _quote pdf_, _offer template_, _szablon oferty_ and
    _zapytanie ofertowe pdf_.

### Patch Changes

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ad55813]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/page-builder-admin@0.107.0
  - @endora-commerce/page-builder-core@0.107.0
