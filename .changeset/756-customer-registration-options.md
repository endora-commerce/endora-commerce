---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-customers': minor
---

The storefront can read whether individual self-registration is offered before it renders the form (issue #756). `customers` adds the public `GET /api/v1/storefront/settings/customer-registration`, which answers `{ data: { allowRegistrationWithoutOrganization } }` from `customers.allow_registration_without_organization`, the same answer `POST /api/v1/customers/register` applies. Its shape is `customerRegistrationOptionsResponseSchema` in the contracts. `CustomerRegistrationService` gains `allowsStandalone()`, and `registerStandalone` now uses it. The response is not cached.
