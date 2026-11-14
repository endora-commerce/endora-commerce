# Contract: the one Save on the category, organization, customer and sales-channel editors

Owners: each host module's admin (`catalog`, `organizations`, `customers`, `sales_channels`) and each
participant's module (`price_lists`, `quick_order`, `quote_requests`). Shared behaviour:
`save-participation.md` and `product-editor-save-ui.md` §2 (summary) and §3 (guard). Decisions:
`research.md` R14–R21. Requirements: FR-050…FR-070.

## 1. Category editor (`packages/modules/catalog/src/admin/pages/CategoriesTree.tsx`)

| Item | Spec |
| --- | --- |
| Provider | `SaveSessionProvider resetKey={category.id} hostModule="catalog"` around the edit form |
| Host part | the existing category write, blocking; label `categories.save.hostPartLabel` ("Category") |
| Zone | `category.editor.after` mounted **above** the Save / Cancel row, props `{ categoryId, saveSession }` |
| Save | the existing *Save* button, count from host fields + `session.dirtyCount`, `session.run` on submit |
| Cancel | discards host fields and `session.discardAll()`; no dialog |
| Guard | selecting another category, leaving the page, browser Back → *Save / Discard / Stay* |
| Summary | `SaveSessionSummary` at the top of the form |
| Participant | `DisplayModeOverrideRow` (`price_lists`): key `display-mode`, label `displayModeRow.partLabel`; draft = mode; validate = contracts enum; save = existing `PUT …/display-mode-overrides/category/:id`; "saved" suffix and on-change write removed |

## 2. Organization detail (`packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx`) — OQ-9 = A

| Item | Spec |
| --- | --- |
| Provider | `SaveSessionProvider resetKey={org.id} hostModule="organizations"` |
| Save | `SaveSessionActions` in the page head (sticky bottom bar below 1024 px) |
| Host part | one `PATCH …/organizations/:id` with `expectedUpdatedAt`, blocking, gathering status, VAT status, order-confirmation e-mails, fulfilment strategy, restrictions and custom fields (`CustomFieldValuesPanel saveSession`); `VERSION_CONFLICT` → no participant written, reload discards all |
| Removed | save-on-change of status and VAT status, save-on-blur of e-mails, Save buttons of `FulfilmentStrategyPanel`, `RestrictionsPanel`, custom fields |
| Immediate (badge) | members (invite, add, role, edit, remove), hierarchy, moderation, VAT validation, sales channels |
| Zone | `organization.detail.after`, props `{ organizationId, saveSession }` |
| Participants | `DefaultPreferencesPanel` (`quick_order`, key `ordering-defaults`, validate = contracts preferences schema, save = existing `PUT`, Save button removed); `DisplayModeOverrideRow` (`price_lists`, key `display-mode`); negotiation panel (`quote_requests`, key `price-negotiation`, on-change write removed) |
| Read-only panels | `crm` opportunities, `projects` projects — unchanged |
| Guard | leaving the page, browser Back |

The member-edit and invite dialogs keep their own confirm buttons: a dialog is a modal action, not a
section of the page (they are immediate actions).

## 3. Customer detail (`packages/modules/customers/src/admin/pages/CustomerDetail.tsx`) — OQ-9 = A

| Item | Spec |
| --- | --- |
| Provider | `SaveSessionProvider resetKey={id} hostModule="customers"` |
| Save | `SaveSessionActions` in the page head |
| Host part | custom fields `PATCH …/customers/:id/custom-fields`, blocking |
| Immediate (badge) | block / unblock, password reset, MFA reset, impersonate, restore, delete, organization assignment, customer group, addresses |
| Zone | `customer.detail.after`, props `{ customerId, saveSession }` |
| Participants | `DefaultPreferencesPanel` (`ordering-defaults`), negotiation panel (`price-negotiation`) |

## 4. Sales-channel editor (`packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage.tsx`) — OQ-10 = A

| Item | Spec |
| --- | --- |
| Provider | `SaveSessionProvider resetKey={channel.id} hostModule="sales_channels"`, existing-channel branch only |
| Host part | `ChannelIdentityForm` submit, blocking |
| Zone | `sales_channel.editor.after`, props `{ channelId, saveSession }` |
| Participants | none today; `ChannelWarehouses` (`inventory`) stays immediate with the "Applies immediately" badge |
| Guard | leaving the page with identity-form changes (new: the form had none) |

## 5. i18n keys

- `catalog`: `categories.save.hostPartLabel`.
- `organizations`: `organizations.detail.save.hostPartLabel` ("Organization"), immediate-badge reuse.
- `customers`: `detail.save.hostPartLabel` ("Customer").
- `sales_channels`: `channelEditor.save.hostPartLabel` ("Sales channel").
- `price_lists`: `displayModeRow.partLabel` ("Price display mode").
- `quick_order`: `defaultPreferences.partLabel` ("Ordering defaults").
- `quote_requests`: `negotiation.partLabel` ("Price negotiation").

Every key in `en.json` and `pl.json` of the owning module.
