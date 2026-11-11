---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/admin-kit': minor
---

**Convert to company in the Admin UI.** A personal organization's page offers *Convert to company* to holders of `organizations:convert-to-company`. A dialog asks for the company name, an optional legal name, the tax ID (spaces and dashes removed as you leave the field), the registered address, the VAT status and whether to validate the tax ID afterwards. It reports the validation's outcome; the organization page then shows its members and roles. *Convert personal organization* (`/organizations/convert-to-company`, also from ⌘K and from the Organizations list's header menu) does the same in two steps, starting from a picker of personal organizations. `GET /api/v1/admin/organizations` accepts `filter[isPersonal]=true|false` with `includePersonal=true`.

- **admin-kit:** `OrganizationPicker` takes an optional `kind` — `'company'` (default, unchanged), `'personal'` or `'any'`; `useOrganizationsQuery` takes the same option, and `OrganizationPickerKind` is exported.
