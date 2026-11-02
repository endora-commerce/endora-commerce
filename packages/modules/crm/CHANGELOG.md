# @endora-commerce/mod-crm

## 0.109.0

### Minor Changes

- 4bc5c7f: Opportunity attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Opportunities a reader may not see — those outside their Organization reach, or every one without `crm:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/crm/opportunities/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the existing refusals.
- 55864a1: Opportunities can refer to Opportunities and Projects (`specs/165-task-management/` R-5).

  - Migration `crm_opportunity_reference_kinds` widens `crm_opportunity_references_target_type_check` to the seven reference kinds; its `down` restores the five.
  - An Opportunity's description and notes resolve `[[opportunity:…]]` and `[[project:…]]` references per reader, and the `@@` list offers Opportunities and Projects when their module is on and the reader may read them. A referenced Project shows as unavailable while Projects is off.
  - `opportunityReadPort` gains `findByIds` and `search`.
  - The tag picker and the board's _Move to…_ menu now come from `@endora-commerce/admin-kit`; nothing changes for the user.

- b8b6eed: An Opportunity's texts follow the reference standard shared with Projects: `@@` is one document
  list — Orders · Quote requests · Tasks — and a Quote Request or a Task can be referred to in the
  description, a note or a message. The Opportunity's screens are drawn with the admin kit's
  collaboration components, and the screen ends with a zone other modules can fill.

  **`@endora-commerce/mod-crm`**:

  - **`@@` opens the document list**, where it searched the Organization's Orders alone. _Insert
    document_ replaces _Insert order_. Orders and Quote Requests are the Opportunity's
    Organization's (on the create form, the Organization chosen there); Tasks are any the reader
    may see. Each group is offered only to a holder of `orders:read`, `rfqs:handle` or `tasks:read`
    respectively, and only while its module is on; a role holding none of the three keeps `@@` as
    typed.
  - **`[[quote_request:<uuid>]]` and `[[task:<uuid>]]` are stored and resolved** like the other
    three types: `references` names a Quote Request by its number (`/quote-requests/<id>`) and a
    Task by its number (`/tasks/<id>`), and answers `available: false` without a label for a reader
    without `rfqs:handle` / `tasks:read`, for a Task its context hides, for a target that is gone,
    and while Quote Requests / Tasks are switched off. Texts stored before are unchanged byte for
    byte, and read as they did.
  - New route `GET /api/v1/admin/crm/lookups/documents?opportunityId=…&q=…` (`crm:write`; or
    `organizationId=…` before the Opportunity exists) answering `RecordDocumentLookupResponse`, at
    most ten documents per group — the shape Projects serves at `GET /projects/lookups/documents`.
  - New migration `crm_opportunity_reference_documents`: the `crm_opportunity_references`
    target-type check admits `quote_request` and `task`. Its `down` deletes the rows of those two
    types first; the texts keep their tokens.
  - A new `degrades-without` edge on `tasks` (`taskReadPort`): with Tasks off or absent, Task
    references read as unavailable and Tasks are not offered after `@@`. Tasks stays switchable
    while CRM is on.
  - Notes, messages, references, attachments, the change history and the list pager are drawn with
    the `@endora-commerce/admin-kit/components` collaboration components; apart from `@@` above,
    what these screens show and do is unchanged. The package no longer declares `@tiptap/react` or
    `@tiptap/starter-kit` — the editor is the kit's. A chip's token attribute is now
    `data-reference-token` (was `data-crm-token`), and an Order chip's `data-order-reference` (was
    `data-crm-order-reference`); a chip copied from the earlier editor still pastes as a chip.
  - The Opportunity's screen mounts the `opportunity.detail.after` zone once, after the card
    holding its tabs, handing over the Opportunity's id and nothing else. With nobody contributing
    — no module, one that is switched off, or a person without the contribution's permission — the
    screen is unchanged. CRM names no contributor; the first is the Projects module's _Project_
    panel.

  **`@endora-commerce/contracts`**:

  - `OpportunityDocumentLookupQuerySchema` (`opportunityId?`, `organizationId?`, `q?`) and its type,
    the query of the new route; the answer is `RecordDocumentLookupResponseSchema`.
  - `AdminZoneNameSchema` gains `'opportunity.detail.after'`, with its props
    `OpportunityDetailZoneProps { opportunityId }` in `AdminZonePropsMap`. A consumer that switches
    exhaustively over `AdminZoneName` gets a compile error until it handles the new member.

### Patch Changes

- 77c01b1: The opportunity board no longer loses a filter when two of them change in the same moment. Two filter boxes whose typing pause ended together — two different fields, or the lowest and the highest of one field — each started from the address of the last render, so the second wrote over the first and only one reached the server and the address. Every change to the board's filters is now applied to the filters as they stand, and a field's filter is merged into the one the board holds, not the one its box was last given.
- bd7968e: Every sidebar screen of these eight modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords. Each action carries the permission code of the screen it opens, so the palette never offers a screen the operator is refused.

  - `@endora-commerce/mod-catalog` declares `open-attribute-sets`, `open-attachment-types` and `open-bulk-operations` (`catalog:read`).
  - `@endora-commerce/mod-crm` declares `open-crm-tags` and `open-crm-workflow` (`crm:configure`).
  - `@endora-commerce/mod-inventory` declares `open-warehouses`, `open-low-stock` and `open-stock-notifications` (`inventory:read`), and `import-stock` (`inventory:write`).
  - `@endora-commerce/mod-newsletter` declares `open-newsletter-tags` and `open-newsletter-blocks` (`newsletter:read`), and `open-newsletter-provider` (`newsletter:write`).
  - `@endora-commerce/mod-orders` declares `new-order` for the order-entry form (`orders:write`).
  - `@endora-commerce/mod-projects` declares `open-project-roles` and `open-project-loss-reasons` (`projects:configure`).
  - `@endora-commerce/mod-promotions` declares `open-promotion-rules` (`promotions:read`).
  - `@endora-commerce/mod-settings` declares `open-setting-groups` (`settings:read`) and `clear-cache` (`settings:write`).

- 8eb0fcb: The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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
  - @endora-commerce/email-components@0.109.0

## 0.108.0

### Minor Changes

- bc1b52c: **Behaviour change for API clients.** On `GET /api/v1/admin/crm/opportunities` without `cardValues=true`, a `custom:` reference in `fieldFilters` is now governed by the custom-field definition's list-filter option instead of the board card: a field with the option on is filtered whether or not the card shows it, and a field with the option off is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it. More than 10 `custom:` references or 100 chosen values in total are refused with 400 `VALIDATION_FAILED`. An operator that does not apply to a field's type, or an inverted range (a minimum above its maximum, a start date after its end), is refused with 400 `VALIDATION_FAILED` rather than ignored or answered empty. `builtin:` references keep the card rule. With `cardValues=true` (a board lane continued in the list) and on `GET /api/v1/admin/crm/board` nothing changes.

  `GET /api/v1/admin/crm/opportunities/custom-field-filters` (`crm:read`) lists the Opportunity custom fields the list offers as filters.

- 7995063: Custom-field filters on the Opportunities list, governed by the list-filter option.

  - The list offers one filter per Opportunity custom field whose _Use as list filter_ option is
    on — whether or not the board card shows the field — beside its existing filters.
  - A filter is sent as a `custom:<key>` reference in `fieldFilters`, never with `cardValues`, so
    the list-filter rule applies; any change returns the list to its first page.
  - The filters live in the address as `cf.<key>.<op>`, so a filtered list can be bookmarked and
    shared.
  - A filter that is no longer available is reported by the field's name, with _Remove this
    filter_.
  - The panel shows the first three custom-field filters and puts the rest behind _More filters
    (n)_; a hidden field with an active filter is always shown.
  - The board, its card-field filters and its lanes are unchanged.

- cf7a9c0: The Opportunity screen is edited in place, its free text is formatted, and an Order reference says what the Order is.

  - **Inline editing.** The header's _Edit_ and its form are gone: the title, the description, the expected close date, the contact person, the Sales Channel and a typed value are each edited where they are shown, with _Save_ and _Cancel_. A save sends that field alone under `If-Match`; on `409 VERSION_CONFLICT` the newer Opportunity is shown and the draft kept.
  - **Formatted text (WYSIWYG).** Descriptions, notes, messages and Event descriptions are written in a TipTap editor with a toolbar (bold, italic, strikethrough, lists, links) and keep the `@`, `@@` and `@@@` reference shortcuts. What is stored is the text grammar of `@endora-commerce/contracts` — no HTML. **New optional peer dependencies `@tiptap/react` and `@tiptap/starter-kit` (`^3`)** for the admin layer; the admin application already carries them.
  - **Order references** show the status, total, date and customer, open the Order with a way back to the Opportunity, and have a button that opens it in a new tab. Every link from an Opportunity to an Order or a Quote Request carries `?returnTo=`.
  - Admin API: an Order reference in `references[]` carries `order` (see `@endora-commerce/contracts`).

- b0e1abd: A custom-field value that was not carried is recorded with the field's label, so its history line can name the field.

  - **`customFieldCarryPort`** names every skipped key with the **source** definition's label as
    it reads at that moment — `label: { labelDefault, labels }` — a `target_missing` skip
    included.
  - **Records keep the label.** The Order system note (`systemNote.skipped`), the Quote Request
    `custom-field-carry-skipped` event and its `custom_field_carry_skipped` history entry, and the
    Sales Opportunity audit member `customFieldCarry.skipped` store each skip's label next to its
    key and reason. It is a snapshot: renaming the field later does not change history. Skips
    recorded earlier have no label and read as before.
  - An administrator who cannot read custom-field definitions can now be shown which field was
    not carried and why. The values themselves stay visible only to readers with
    `custom_fields:read`.

- 96c07f5: Sales Opportunities created for, or joined by, an Order or a Quote Request receive the document's carried custom-field values.

  - **On automatic creation.** An Opportunity created for a placed Order or a submitted Quote
    Request receives every value whose Order or Quote Request definition carries to Opportunities.
    The values are stored by the `crm.opportunity.create` Command, run on the system's behalf, and
    are not re-validated against the Opportunity's other fields, so a required field cannot stop
    the creation.
  - **On joining.** An Order placed from a Quote Request linked to an Opportunity carries its values
    into that Opportunity's **empty** fields inside the `crm.opportunity.link_add` Command; a value
    the Opportunity already holds is kept. An operator's manual link and an origin link carry
    nothing into the Opportunity.
  - **History.** When anything was carried or skipped, the creation or link entry's `after` gains
    `customFieldCarry: { source: { entityType, recordId }, carried, skipped }` (each skipped key
    with its reason), and the link entry gains `customFieldValues` when values were carried. These
    entries are what `GET /api/v1/admin/crm/opportunities/:id/history` returns.
  - **From an Opportunity into its documents.** Once an Order or a Quote Request an administrator
    created from an Opportunity is linked to it, the Opportunity's values are pushed to the
    document's owner (`orderCustomFieldCarryPort`, `quoteRequestCustomFieldCarryPort`), which carries
    them into empty fields and records what it skipped on the document. Only a link just made
    carries; a refused origin carries nothing. The Quote Request receiver is reached only while
    `quote_requests` is present — a new `degrades-without` entry for
    `quoteRequestCustomFieldCarryPort` in the manifest.
  - `OpportunityOriginLinkServiceDeps` gains the required `carryIntoDocument`.
  - `OpportunityServiceDeps` and `OpportunityLinkServiceDeps` gain the required `customFieldCarry`
    (`CustomFieldCarryPort`); `AutomaticOpportunityInput` and `AutomaticLink` gain an optional
    `carry`.

### Patch Changes

- ee26beb: Documentation for custom-field list filters, in English and Polish.

  - `@endora-commerce/mod-custom-fields` ships its first documentation page: the records that take
    custom fields, creating and editing a field and the limits of editing, the _Use as list
    filter_ option, how each type filters, and the list APIs.
  - The `orders`, `quote_requests` and `crm` pages describe the custom-field filters on their admin
    lists. The `quote_requests` page also says that its fields follow the module's activation. The
    `crm` page explains how the Opportunities list's filters differ from the board's card-field
    filters.

- cec838d: The opportunity's _Change history_ labels the `customFieldCarry` member of a creation or a join: which kind of record the values came from and one line per key not carried with its reason, the field named by the label stored with the skip, for every reader of the opportunity. A reason the screen has no sentence for reads "the value could not be carried", never its code. A carry that skipped nothing adds no row.
- 6f1e0ec: **Behaviour change for API clients — an Opportunity's change history serves custom-field values only to `custom_fields:read`.** `GET /api/v1/admin/crm/opportunities/:id/history` now leaves `customFieldValues` out of every entry's `before` and `after` for a caller who holds `crm:read` without `custom_fields:read` (the `requires` of `crm:read` is advisory, so such a role exists); the rest of each entry is unchanged, and `after.customFieldCarry` — keys, reasons and labels, never a value — is still served to every reader. Decided server-side, once per page, through `OwnerReadChecks.customFields`, a new member of that interface. A carry into a document created from an Opportunity that throws after the link has committed is now written to the log as a warning, with the document and the Opportunity, instead of reaching the event subscriber.
- 8f08235: The opportunity's _Change history_ follows the server's custom-field rule on screen too. For a reader without `custom_fields:read` it shows no _Custom fields_ row, even if a response still carries values, and reads no field definitions. An edit whose only change was custom-field values no longer stands empty under its heading: it says "Custom field values changed. Your role does not give access to them." („Zmieniono wartości pól niestandardowych. Twoja rola nie daje do nich dostępu.").
- 108955f: The formatted text field no longer throws `[tiptap error]: The editor view is not available` when React runs its effects with an editor the editor hook has already destroyed — effects reconnected after a lazy tab is revealed or a Suspense boundary resolves. Every effect that touches the editor's view now waits for the editor that replaces it.
- e6f3a78: Unit prices are shown by the one rule of the owner ruling of 2026-10-25: two places when the third and fourth are zero, otherwise the significant places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`); line values and totals keep two.

  - `@endora-commerce/mod-invoices`: the invoice PDF's unit net price column (new `unitMoney` beside `money` in the PDF sections), the admin invoice screen and the template preview.
  - `@endora-commerce/mod-carts`, `@endora-commerce/mod-customers`: the admin cart and the customer's cart history.
  - `@endora-commerce/mod-comparisons`: a compared product's price on the screen, the canvas and the PDF (`1.50 PLN`, `0.0125 PLN`), where it was rounded to two places.
  - `@endora-commerce/mod-crm`: an Opportunity's value of a linked Quote Request adds the quote's line values, each rounded to the cent once, as the quote desk does; it rounded only the sum.
  - `@endora-commerce/cms-components`: the CMS product card's price; the package now depends on `@endora-commerce/contracts` for the rule.

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
  - @endora-commerce/email-components@0.108.0

