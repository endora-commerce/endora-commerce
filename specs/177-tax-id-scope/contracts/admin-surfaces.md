# Contract: admin surfaces, permissions, palette, i18n, errors

Normative for FR-017, FR-025, FR-042, FR-050. Rules: `specs/conventions/module-admin-surfaces.md`,
`module-i18n.md`; UX: `.claude/skills/ux-laws/SKILL.md`. The designer agent may refine the screens;
the codes, routes and keys below are the contract.

## 1. Permission codes (`organizations/src/manifest.ts` `permissions`)

| Code | Label (en) | `requires` | Enforced on |
| --- | --- | --- | --- |
| `organizations:manage-tax-id-scope` | Manage the tax-ID scope | `['customers:read']` | `GET`/`PUT /api/v1/admin/organizations/tax-id-scope`; admin route `/organizations/tax-id-scope` |
| `organizations:convert-to-company` | Convert personal organizations to companies | `['customers:read']` | `POST /api/v1/admin/organizations/:id/convert-to-company`; admin route `/organizations/convert-to-company`; the detail button |

Labels `adminRoles.permission.<code>` in `packages/modules/organizations/i18n/{en,pl}.json` (pl:
"Zarządzanie zakresem unikalności NIP", "Zamiana organizacji osobistych na firmowe").
CI: `test/contract/admin_users/permission-inventory.test.ts`.

## 2. Palette actions (`manifest.ts` `actions`)

| id | targetRoute | requiredPermission | icon | keywords (en) | weight |
| --- | --- | --- | --- | --- | --- |
| `open-tax-id-scope` | `/organizations/tax-id-scope` | `organizations:manage-tax-id-scope` | `Settings` | `tax`, `nip`, `vat`, `scope`, `unique`, `branch` | 190 |
| `convert-personal-organization` | `/organizations/convert-to-company` | `organizations:convert-to-company` | `Building2` | `convert`, `personal`, `company`, `b2c`, `b2b` | 185 |

Keys (module-relative, flat): `actions.openTaxIdScope.{label,description,keywords}`,
`actions.convertPersonalOrganization.{label,description,keywords}`; the `keywords` entries in **both**
bundles carry the non-English search words (pl: `nip, unikalność, oddział, zakres` /
`zamiana, osobista, firma, konto firmowe`). CI: `registered-bundles-shape.test.ts`,
`check:action-route-permissions`, `admin/test/unit/palette-coverage.test.ts` (both routes become
covered destinations).

## 3. Admin routes (`organizations/src/admin/index.ts` `routes`)

Declared ahead of `/organizations/:id`:

```ts
{ path: '/organizations/tax-id-scope', component: () => import('./pages/TaxIdScopePage.js'),
  requiredPermission: 'organizations:manage-tax-id-scope' },
{ path: '/organizations/convert-to-company', component: () => import('./pages/ConvertToCompanyPage.js'),
  requiredPermission: 'organizations:convert-to-company' },
```

No sidebar entries (both are reached from the Organizations list header menu and ⌘K).

## 4. Screens

### 4.1 Tax-ID scope (`TaxIdScopePage.tsx`)

- `PageHeader` "Tax-ID scope", description one line; back link to `/organizations`.
- One `Card` with a radio group of the two scopes (`Label` + native radio inputs styled by the kit;
  admin-kit has no `RadioGroup` — use two `Checkbox`-sized radio inputs with `Label`, not a new
  primitive): **Global** — "Every tax ID belongs to one organization." **One tree per tax ID** — "Head
  offices and their branches may share a tax ID; unrelated organizations may not."
- Current scope marked with a `Badge` "Current"; `updatedAt` and actor below.
- Primary CTA "Apply" (`Button`), disabled while the selection equals the current scope (with a hint
  why). Confirmation `ModalDialog` before applying: what changes, that writes to organizations pause
  for a few seconds, that switching back requires no shared tax IDs.
- `sharedTaxIdCount > 0` and scope `per-tree-root`: `Alert variant="warning"` "N tax IDs are shared
  inside a tree. Switching to Global is possible after they are changed."
- `409 …_DUPLICATES`: `Alert variant="destructive"` with the sentence and a list of up to 20 tax IDs,
  each linking its organizations (`/organizations/:id`).
- `enforcement = mismatch`: `Alert variant="destructive"` "The database does not enforce the current
  scope. Apply it again to repair." with "Apply again" as the primary CTA.
