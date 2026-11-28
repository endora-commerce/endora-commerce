---
'@endora-commerce/contracts': minor
---

**The organization form is declared** (`specs/193-admin-form-extensions/` WP-E1, FR-001, FR-013, FR-080). Additive only.

- `ORGANIZATION_FIELD_SET` (`organization`, owner `organizations`) declares the fields of the admin organization write contract: `name`, `taxId`, `parentId`, `registeredAddress`, `status`, `salesChannelIds`, `vatStatus`, `orderConfirmationEmails`, `fulfilmentStrategy` and `fulfilmentStrategyWarehouseOrder`. A server-enforced override (`validation`, `requiredWhen`, `writePermission`) is invited on `vatStatus`, `orderConfirmationEmails` and `fulfilmentStrategy` only: those are the fields every writer projects. The others invite presentation kinds.
- `ORGANIZATION_FORMS.create` (`organization.create`, sections `identity`, `parent`, `address`, `access`) and `ORGANIZATION_FORMS.edit` (`organization.edit`, sections `notifications`, `fulfilment`).
- `EntityExtensionsInputSchema` and `ENTITY_EXTENSIONS_INPUT_MAX` (8): an adopting host's `extensions` body member, per module id, forwarded unchanged to the host Command.
- `AdminOrganizationCreateBodySchema` and `adminPatchOrganizationRequestSchema` gain an optional `extensions` member. The related-payer bodies derived from the create body (`adminCreatePayerOrganizationBodySchema`, `adminCreateRequestOrganizationBodySchema`) do not take it, so their contract is unchanged.
- `CustomerAccountCreateInput` gains an optional `buyerSelfService?: true`, which marks the invitation acceptance as a buyer's own write (D-300.10). `customer_accounts` honours it from the release that declares the `customer_account` field set. Until then it is ignored.
