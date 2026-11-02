# @endora-commerce/mod-custom-fields

## 0.109.0

### Minor Changes

- 2aa2c9b: _Project_ is a record type of Custom Fields: an operator defines fields on Projects on
  `/custom-fields` as on Opportunities, and the Projects module validates, stores and shows them.

  **`@endora-commerce/mod-custom-fields`**:

  - New entity type `project` (_Project_ / _Projekt_), owned by the `projects` module: offered on
    the entity-types listing, and its definitions created, changed or deleted, only while Projects
    is on — while it is off the type is absent and a definition write answers 409
    `CUSTOM_FIELD_HOST_MANAGED`, as for the other owned types. Definitions and stored values are
    kept and served again when Projects is back.
  - A Project definition may be marked as a list filter; no carry targets.
  - The values live in `projects.custom_field_values`; the definition-change guards and the
    list-filter condition read that column.

  **`@endora-commerce/contracts`**:

  - `supportedEntityTypeSchema` gains `'project'`. A consumer that switches exhaustively over
    `SupportedEntityType`, or holds a `Record<SupportedEntityType, …>`, gets a compile error until
    it handles the new member.

- 55864a1: Tasks can carry custom fields (`specs/165-task-management/` R-8): `task` is a host entity type owned by the `tasks` module, stored in `tasks.custom_field_values`, offered only while Tasks is on, and usable as a list filter.

### Patch Changes