- States: skeleton on load; `aria-busy` + spinner on Apply; success `Alert` in a `role="status"`
  region mounted before it has text; `403` → the kit's no-permission state.

### 4.2 Convert to company — dialog on the organization page

- `OrganizationDetail.tsx`: for `org.isPersonal && isVisible({ module: 'organizations',
  requiredPermission: 'organizations:convert-to-company' })`, a secondary `Button` "Convert to company"
  in `PageHeader.actions` beside *Back* (the page's primary actions stay the moderation panel's).
- `ModalDialog` hosting `ConvertToCompanyForm` (shared component,
  `admin/components/ConvertToCompanyForm.tsx`): company name (prefilled empty — the personal name is a
  person's), legal name (optional), tax ID (normalised on blur: spaces and dashes removed,
  upper-cased — Postel), registered address (street, city, postal code, `CountrySelect`), VAT status
  (`Select`, default *VAT payer*), checkbox "Validate the tax ID after converting" (default on).
- An explanatory line above the fields: "The organization keeps its orders, carts and addresses. Its
  member becomes its Administrator and can invite others. This cannot be undone."
- Field errors linked with `aria-describedby` / `aria-invalid`; `409 ORGANIZATION_TAX_ID_EXISTS` is
  shown on the tax-ID field; `ORGANIZATION_CONVERSION_REFUSED` as a dialog-level `Alert`.
- Submit "Convert" (primary, `aria-busy` while in flight). On success the dialog closes, the page
  refreshes (Members and Roles tabs now visible, `OrganizationRolesTab` no longer returns `null`),
  and a success `Alert` reports the VAT validation outcome when one ran.
- `VatValidationPanel` is not rendered for a personal organization (FR-006).

### 4.3 Convert personal organization — standalone screen (`ConvertToCompanyPage.tsx`)

- Target of the ⌘K action. Step 1: pick a personal organization — `OrganizationPicker` gains an
  optional `kind?: 'company' | 'personal' | 'any'` prop (default `'company'`, today's behaviour),
  backed by the list endpoint's existing `includePersonal=true` plus a new `filter[isPersonal]` query
  value. Empty state: "No personal organizations match." Step 2: the same `ConvertToCompanyForm`.
  On success: navigate to `/organizations/:id`.
- Progress shown as "1 Choose · 2 Company details" (Zeigarnik).

### 4.4 Admin create — optional parent

`OrganizationCreate.tsx` gains an optional "Parent organization" `OrganizationPicker`, shown only to
an unscoped administrator; hint under the tax-ID field in `per-tree-root`: "Branches may use their
head office's tax ID."

### 4.5 Organizations list

A header `RowActionMenu` (or the existing actions slot) gains "Tax-ID scope" and "Convert personal
organization", each visible under its permission.

## 5. Error codes (manifest `errorCodes`, contracts `ERROR_CODES`, bundles)

| Code | Status | Tokens | en sentence |
| --- | --- | --- | --- |
| `ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` | 409 | `shared_tax_ids` | "{sharedTaxIdCount} tax IDs are shared by more than one organization. Give each its own tax ID before switching to Global." |
| `ORGANIZATION_CONVERSION_REFUSED` | 409 | `not_personal`, `deleted`, `owner_not_administrator` | "This organization is already a company." / "A deleted organization cannot be converted." / "The organization's member is not its Administrator, so it cannot be converted. Contact support." |
| `ORGANIZATION_TREE_INVALID` (existing) | 409 | + `tax_id_shared_across_trees` | "This move would put tax ID {taxIds} into two organization trees." |
| `ORGANIZATION_TAX_ID_EXISTS` (existing) | 409 | — | unchanged |

Polish sentences beside each in `i18n/pl.json`; the base key and every token sub-key are carried
(the D-190 rule in `manifest.ts` l. 600–620). Tests: `check:error-translations`,
`test/unit/organizations/error-code-sentences.test.ts` (renders a real refusal per token).

## 6. Other i18n keys (both bundles)

`taxIdScope.*` (page title, description, the two scope labels and descriptions, current, apply,
confirm title/body, success, mismatch, duplicates heading), `convertToCompany.*` (button, dialog title,
explanation, field labels, validate checkbox, submit, success, success with validation outcome,
page title, step labels, picker placeholder, empty), `create.field.parent`, `create.hint.sharedTaxId`.
No literal in a component (`check:language`, the admin literal ledger).