## 0.107.0

### Minor Changes

- bf9881f: Each module contributes its record type to admin global search (`@endora-commerce/mod-admin-search`).

  | Package              | Record type                           | Fields offered (default in bold)                                                 | Permission                             |
  | -------------------- | ------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
  | `mod-orders`         | `orders.order`                        | **number**, **organizationName**, **customer**, billingCompanyName, billingTaxId | `orders:read`                          |
  | `mod-quote-requests` | `quote_requests.quote_request`        | **number**, **organizationName**, **customer**, customerNote                     | `rfqs:handle`                          |
  | `mod-crm`            | `crm.opportunity`                     | **number**, **title**, **organizationName**, description                         | `crm:read`                             |
  | `mod-organizations`  | `organizations.organization`          | **name**, **taxId**, legalName                                                   | `customers:read` or `customers:manage` |
  | `mod-customers`      | `customers.customer`                  | **email**, **name**                                                              | `customers:read`                       |
  | `mod-catalog`        | `catalog.product`, `catalog.category` | **sku**, **name**, slug, quickSearchAttributes; **name**, **slug**               | `catalog:read`                         |

  Every provider applies its own admin list's visibility: sales representatives see only their
  organizations' orders, quote requests, opportunities and customers; organizations follow the
  Organizations list, with a representative's assigned organizations ranked first. Each module declares
  a `contributes-to` edge on `adminSearchProviderRegistry`, so none of them depends on global search and
  none loses its switch. `mod-quote-requests`, `mod-organizations`, `mod-customers` and `mod-catalog`
  now declare `_i18n` in `dependencies` (status labels in the admin's language), and each module's
  bundle gains `adminSearch.*` keys in English and Polish.

### Patch Changes

- 2933bf0: `@endora-commerce/admin-kit/components` publishes two new components. `ModalDialog` (with `ModalDialogProps`) is the dialog primitive `crm` used to keep to itself: a titled panel over a scrim with an accessible name, a focus trap, Escape and scrim to close, and a `busy` flag that makes both inert. It gains two optional props, `initialFocusRef` (focused on open instead of the first focusable element) and `finalFocusRef` (focused after close instead of the opener, read at close time); without them it behaves as before. `useFocusTrap` accepts the same two refs through a new optional third argument (`FocusTrapOptions`). `SavedViewsControl` (with `SavedViewsControlProps` and `SavedViewState`) is the saved-views selector with _Save view_ and _Delete view_, both through dialogs rather than the browser's native prompts: the caller passes the list's saved-view endpoint, its current state and an `onApply` callback, and the control lists, creates and deletes views through the kit's `apiClient`. A name the server refuses as taken (`409`) is shown in the save dialog with the name field marked invalid until the next keystroke. It never sends an update.

  `crm` imports `ModalDialog` from the kit instead of its own copy, which is deleted. No behaviour changes.

  The `core` bundle gains eighteen `savedViews.*` keys in English and Polish — the copy `SavedViewsControl` and its dialogs render.

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
  - @endora-commerce/email-components@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/email-components@0.106.0

## 0.105.0

### Minor Changes

- 60cfd18: The tabs of an Opportunity say how much is behind them. _Notes_ and _Attachments_ show their number
  of items, as _Links_ already did; _Events_ keeps the number of Events that have not ended yet; and
  _Messages_ shows how many messages the signed-in administrator has not read. A tab with nothing
  behind it shows no number. Each number is read aloud with what it counts — "Notes, items: 3",
  "Events, upcoming: 2", "Messages, unread: 1" — and follows a change made on its own tab without a
  reload of the page.

  Unread messages are counted per administrator: a message somebody else wrote after the point you
  have read up to. Opening the _Messages_ tab reads them, for a holder of `crm:read` alone as well,
  and one administrator's reading changes nothing for another. Reading is not a change to the
  Opportunity and leaves nothing in its change history.

  `OpportunityDetail` (`GET /api/v1/admin/crm/opportunities/:id`, and every answer that carries the
  Opportunity) gains three members: `noteCount`, `attachmentCount` and `unreadMessageCount`. One new
  route, `POST /api/v1/admin/crm/opportunities/:id/messages/read` with `{ throughMessageId }`, gated
  `crm:read`, answers `{ unreadMessageCount }`. `upcomingEventCount` is unchanged.

  One migration, `20261009T163307_crm_opportunity_message_reads`, creates
  `crm_opportunity_message_reads` and `crm_message_read_baselines`. It records the instant it ran, and
  messages written before it are unread for nobody — so an upgrade does not hand every administrator
  every existing conversation to catch up on. No new permission and no new Setting.

### Patch Changes

- 0184be5: An e-mail that was only written to the server log is no longer reported as sent. On an instance
  with no `SMTP_URL` the console mailer logs the message and used to answer `{ status: 'sent' }`,
  and the transactional e-mail service answered a constant `sent` of its own, so every module that
  records or reports a delivery recorded one that did not happen.

  **Breaking for a consumer of the two port types — three unions gain a member:**

  - `EmailMailerSendOutcome` gains `{ status: 'logged' }`. The console mailer answers it instead of
    `sent`; the SMTP mailer and `InMemoryMailer` still answer `sent`.
  - `TransactionalSendOutcome` gains `{ status: 'logged' }`, and `TransactionalEmailSender.send`
    passes the transport's `logged` on. A transport's `suppressed` (an already accepted message id)
    is still answered as `sent`, as before.
  - `emailDeliveryStatusSchema` / `EmailDeliveryStatus` gain `'logged'`, and
    `invoiceEmailNotSentReasonSchema` / `InvoiceEmailNotSentReason` gain `'logged'`.

  What to do: code with an exhaustive `switch` over one of these unions, or that passes
  `outcome.status` into a closed union of its own, stops compiling until it handles `logged`; code
  that reads `outcome.reason` after `outcome.status !== 'sent'` must narrow to
  `outcome.status === 'suppressed'` first, because `logged` carries no reason. Code that compares
  with `=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
  failure and there is nothing to retry: the same call would log the message again. An own
  implementation of `EmailMailerPort` or `TransactionalEmailSender` needs no change.

  What changes on an instance without a mail server:

  - `email_deliveries` rows are written with `status = 'logged'` instead of `'sent'`. The column is
    a plain `varchar(16)`, so there is no migration; rows written earlier keep `sent`.
  - The order, return, payment-status, shipment and invoice e-mail results answer
    `{ sent: false, reason: 'logged' }`, each with its usual "was not sent" log line. Issuing an
    invoice or re-sending its e-mail from the Admin UI says the e-mail was not sent because no mail
    server is configured, in English and Polish (`invoices.emailNotSent.logged`).
  - A CRM Event reminder is recorded as delivered to the bell alone — or as undeliverable when the
    bell is unavailable too — instead of "bell and e-mail".
  - `POST /api/v1/organizations/register` answers `emailVerificationSent: false` when the
    verification e-mail went through the in-code builder and was only logged.

  No setting, permission or migration changes.

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

- 34fe84f: A scheduled tick that finds nothing to do no longer writes a `tenant.escape_hatch` audit row. Four
  repeating jobs entered a system scope on every tick, and each entry is one row in
  `audit_log_entries` because ticks are further apart than the audit writer's ten-second aggregation
  window: the order follow-up sweep and the CRM event reminders (every 60 seconds, 1,440 rows a day
  each), the product feed stale-claim reaper and the price list status sweep (every 5 minutes, 288 a
  day each) — on an instance where none of them did anything.

  Each now asks first whether a pass would do anything, with a statement that runs outside any scope
  and returns one boolean and nothing else, and enters the system scope only when the answer is yes.
  A tick with work is recorded exactly as before. A question that fails counts as yes, so a failing
  probe can cost an audit row and never save one. Every probe goes through one helper,
  `anyRowExists` (`services/scheduled-work-probe.ts`, an identical file in each of the four modules),
  which builds the `select exists(…)` itself and returns a boolean, so a probe has no select list to
  widen. In `mod-orders`, `mod-crm` and `mod-product-feeds` the probe and the pass read the same
  statement of each condition, so the question cannot become narrower than the work. The rule is written down in
  `docs/docs/architecture/tenant-scoping.md` § _A scheduled tick with nothing to do enters no scope_.

  Not changed: the rows a process writes while it starts (`boot: …`), and the search reindex timer,
  which reads a setting before it can know whether it has work.

  For code that builds these consumers itself — inside 0.x, and nothing in the published surface of
  `@endora-commerce/platform` moves:

  - `mod-orders`: `TransitionEffectSweepDeps.effects` also needs `hasSweepWork`; new
    `OrderTransitionEffectService.hasSweepWork()` and `runTransitionEffectSweepTick()`.
  - `mod-crm`: `startEventReminders()` also takes `isPresent` and `hasWork`; new
    `EventReminderService.hasSweepWork()` and `runEventReminderJob()`.
  - `mod-product-feeds`: `createFeedReaperWorker(redis, hasWork, processor)` takes the question as its
    second argument; new `FeedRunReaperService.hasClaimedRuns()`, `runFeedReaperJob()` and
    `runFeedRunReaperTick()`.
  - `mod-price-lists`: new `PriceListStatusWorker.hasDueTransitions()` and `statusSweepTick()`.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/email-components@0.105.0

## 0.104.0

### Minor Changes

- d5ab69f: An operator chooses which fields a card on the Opportunity board shows, and the board is
  filtered by the fields its cards show. Additive: an instance nobody configures shows the card
  it showed before.

  **`@endora-commerce/mod-crm`.** A new Setting, `crm.board_card_fields` — a JSON array of field
  references, platform-wide, defaulting to the card as it was (`builtin:number`,
  `builtin:organization`, `builtin:value`, `builtin:assignee`, `builtin:tags`). It is edited in
  the new _Board card_ section of **CRM → Workflow**, which the board links to for a holder of
  `crm:configure`. A field is `builtin:<key>` or `custom:<definition key>`; a custom field
  whose definition is deleted drops out of the cards, the filters and the section without an
  error. At most six fields are shown, the title besides.

  - `GET /api/v1/admin/crm/board/card-fields` (`crm:read`) answers `{ fields, available,
maxFields }`; `PUT` on the same path (`crm:configure`) takes `{ fields: string[] }` and
    answers the same.
  - `GET /api/v1/admin/crm/board` answers `cardFields` beside `columns`, and every card carries
    `cardValues` — the values of the chosen fields a summary does not already hold, keyed by
    reference, and of no other field.
  - `GET /api/v1/admin/crm/board` and `GET /api/v1/admin/crm/opportunities` accept
    `fieldFilters`, a URL-encoded JSON object of operators per field reference (`contains`,
    `in`, `is`, `min`, `max`, `from`, `to`). A reference that is not on the card is ignored. The
    list also accepts `cardValues=true`.
  - The board's filters are now carried in its address (`/crm/board?assignee=me&f.custom:lead_source.in=referral`),
    so a filtered board can be reloaded and shared.

  The module now resolves two more ports, both of owners it already depends on:
  `customFieldDefinitionReadPort` (`custom_fields`) and `settingsAdminService` (`settings`).

  **`@endora-commerce/contracts`.** New exports: `OPPORTUNITY_BOARD_CARD_MAX_FIELDS`,
  `OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS`, `OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS`,
  `opportunityBoardFieldRefSchema`, `opportunityBoardFieldKindSchema`,
  `OpportunityBoardCardFieldSchema`, `SetOpportunityBoardCardFieldsRequestSchema`,
  `OpportunityBoardCardConfigSchema` (and its response envelope), `OpportunityFieldFilterSchema`,
  `OpportunityFieldFiltersSchema` and their inferred types. `OpportunityBoardSchema` gains the
  required member `cardFields`; `OpportunitySummarySchema` gains the optional `cardValues`;
  `OpportunityListQuerySchema` and `OpportunityBoardQuerySchema` gain the optional `fieldFilters`
  (parsed from its JSON text) and the list query the optional `cardValues`.

- eb04e42: Events on a Sales Opportunity, their reminders, and a CRM Calendar (User Stories 21 and 22).
  The module's page — `docs/crm.md`, sections _Events and reminders_ and _The calendar_ — is the
  full description; this is what an upgrader and an integrator need.

  **What installing this version does.**

  - **One new table, `crm_opportunity_events`** — the module's fourteenth, created by its fourth
    migration (`20261008T135701_crm_opportunity_events`). Run the migrations. An Event belongs to
    one Opportunity, is deleted with it, and carries no organization of its own.
  - **One new hard dependency: `transactional_emails`**, beside the existing ones. It owns the
    sender the reminder e-mail goes out through and the registry its default subject and body are
    pushed into. That module cannot be switched off, so the edge holds no operator's switch.
    `admin_notifications` stays a dependency the module degrades without; `auth`, already a
    dependency, now also answers whether a reminder's recipient is online
    (`AuthSessionReadPort.lastSeenByAdminUser`, new in this release).
  - **A second queue consumer**, on the queue `crm-event-reminders`: a scheduler that fires every
    60 seconds and a worker that reads the due reminders from the table. It needs the worker
    process the value recalculation already needs; an instance that runs none delivers no
    reminder. Nothing but the clock is kept in Redis.
  - **One transactional e-mail, `crm_event_reminder`** ("Event reminder", group `crm`), with
    defaults in `en-US` and `pl-PL` and the variables `event.name`, `event.when` and
    `opportunity.number`. An operator edits it or switches it off on the Transactional Emails
    screen.
  - **No new permission, setting, error code or environment input.** Reading Events and the
    Calendar needs `crm:read`; adding, editing and deleting an Event needs `crm:write`.

  **Five routes**, under `/api/v1/admin/crm`, with the shapes `@endora-commerce/contracts`
  publishes in this release:

  - `GET /opportunities/:id/events` (`crm:read`), `POST /opportunities/:id/events`,
    `PATCH` and `DELETE /opportunities/:id/events/:eventId` (`crm:write`). An Event is a name, an
    optional plain-text description, **one day** — a start and an end on it, or all day — the IANA
    `timeZone` it was planned in, and an optional reminder time. Any holder of `crm:write` who can
    see the Opportunity edits and deletes any of its Events. An Opportunity the caller may not see
    answers 404 `CRM_OPPORTUNITY_NOT_FOUND`; a well-formed Event the rules refuse answers 422
    `VALIDATION_FAILED` with `details.field` and `details.rule`. Each write is an entry of the
    Opportunity's change history (`crm.opportunity.event_add`, `.event_update`, `.event_remove`)
    that carries the name and the times and never the description's text.
  - `GET /calendar/events?from=&to=&scope=` (`crm:read`): the Events of **open** Opportunities
    the caller may see, over at most 45 days, at most 500 of them (`meta.truncated`). The scope
    is the server's decision: a caller who may see every organization gets `all` and may ask for
    `mine`; a caller restricted to a set of organizations is always answered with `mine` — the
    Opportunities assigned to them.
  - `GET /opportunities/:id` now counts the Events that have not ended, in `upcomingEventCount`.

  **Reminders.** A reminder goes, when it is due, to the person the Opportunity is assigned to at
  that moment; failing that — nobody assigned, or an assignee who does not qualify — to the person
  who added the Event; failing both, to nobody (`no_recipient`). To qualify, a person must be an
  active administrator, hold `crm:read`, and reach the Opportunity's Organization — the same three
  tests for both. It is always written to the notification bell, and sent as an e-mail as well
  when the recipient has made no request to the Admin UI in the last five minutes, or when
  `admin_notifications` is switched off. It is delivered at most once; while its Opportunity is
  closed or the module is switched off it waits; found more than 24 hours late it is not sent and
  is reported as `missed`.

  - **How it says when.** `event.when` of the e-mail and the `when` param of the bell entry are
    worded for the one recipient, in the language of their Admin UI and in the Event's own zone:
    `October 8, 2026, 6:42 PM (Europe/Warsaw)`, `8 października 2026, 18:42 (Europe/Warsaw)`; the
    date alone for an all-day Event.
  - **The name, on one line.** A line break in an Event's name is said as a space, in the bell
    sentence and in the subject of the e-mail. The bell stores a title of at most 255 characters,
    so for a very long name the stored English sentence is cut to fit; the translated sentence
    the reader is shown keeps the name whole.
  - **An Event deleted, or a reminder removed or moved, is not reminded of** — also when the
    sweep had already claimed it. `interrupted` is reported only for a reminder whose sending
    process died before recording the result; it is not sent again.

  Three things an operator should know before relying on it:

  - **The reminder e-mail carries no link.** It names the Opportunity by its number. An absolute
    link needs the address of the instance's Admin UI, which this module does not read; the bell
    entry links to the Opportunity.
  - **With no SMTP connection configured, the e-mail is written to the server's log and reported
    as sent**, so the Event shows "sent — notification bell and e-mail" for a message that reached
    no mailbox. The bell entry is unaffected.
  - **A reassignment moves every Event and every pending reminder** to the new assignee, with no
    row written: an Event holds no assignee.

  **In the Admin UI.**

  - **A Calendar screen**, `/crm/calendar` (`crm:read`), in the CRM group of the sidebar between
    _Board_ and _Analytics_, and a fifth command-palette action, `open-crm-calendar`. Four views —
    **Month**, **Week**, **Day** and **Agenda** — with _Today_, _Previous_ / _Next_ and _Go to
    date_; every Event is a link to its Opportunity. The view, the date and _Mine / All_ are in the
    address: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`. _Mine / All_ is drawn
    from what the server says the reader may ask for. Under 640 px the Calendar is the Agenda. The
    screen holds no write.
  - **An "Events" tab** on the Opportunity screen, third after _Links_, its label counting the
    Events that have not ended: the list — upcoming, then past — with what became of each reminder
    in words, a calendar of that Opportunity alone, and, for a holder of `crm:write`, adding,
    editing and deleting. The dialog's reminder checkbox reads _Set a reminder_ / _Ustaw
    przypomnienie_, and its hint says who is reminded. `/crm/opportunities/:id?tab=events&event=<id>` — what a reminder and a
    Calendar entry link to — marks that Event. A closed Opportunity keeps the tab and says that its
    Events are off the Calendar and its reminders held.
  - Times are shown in the browser's time zone, which the screen names, and written the way the
    language of the Admin UI writes them; the week starts on Monday in both languages.
  - Bundle keys: `calendar.*`, `events.*`, `opportunity.tabs.events`, `nav.calendar.label`,
    `actions.openCrmCalendar.*`, `notifications.eventReminder*`, three
    `auditLog.crm.opportunity.event_*` labels and five `history.field.*` labels are new in English
    and Polish.

  No third-party runtime dependency is added: the calendar is drawn by this package with `Date`
  and `Intl`. The package gains one peer dependency on a sibling,
  `@endora-commerce/email-components`, for the default body of the reminder e-mail.

  **Not in this release:** Events over several days and repeating Events; dragging on the Calendar
  or creating an Event from it; kinds, colours and participants; synchronisation with an external
  calendar; Events in webhooks, analytics, import or export.

  For an overlay that mounts this module's components: `OPPORTUNITY_TABS` has a seventh member,
  `events`, at index 2. Not part of the package's `exports`.

- ce0471f: A new module package, `@endora-commerce/mod-crm` (module id `crm`): sales opportunities with a
  configurable status workflow that linked orders follow. Backend and Admin UI. This is the
  module's first release.

  **What installing it does.** Thirteen `crm_`-prefixed tables and a default workflow of six
  statuses (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) arrive with the next
  migration run — three migrations. An instance that does not install it is unaffected. The module
  is optional: `crm.enabled`, on by default, switched on `/platform/modules`; while it is off
  every route answers `503 MODULE_DISABLED`, its screens, panels, permissions and settings are
  withdrawn, and nothing is deleted. It depends on `orders`, `organizations`, `sales_channels`,
  `catalog`, `assets_library`, `custom_fields`, `audit_logs` and the platform's account and
  settings modules, and degrades without `quote_requests`, `admin_notifications` and `webhooks`. One queue consumer,
  `crm-value-recalculation`. Peers: `fastify`, `@fastify/multipart`, MikroORM, `bullmq`,
  `ioredis`, `zod`, and — optional, for the admin layer only — `@endora-commerce/admin-kit`,
  `react`, `react-router-dom`, `lucide-react`. Its own demo data is three tags (`Key account`,
  `Upsell`, `Tender`); the demo sales pipeline that carries them is a step of
  `@endora-commerce/demo-composition`. `./backend` also exports `nextOpportunityNumber(em)`, the
  next `OPP-…` number from the module's sequence, for that step.

  **Permissions**, none granted to any role automatically: `crm:read`, `crm:write`,
  `crm:configure`, `crm:analytics`. `crm:read` advises `orders:read` and `custom_fields:read`.
  What another module owns is shown to somebody who may read it there: a linked or mentioned
  order needs `orders:read`, a quote request `rfqs:handle`, a mentioned product `catalog:read`;
  without it the document is listed as unavailable and nothing of it is shown.

  **The API**, all under `/api/v1/admin/crm`, tenant-scoped throughout (an opportunity of an
  organization the caller may not see answers `404 CRM_OPPORTUNITY_NOT_FOUND`):

  - **Workflow** — `GET /workflow`; `POST|PATCH|DELETE /statuses`; `PUT /transitions`;
    `PUT /order-status-mappings` (both directions); `PUT /value-counting-statuses` (answers 202
    and recalculates in the background). A change that would break the workflow answers
    `422 CRM_WORKFLOW_INVALID` naming the rule in `details.rule`.
  - **Opportunities** — list (search, filters by state, status, organization, assignee, tags,
    sales channel, creation date; sorting; cursor paging), create, read, `PATCH` under
    `If-Match` (409 for a stale version, 400 for a header that is not one), delete
    (`crm:configure`), `POST …/transition`, `POST …/assign`, `PUT …/tags`.
  - **Linked documents** — `POST|PATCH|DELETE …/links` for orders and quote requests. A document
    belongs to at most one opportunity, of its own organization.
    `GET /documents/:kind/:id/opportunity` answers the opportunity a document is linked to.
  - **Orders follow, and lead.** A move asks every linked order that follows the opportunity to
    enter the mapped order status, through the Orders module's own transition rules, after the
    opportunity's change has committed. A refusal is not an error: the response is 200, the
    opportunity has moved, and each order's outcome is in `propagation`, addressed afterwards by
    `…/propagations/:id/retry` and `…/dismiss`. In the other direction a linked order reaching
    a mapped status moves its opportunity through the opportunity's own workflow; a closed
    opportunity is never reopened, and the two directions do not loop.
  - **Value** — entered by hand, or computed from linked orders (gross total) and quote requests
    (net sum of lines) in a counting status; one currency, nothing converted, documents left out
    listed in `excludedDocuments`.
  - **Tags** (`/tags`), **notes and internal messages** (`…/comments`: a note is its author's to
    edit or delete, a message is immutable), **attachments** (`…/attachments/upload` under
    `crm:write` alone, stored in the media library as a private file, at most 25 MB, active
    content refused; attaching an existing library file by id also needs `assets.read`).
  - **Change history** — `GET …/history`, read from the platform's audit trail under `crm:read`,
    reaching back 499 entries and answering `truncated: true` on its last page when there are more;
    the text of a note or a message is never in it, and the tab shows every audited value in
    words — custom field values under the fields' own labels, an order status by name to a
    reader holding `orders:read`.
  - **References** — `[[product:<uuid>]]`, `[[order:<uuid>]]` and `[[admin_user:<uuid>]]` in a
    description, note or message are resolved into `references` beside the text — and beside a
    description in the change history. A mentioned person is named and never linked.
  - **Mentions** — in the Admin UI, typing `@`, `@@` or `@@@` in those fields opens a search
    of people, the organization's orders or products at the caret and inserts the choice. The
    field shows every reference by its name while it is being written or edited, never the
    token; what is stored and sent is the token text, unchanged. A person newly mentioned in a
    saved text gets one bell entry, `crm.opportunity.mention`, naming the opportunity by number
    and the author by name; never the author themself, nobody without `crm:read`, nobody who
    cannot see the organization.
  - **Bell entries in the reader's language** — the three kinds the module records
    (`crm.opportunity.assigned`, `crm.opportunity.message`, `crm.opportunity.mention`) carry a
    `titleMessage` in the `crm` bundle (`notifications.*.title`, English and Polish) beside the
    English `title`, so the Admin UI shows each reader their own language and falls back to the
    English sentence while the module is switched off. The params are the opportunity's number
    and, for a mention, the author's name — nothing the sentence does not already say.
  - **Board** — `GET /board`: a column per status with count, value totals per currency and the
    first cards.
  - **Analytics** (`crm:analytics`) — five live reads under `/analytics/`: handling time, time
    in status, rep effectiveness, top opportunities, average value. Per currency, UTC.
  - **Lookups** — `/lookups/organizations`, `/sales-channels`, `/assignees`, `/contacts`,
    `/mentionable`, `/quote-requests`, so the module's pickers need no permission of the modules that own those
    rows.

  **Automatic creation**, both off by default: `crm.auto_create_from_orders` (per sales channel)
  and `crm.auto_create_from_quote_requests`. A document created from within an opportunity — the
  _Create order_ and _Create quote request_ buttons, carried as an `origin` on the owner's create
  request — is linked to that opportunity and gets none of its own.

  **An order placed from a linked quote request joins the opportunity by itself**
  (`linkSource: "quote_conversion"`), whether the opportunity is open or closed, and such a pair
  is counted once in a computed value — the order's figure, not the two added. It relies on the
  order recording the quote request it was placed from, which `@endora-commerce/mod-orders` does
  from the same release.

  **The Admin UI** (`./admin`, `./tailwind.css`): a "CRM" sidebar section with _Opportunities_,
  _Board_, _Analytics_, _Tags_ and _Workflow_; the create screen and the opportunity's own screen
  with _Overview_, _Notes_, _Messages_, _Attachments_ and _Change history_; four command-palette
  actions (`open-opportunities`, `new-opportunity`, `open-opportunity-board`,
  `open-crm-analytics`); and three panels contributed to other modules' screens — _Open
  opportunities_ on an organization, _Linked opportunity_ on an order and on a quote request.
  The board moves a card by dragging (mouse, touch, keyboard) or from the card's "Move to…"
  menu. English and Polish.

  **For other modules.** Events: `crm.opportunity.created.v1`, `…status_changed.v1`,
  `…closed.v1` (these three are also offered as outbound webhooks), `…assigned.v1`,
  `…document_linked.v1`, and per transition `crm.opportunity.status.from_<x>_to_<y>.before`,
  `…from_<x>.before`, `…from_<x>_to_<y>.after`, `…to_<y>.after`. Container names:
  `opportunityReadPort`, `opportunityTransitionPort` (both fail closed while the module is off)
  and `opportunityTransitionGuardRegistry`, into which a module pushes a guard that may refuse a
  move by throwing `OpportunityTransitionVetoError`. The module contributes to the registries of
  `sales_channels` (attribution), `assets_library` (an attached file cannot be deleted from the
  library), `audit_logs` (recent activity names an opportunity), `custom_fields` (the
  `opportunity` host type) and `webhooks`.

  The module's documentation page, `docs/crm.md`, describes all of it for an operator and for a
  developer.

### Patch Changes

- bcd577c: The Sales Opportunity screen is laid out anew: a header and, under it, a stage bar and tabs
  beside a card of facts. Nothing about the API changes, and no action the screen had is gone.

  - **Stage bar.** It names the current status and shows only the statuses the workflow allows a
    move to from it — the Opportunity's own `allowedTransitions` — sorted into **Back** (an earlier
    status in the operator's order, and reopening) and **Forward** (a later status, and every
    closing one). It lists no other status, marks none as completed and counts no stage: the
    workflow is a graph. For a holder of `crm:write` each move is a button that performs the same
    `POST …/transition`, with the same optional reason, as the status buttons it replaces; a
    reader sees the moves as text. `GET /api/v1/admin/crm/workflow` (`crm:read`) is read only to
    order two open statuses; when that read fails every move is still offered, the ones it could
    not place under a plain heading.
  - **A "Links" tab** (PL: "Powiązania") now holds _Linked orders_ and _Linked quote requests_,
    with the number of linked documents on its label. They are no longer on _Overview_.
  - **The selected tab is in the address**: `/crm/opportunities/:id?tab=links|notes|messages|attachments|history`.
    A bare address opens _Overview_, as before. The return address the module hands the Order and
    Quote Request create screens (`?created=…`) opens _Links_.
  - **A card of facts** in the right column, from the header down beside the stage bar and the
    tabs — value and deadline, customer and assignee, classification, record — replaces the
    _Details_ list of _Overview_. On a narrow screen it comes after the stage bar and before the
    tabs. The value's mode, the
    assignee and the tags are still changed in place; everything else through **Edit**, which moved
    to the header.
  - What became of the linked Orders after a status change is shown under the stage bar on every
    tab.
  - Bundle keys: `opportunity.stage.*`, `opportunity.facts.*`, `opportunity.tabs.links`,
    `opportunity.tabs.label`, `opportunity.field.number`, `opportunity.field.closed` and
    `opportunity.description.empty*` are new in English and Polish; `opportunity.detail.subtitle`,
    `opportunity.status.current` and `opportunity.status.moveTo` are removed.

  For an overlay that mounts this module's components: `components/StatusControl` is replaced by
  `components/StageBar` (same props), and `OpportunityTabProps` gains `orderStatuses`, `editing`
  and `onEditingChange`. Neither is part of the package's `exports`.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/email-components@0.104.0
