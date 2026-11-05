---
'@endora-commerce/contracts': minor
---

Company registry lookup at storefront registration (`specs/173-registration-registry-lookup/`). New `organization-registry-lookup.ts`, exported from the root:

- `registryLookupRequestSchema` / `registryLookupResponseSchema` for `POST /api/v1/organizations/registry-lookup` — statuses `found`, `not_found`, `unavailable`, `invalid_tax_id`, `unsupported_country`; VAT status, activity status and source as machine tokens; a 43-character `lookupId` (`registryLookupIdSchema`).
- `registrationOptionsResponseSchema` for `GET /api/v1/organizations/registration-options`, and `REGISTRY_LOOKUP_COUNTRIES` (Poland and the VIES member states, Greece as `EL`, Northern Ireland as `XI`) with `registryLookupCountryForPicker` (`EL` → `GR`).
- `organizationTaxIdValidationRecordSchema` — the admin VAT validation history item, now typed, with the new `origin`, `registryDetails`, `submittedValues` and `divergence`, and the schemas they are built from.

Additive changes to `organizations.ts`: `registerOrganizationRequestSchema` accepts an optional top-level `registryLookupId` (not inside `organization`, so `AdminOrganizationCreateBodySchema` does not), and `VatValidationProvider` gains `'gus_pl'` — a consumer that switches exhaustively over it has one more case.
