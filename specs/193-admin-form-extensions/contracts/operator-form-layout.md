# Contract: operator form layout (FR-090 – FR-100, D-300.6, R-21)

The operator layer is owned by `custom_fields`, which is non-deactivatable. It covers presentation
only and never changes what an API accepts.

## §1 Storage

The table is `custom_field_form_layout_overrides`. It is created by a `custom_fields` migration
scaffolded with `pnpm --filter backend run migration:new`, and has no number here. The entity is
`@GlobalEntity()`, from `@mikro-orm/decorators/legacy`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `form_id` | text not null | e.g. `organization.edit` |
| `field_key` | text not null | a core key, a family member (`attributeValues.color`) or a slot `<moduleId>.<key>` |
| `labels`, `helps`, `placeholders` | jsonb null | `{ "en": "…", "pl": "…" }`: every supported admin language, each at most 200 characters (`helps` at most 280) |
| `section`, `before`, `after` | text null | `position`; at most one of `before` and `after` |
| `hidden`, `read_only` | boolean not null default false | |
| `version` | integer not null default 0 | optimistic concurrency |
| `updated_at` | timestamptz not null | |

The unique key is (`form_id`, `field_key`). A row with nothing set is deleted rather than kept.

## §2 HTTP API (`custom_fields`, `routes.admin.ts`)

| Route | Gate | Body / response |
| --- | --- | --- |
| `GET /api/v1/admin/custom-fields/forms` | `custom_fields:read` | `{ forms: [{ id, fieldSet, ownerPresent, overrideCount }] }` |
| `GET /api/v1/admin/custom-fields/forms/:formId` | `custom_fields:read` | `FormLayoutDetailSchema`: per field, `core`, `code` (`{ module, origin, kinds, values }`) and `operator` (row or `null`); `accepts ∩ OPERATOR_KINDS`; `locks: [{ kind, reason: 'not-accepted' \| 'required' \| 'code-hidden' \| 'code-read-only' \| 'not-fillable' }]`; `status: 'active' \| 'owner-absent' \| 'orphaned' \| 'no-longer-accepted'` |
| `PUT /api/v1/admin/custom-fields/forms/:formId` | `custom_fields:forms` | `{ fields: [{ key, version, labels?, helps?, placeholders?, position?, hidden?, readOnly? }] }` (at most 200) → `custom_fields.form_layout.set` |
| `POST /api/v1/admin/custom-fields/forms/:formId/reset` | `custom_fields:forms` | `{ keys?: string[] }` (absent means all) → `custom_fields.form_layout.reset` |

A refusal is `422 FORM_LAYOUT_OVERRIDE_INVALID` with `details: [{ path: 'fields.<i>.<kind>', code }]`.
The codes are `override-not-accepted`, `hidden-required-field`, `required-not-fillable`,
`unknown-field`, `unknown-section`, `unknown-form`, `language-missing` and `too-long`. A stale
`version` answers `409 FORM_LAYOUT_VERSION_CONFLICT`. Both codes are declared by `custom_fields` and
translated in `pl` and `en`.

`OPERATOR_KINDS = ['label', 'help', 'placeholder', 'position', 'hidden', 'readOnly']`. Slot fields
admit `label`, `help`, `position` and `hidden`.

## §3 Layering (normative)

For each form, field and kind, the effective value is:

| Kind | Rule |
| --- | --- |
| `label`, `help`, `placeholder`, `position` | the operator's value if set; else deployment code (or a granted package); else core |
| `hidden` | core-required never; else true if code **or** the operator sets it (the operator cannot clear code's) |
| `readOnly` | true if code **or** the operator sets it |
| everything else | not settable by the operator |

- **Reset** deletes operator kinds only, so the field returns to the code value.
- **A position whose anchor is not in the form after code is applied.** The field falls back to the
  code or core position, and the detail response reports `position-fallback`.
- **Renamed keys** (FR-099). `custom_fields`' boot hook runs `custom_fields.form_layout.rekey`
  (system actor, one Command per affected form, idempotent) to rewrite rows that name a live alias.
  A row that names a removed key is `orphaned`. A row holding a kind that the field no longer
  accepts is `no-longer-accepted`. Both are ignored by the effective forms and can be deleted
  through `reset`.
- **Off-state** (FR-098). If the owner of a row's field set, or the rendering module of its form, is
  not effectively present, the row is ignored and its status is `owner-absent`. The row itself is
  kept.

## §4 Port and invalidation

```ts
// packages/contracts/src/admin-forms.ts
/** Container name: formLayoutOverrideSource */
export interface FormLayoutOverrideSource {
  /** Every row, as stored; the platform applies §3. */
  listAll(): Promise<readonly FormLayoutOverrideRow[]>;
}
export const FORM_LAYOUT_CHANGED_CHANNEL = 'b2b:form-layout:changed';
```

- **Cache.** `custom_fields` keeps an in-process cache of `listAll()` with a 60-second TTL.
- **Invalidation.** After each committed `set`, `reset` or `rekey`, the Command's caller awaits the
  invalidation. It drops the local cache, then publishes `{ formId }` on
  `FORM_LAYOUT_CHANGED_CHANNEL`. Each process, the publisher included, drops its cache, and
  `FormRegistry` bumps the generation for its effective-forms memo. This is the write-then-announce
  shape of `SalesChannelAccessCache` (D-93). A lost subscription leaves a presentation lag of at most
  the TTL.

## §5 Commands

| Action | Reversible | Audit before / after | Notes |
| --- | --- | --- | --- |
| `custom_fields.form_layout.set` | yes, per row; undo with a conflict report on `version` | rows before and after | runs §2's validation inside the Command |
| `custom_fields.form_layout.reset` | yes | rows before and `null` | |
| `custom_fields.form_layout.rekey` | no | `{ from, to }` keys only | system actor, run at boot |

No Command is hookable, because these Commands change configuration and do not write a domain
record.

## §6 Admin

- **Screen.** `packages/modules/custom_fields/src/admin/pages/FormLayoutPage.tsx` (the list) and
  `FormLayoutEditorPage.tsx` (one form). The editor shows a live preview made from
  `DeclaredFormSection` in read-only mode, the kit's reorder control for `position`, and per-language
  inputs for the text kinds. It uses one Save (`SaveSessionProvider`) and shows
  `SaveSessionSummary`, with *Reset to deployment value* or *Reset to core* per field and kind.
- **Copy.** It states that hiding and read-only do not restrict the API, and links to
  `admin-form-extensions.md#permissions`.
- **Wiring.** The palette action is `actions.openFormLayout` and the sidebar entry sits under
  *Platform*, beside *Custom fields*. All strings are in `custom_fields`' `en` and `pl` bundles.
- **Off-state.** Not applicable, because `custom_fields` is non-deactivatable. Rows of absent owners
  are listed per §3.