- 24ef6aa: `/custom-fields`: a field is created in the same definition form that edits it, so it can be fully
  defined when it is created (#447).

  - **New field** opens the form in a dialog with the edit dialog's sections in the same order:
    definition (record type, type, key), labels, options, rules, behaviour. Create still sends one
    `POST` — now with a label per admin language and options carrying their own labels per language,
    the default flag and their order. The comma-separated options box is gone.
  - The label languages are the platform's supported languages, not a list written in the module.
  - **Who can see the value** is offered in the edit dialog as well; a change that breaks a carry asks
    first, as it does from the table.
  - Both views check before sending: the key's format, a default label, unique non-empty option values,
    a default label per option, and at most one default option on a _Single choice_ field (several are
    allowed on _Multiple choice_). A server refusal is said next to the field it concerns — a taken key
    at the key — never as a code.
  - The behaviour block's `row` layout and the `customFields.carry.helpGroup` key went with the inline
    create form; the create form's carry checkboxes now carry their own help lines, as the editor's do.

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

## 0.108.0

### Minor Changes

- 1846a38: An existing custom-field definition is editable on `/custom-fields`.

  - **Edit dialog.** Each row has an _Edit_ action that opens a dialog showing the key, the entity
    type and the value type as fixed text. The dialog edits the default, English and Polish
    labels, _Required_ (switching it on explains that existing records keep their values and are
    asked for one at their next custom-field edit) and _Use as list filter_ where the entity type
    offers it. _Save_ sends only the members that changed and nothing when nothing did; a refusal
    keeps the dialog open with the server's sentence.
  - **Options** of a select or multiselect field are edited in the same dialog, one action at a
    time: relabel, mark as default, move up or down (announced to assistive technology), remove
    after an in-dialog confirmation (an option still in use is refused at its row), and add. An
    option's stored value never changes.
  - **The table** shows a _List filter_ column, and the create form offers _Use as list filter_
    for the entity types that have the option.
  - **Translated.** Every label, header, value-type name and placeholder on the page is read from
    the module's bundle, in English and Polish.
  - **Write controls follow `custom_fields:write`.** Create, edit, delete and the audience select
    are offered only to an operator holding it; a reader sees the table.
  - **Edits keep your place.** An option's labels save when you leave the field or press Enter, with a
    _Saved_ confirmation at the row. Its inputs stay usable while a save is on its way, a save that
    lands does not overwrite what you are still typing, and a reorder returns focus to the moved
    option. Option changes apply at once, and the dialog says so: after one, _Cancel_ reads _Close_.
  - **An option in use** is named by its label in a sentence of the editor's own, never by the
    server's message or code.
  - **Deleting a field** asks in place first. The table shows a loading line, an empty state with
    one action, and cards on a narrow screen. Its _List filter_ column says _Yes_ or _No_.

- b124db8: **Behaviour change for API clients.** Three 409 refusals on the custom-field definition routes no longer share `CUSTOM_FIELD_DEFINITION_INVALID` and an English message:

  - removing an option records still hold answers `CUSTOM_FIELD_OPTION_IN_USE`, with `details.value` and `details.label`;
  - changing a definition's value type while records hold values answers `CUSTOM_FIELD_VALUE_TYPE_LOCKED`, with `details.key`;
  - creating a customer-visible definition over values a deleted field left answers `CUSTOM_FIELD_STORED_VALUES_EXIST`, with `details.key`.

  Each has a sentence in English and Polish naming what it refuses.

  **An option patch changes only what it names.** `PATCH /api/v1/admin/custom-fields/definitions/:id/options/:optionId` used to fill every member the request left out with its create default, so relabelling an option also cleared its translations, its default flag and its position; it now leaves them as they are, and still never changes the stored `value`. Its audit entry records the option's `label`, `labelDefault`, `isDefault` and `sortOrder` before and after, so a translation, a new default or a move is visible in the audit log rather than looking unchanged.

- 44c1615: **Behaviour change for API clients.** Quote Request custom-field definitions now follow the `quote_requests` module, as Opportunity definitions follow `crm`: while `quote_requests` is switched off, `quote_request` is left out of `GET /api/v1/admin/custom-fields/entity-types`, its definitions are not listed or served by id (404), and every definition and option write answers 409 `CUSTOM_FIELD_HOST_MANAGED`. Nothing is deleted; the definitions and the stored values return unchanged with the module.

  Definitions carry `listFilter`, saying whether the admin list of their entity type offers the field as a filter. It is settable on Order, Quote Request and Opportunity definitions; `listFilter: true` on any other entity type is refused with 422 `CUSTOM_FIELD_DEFINITION_INVALID`. Absent on create it is `false`, absent on update it is unchanged, and changing it is one audited write that never touches a record's stored values. Each `entity-types` item carries `listFilter`, saying whether its definitions may be list filters.

  The admin custom-fields page no longer offers the Quote request type before the server has said it is offered.

- 3d1e47c: Publishes `customFieldListFilterPort`, the seam the admin lists of other modules use to filter on custom fields.

  - `listFilterable(entityType)` answers the fields a list offers: the served definitions of the type whose list-filter option is on, ordered, with their labels and options and nothing else.
  - `condition(entityType, filters)` turns a request's custom-field filters into one server-side condition over the entity's own table, every key and value bound. A filter on a field the list does not offer is refused with a failure naming every such key, which the hosts answer as 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`; more than 10 keys or 100 chosen values in total is refused before anything is read.
  - An operator that does not apply to the field's type (`contains` on a Yes/No field, a range on an options field) is refused as a validation failure rather than ignored, and so is an inverted range (a minimum above its maximum, a start date after its end) rather than answered with an empty list.
  - A Yes/No filter matches a stored _yes_ or _no_ only; a record without a value matches neither. A date range compares only a stored `YYYY-MM-DD` date and a number range only a stored number, so a value stored under an earlier type neither matches nor fails the list.

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

- 55d957b: Custom-field definitions can carry their values to Quote Requests, Orders and Sales Opportunities.

  - **Carry options on definitions.** A definition's `carryTo` names the entity types its values
    carry to when a record of such a type is created from, or joins, a record of the definition's
    own type. `GET /api/v1/admin/custom-fields/entity-types` serves `carryTargets` per type — the
    pairs the registry offers (Quote Request → Order and Opportunity, Order → Opportunity,
    Opportunity → Quote Request and Order), filtered to targets whose owner module is present.
    New column `custom_field_definitions.carry_to` (migration
    `Migration20261020T110920CustomFieldsDefinitionCarryTo`); every existing definition carries
    nothing, and turning an option on or off changes no stored value.
  - **Configuration refusal.** Turning a target on is judged once, in the definition Command:
    `422 CUSTOM_FIELD_CARRY_INCOMPATIBLE` with `details.code` `target_missing`,
    `value_type_mismatch`, `options_missing` (`details.missingOptionValues` as text,
    `details.missingOptionValueList` as a list), `audience_mismatch`, `pair_unsupported` or
    `target_unavailable`, and a sentence in the request's language. A target already on is never
    judged again, so later changes to either field are allowed. The audit entries of
    `custom_fields.definition.*` carry `carryTo`.
  - **Retention while an owner is off.** A carry to a type whose module is switched off is not
    served and not offered, a save made meanwhile keeps it, and it is served again when the module
    returns.
  - **`customFieldCarryPort`** (`CustomFieldCarryPort` from `@endora-commerce/contracts`) computes
    which values carry into a target record's bag — empty target fields only, the value judged by
    the target definition — and writes nothing; the module owning the target persists the answer.
  - **`./ports`:** `CustomFieldDefinitionApplyApi.applyCreate` takes the new
    `CustomFieldDefinitionApplyCreateInput` (the create request with `carryTo` optional). A host
    names no carry target; one it named outside the registry's pairs is refused
    (`carry_incompatible`).

- 9a2d1f8: The `/custom-fields` screen turns value carry-over on and off, shows where values carry, and warns before a change that would stop a carry from working.

  **For an administrator.**

  - The create form and the definition editor offer one _Carry value to …_ checkbox per entity type
    the definition's type can carry to — none for a type that carries nowhere (Category, Product,
    Customer, Organization), and never _Quote request_ for an Order field. The editor's _Save_ sends
    the carry list only when it changed.
  - A refused carry option keeps the form or the editor open with a sentence that names what is
    wrong — the missing field and its type, the two value types, the missing option values, or the
    audience rule — in the operator's language. The sentence stands under the carry options it is
    about and takes the focus; the editor also says beside _Save_ that nothing was saved.
  - A new _Carries to_ column lists each target as a chip. A chip whose same-key target no longer
    fits is marked _Incompatible_, with its reason as text; the mark goes as soon as the definitions
    are re-read compatible.
  - When the definitions of every type cannot be read, the table says _Carry checks are
    unavailable_ with a _Retry_ button instead of showing no mark and asking nothing in silence.
  - Removing or adding an option, changing a field's audience in the table and deleting a field ask
    first when the change would break an enabled carry, naming every field on the other side.
    _Cancel_ sends nothing; the proceed button, named after the action — _Remove option anyway_,
    _Add option anyway_, _Change audience anyway_, _Delete field anyway_ — makes the change exactly
    as before. A change that breaks nothing asks nothing.

  **For a module author.** `DefinitionBehaviourFields` takes an optional `value.carryTo` (answered
  back by `onChange`), an optional `entityTypes`, and an optional `carryError` with its `carryErrorRef`; `DefinitionEditorDialog` takes optional
  `entityTypes` and `definitions`; `DefinitionOptionsEditor` takes an optional `carryGuard`. All
  additive.

### Patch Changes

- ee26beb: Documentation for custom-field list filters, in English and Polish.

  - `@endora-commerce/mod-custom-fields` ships its first documentation page: the records that take
    custom fields, creating and editing a field and the limits of editing, the _Use as list
    filter_ option, how each type filters, and the list APIs.
  - The `orders`, `quote_requests` and `crm` pages describe the custom-field filters on their admin
    lists. The `quote_requests` page also says that its fields follow the module's activation. The
    `crm` page explains how the Opportunities list's filters differ from the board's card-field
    filters.

- 6f1e0ec: Custom-field carry review fixes.

  - **`@endora-commerce/contracts`** — every string of `customFieldCarrySkipLabelSchema` is at most 200 characters (`CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX`, new export); a longer `labelDefault` or per-locale label is refused.
  - **`@endora-commerce/mod-custom-fields`** — the carry port cuts a skip's label snapshot to that limit, since a definition's per-locale labels are not capped, so every skip it plans parses.
  - **`@endora-commerce/mod-quote-requests`** — the Opportunity → Quote Request carry takes the request's row `for update` and plans over the bag it re-reads under the lock, so an administrator's concurrent edit is never overwritten. A carry that fills a field still raises the request's `version`.

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

## 0.107.0

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

## 0.105.0

### Minor Changes

- 31a2c0b: A custom field declares who reads its values, and customer-facing order and quote-request replies
  stop naming administrators. **Three breaking changes**, all described below.

  **Every custom-field definition has an `audience`: `customer` or `internal`.** Until now a
  definition had none, and whatever an administrator stored on an order or a quote request was
  answered to the customer (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, the replies to placing
  and cancelling an order, `GET /api/v1/quote-requests/:id`) and to integrations
  (`/api/v1/external/orders`) as `customFieldValues`. An operator who modelled an internal note, a
  credit assessment or a risk flag as an order custom field was showing it to the buyer.

  - `internal` values are answered on admin routes only. `customer` values are also answered on
    the non-admin replies above. A stored value whose definition no longer exists is treated as
    internal. Admin replies are unchanged and carry every stored value.
  - **Existing definitions keep today's behaviour.** The migration
    `Migration20261010T090000CustomFieldsDefinitionAudience` adds
    `custom_field_definitions.audience` and sets every existing row to `customer`, so upgrading
    hides nothing. Review your definitions after upgrading and move to `internal` whatever was
    never meant to be shown.
  - **Breaking: a new definition is `internal` unless it says otherwise.**
    `POST /api/v1/admin/custom-fields/definitions` without `audience` used to create a field whose
    values the customer could read; it now creates one they cannot. Send `"audience": "customer"`
    to keep the old behaviour. `PATCH …/definitions/:id` accepts `audience` and leaves it alone
    when the key is absent. The same patch no longer resets a definition's `config` to `{}` when
    the body does not name it (`updateCustomFieldDefinitionSchema` carried the create default).
  - The definition screen (Custom Fields) shows the choice with an explanation, defaulting to
    internal, and lets the audience of an existing field be changed. Six keys join the module's
    `en` and `pl` bundles under `customFields.audience.*`.

  In `@endora-commerce/contracts`: new `customFieldAudienceSchema` / `CustomFieldAudience`;
  `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain a required `audience`;
  `createCustomFieldDefinitionSchema` defaults it to `internal`, so the inferred
  `CreateCustomFieldDefinitionRequest` — the input of `CustomFieldDefinitionApplyApi.applyCreate` —
  now requires it; and `CustomFieldValuePort` gains
  `projectForCustomer(entityType, bag)`, which returns only the keys a non-administrator may read.
  An implementation of that port must add the method. A host module that answers custom-field
  values to a non-administrator calls it in its serialiser; `mod-orders` and `mod-quote-requests`
  do. `mod-catalog` creates product attributes with `audience: 'customer'`; the audience is not
  consulted for product attributes, whose storefront visibility stays with the catalog's own flags.

  **Breaking: buyer-facing and external order replies no longer carry
  `placedOnBehalfByAdminUserId`.** It was the UUID of the administrator who placed the order for
  the customer, answered to the customer and to API-key callers. Those replies now carry
  `placedOnBehalf: boolean` instead. Admin order replies carry both. In `orderSchema`,
  `placedOnBehalf` is a new required key and `placedOnBehalfByAdminUserId` becomes optional
  (present on admin replies only). Replace `order.placedOnBehalfByAdminUserId !== null` with
  `order.placedOnBehalf` in a storefront or an integration; the reference storefront did not read
  the field.

  **Breaking: customer-facing replies carry no administrator identifier at all.** The same rule,
  applied to the other places it was broken:

  - Quote-request replies to a customer (`GET /api/v1/quote-requests/:id` and the replies to
    creating, patching, resubmitting a quote and to accepting or rejecting a revision) no longer
    carry `createdByAdminUserId` and `assignedAdminUserId`, and their `events[]` no longer carry
    `actorAdminUserId` (it was already always `null` there; the key is now absent).
    `actorRoleLabel` still says who acted.
  - Order-comment replies to a customer (`GET` and `POST /api/v1/orders/:id/comments`) no longer
    carry `authorAdminUserId`. A comment whose `authorCustomerAccountId` is `null` was written by
    staff.

  Admin replies are unchanged. In `quoteRequestSchema`, `quoteRequestEventSchema` and
  `orderCommentSchema` those four keys become optional (present on admin replies only). No boolean
  replaces them: the reference storefront declared the fields and read none of them.

  **Re-creating a deleted field.** Deleting a definition keeps its stored values. A
  `POST …/definitions` with `audience: "customer"` for a key that still has stored values is now
  refused with `409 CUSTOM_FIELD_DEFINITION_INVALID`, because it would answer those old values to
  customers at once. Create the field as `internal`, then change its audience. Product attributes
  (created through the catalog) are not affected.

  The definitions cache no longer stores a list that was read before an invalidation and arrived
  after it. A change of audience still takes up to 5 seconds to reach an API process that missed
  the invalidation message; the docs page says so.

  In `mod-orders`, `serializeOrder` is replaced by `serializeOrderForAdmin` and
  `serializeOrderForCustomer` (internal to the module).

### Patch Changes

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

## 0.104.0

### Minor Changes

- 32775d5: A custom-field host type may name the module it belongs to, and `opportunity` is the first
  that does.

  `SupportedEntityMeta` gains an optional `ownerModuleId`. While that module is not effectively
  present, `GET /api/v1/admin/custom-fields/entity-types` omits the type, the definitions
  already stored for it are not served — `GET /definitions` leaves them out and
  `GET /definitions/:id` answers `404 CUSTOM_FIELD_NOT_FOUND` — and the definition and option
  mutation routes answer `409 CUSTOM_FIELD_HOST_MANAGED` for it. Definitions and stored values
  are kept, and are back when the owner is. Types that declare no owner — every type that
  existed before — answer exactly as they did.

  The registry gains the host type `opportunity`, owned by the `crm` module.

### Patch Changes

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

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.9.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- cbe6b7f: Two `EntityManager`-taking seams for renaming an attribute key after create, both additive and both run on the caller's transaction so a definition key and the values stored under it move together.
  - `@endora-commerce/mod-custom-fields/ports`: `CustomFieldDefinitionApplyApi.applyRenameKey(em, id, expectedKey, newKey)`, served by the existing `customFieldDefinitionService` registration. It is not an edit — `UpdateCustomFieldDefinitionRequest` still omits `key` — and it refuses a definition whose key is no longer `expectedKey` (`key_changed`), a key another definition of the same entity type holds (`duplicate_key`) and a key outside the grammar (`invalid_key`). It flushes before it returns, dispatches no command and publishes no invalidation: call `publishInvalidate` after your transaction commits. A test double implementing `CustomFieldDefinitionApplyApi` needs the new method.
  - `@endora-commerce/mod-catalog/ports` (new, type-only subpath): `CatalogAttributeValueKeyApi.renameValueKey(em, fromKey, toKey, { occupied })`, registered as `catalogAttributeValueKeyPort`. It moves the key in `products.attribute_values` and `product_value_overrides.attribute_key` and answers how many rows of each moved. `occupied` is required and decides what happens to data already stored under `toKey`, which it reads and locks first: `'refuse'` throws `target_occupied` with both counts before anything is written; `'displace'` removes those values and override rows — on every product holding them — and returns them in `displaced.values` / `displaced.overrides` before the key moves, so nothing is merged over and no unique index is hit. `name`, `description` and keys outside the attribute grammar are refused before any statement runs.

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.9.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.9.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- 034f190: Both modules declare `demo: false` — a decision recorded rather than a field filled in.

  The demo shop holds seven product-host custom-field definitions and about five hundred assets,
  and not one of them is either module's own demo data. A product attribute is a definition paired
  1:1 with a `catalog` extension row and written in one call; every demo asset is minted inside a
  loop over `catalog`'s products, with its filename and its generated image derived from the
  product it hangs off, and its id handed straight to one of `catalog`'s tables. Each is two
  modules' rows in one statement and belongs to whoever owns the instance.

  For `custom_fields` this also settles a question the feature's own artefacts left open, and
  settles it against the proposal: the definitions cannot be seeded here with the extension rows
  seeded by `catalog`, because `catalog` would then have to read `custom_field_definitions` to find
  the id its extension references, and a module's demo body may not read another module's table.

  Absent and `false` are different states, so this changes no behaviour: it says the modules owe
  nothing rather than leaving it undecided.

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- 27ca81d: `assets_library` and `custom_fields` ship their admin surfaces.

  **New `./admin` subpath on both packages.** `@endora-commerce/mod-assets-library` and
  `@endora-commerce/mod-custom-fields` each export `contributions` — an `AdminContributions`
  object — from `@endora-commerce/mod-<id>/admin`, and nothing else. Each declares one route
  and one sidebar entry; the route components are dynamic-import factories, so a consumer's
  bundler emits one chunk per screen. The routes are unchanged: `/assets-library` and
  `/custom-fields`, gated on `assets.read` and `custom_fields:read` respectively — the codes
  the hand-written host registrations carried.

  Four things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it. Both packages' `build` and `typecheck`
    scripts now run two `tsc` invocations.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of
    both**, and `react-router-dom` of `mod-custom-fields`. The kit is where every screen's
    design-system import resolves; `react` is peered rather than depended on so the
    application resolves one copy.
  - **Each package's `i18n/` bundle gains its own `nav.*.label`** — `nav.assetsLibrary.label`
    and `nav.customFields.label` — resolved in the module's own namespace instead of the
    shared `core` one. `appShell.nav.assetsLibrary` and `appShell.nav.customFields` are
    removed from `@endora-commerce/mod-i18n`'s bundle with the host rows that named them.
  - **`mod-custom-fields`' screen no longer reads the `core` namespace at all.** It rendered
    `customFields.title` and `customFields.description` out of the shared bundle beside four
    keys of its own; both were already written in this package's `i18n/{en,pl}.json`, so the
    shared reads were a second copy of two strings. `customFields.title` and
    `customFields.save` stay in `mod-i18n` because `@endora-commerce/admin-kit`'s
    `CustomFieldValuesPanel` renders them.

  **One repair inside `mod-assets-library`, and it is a deduplication a consumer can see.**
  `AssetDetailDrawer` carried a private `toAbsoluteAssetUrl` over its own
  `import.meta.env.VITE_API_BASE_URL` read with a `http://localhost:3001` fallback — a
  fourteenth copy of the function `@endora-commerce/admin-kit/lib` publishes. It takes the
  kit's now, which is the binding `LibraryPage` two files away was already taking. There is
  one implementation of it in the tree again.

  **Nothing is removed and no existing export changes shape**, so a consumer of either
  package's `./backend`, `./migrations`, `./ports` or root subpath is unaffected. Both
  modules declare `activation.nonDeactivatable`, so neither gains an operator-facing switch:
  what the new subpath adds is where the screens live, not whether they can be withdrawn.

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

### Patch Changes

- 3786732: Error-code ownership: the rest of Tier A is declared by the modules that own its nouns.

  `manifest.errorCodes` gains six codes on `@endora-commerce/mod-prompt-actions`
  (`ASSISTANT_*`, `PROMPT_*`), five on `@endora-commerce/mod-custom-fields` (`CUSTOM_FIELD_*`),
  two on `@endora-commerce/mod-customers` (`CUSTOMER_ADDRESS_NOT_FOUND`,
  `REGISTRATION_REQUIRES_ORGANIZATION`), two on `@endora-commerce/mod-shopping-lists`
  (`SHOPPING_LIST_*`), one on `@endora-commerce/mod-price-lists` (`PRICE_LIST_NOT_FOUND`) and one
  on `@endora-commerce/mod-transactional-emails` (`TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`);
  `@endora-commerce/mod-i18n` drops the same seventeen from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 3 of eight;
  D-121 tiers T1 and T2; `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes. No wire shape moves —
  `error.code` is unchanged — and no sentence is relocated: none of the seventeen had a
  translation in `en` or `pl` in any bundle. Writing one of those sentences is now a change to the
  owning module's own `i18n/{en,pl}.json` rather than to the platform's.

  `@endora-commerce/mod-shopping-lists` gains an `i18n` bundle it never had, declared as
  `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. It holds the two `SHOPPING_LIST_*`
  sentences in both languages, which is an operator- and buyer-visible improvement: a Polish
  reader refused a delete of the default or the last shopping list now reads Polish prose instead
  of the English the raise site carries.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/platform@0.7.0
