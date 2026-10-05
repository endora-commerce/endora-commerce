---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-orders': minor
---

More of the new CRM module, in the same first release as `crm-module.md` describes. Nothing
here changes behaviour a released version had.

**Operator-defined fields on an opportunity.**

- **`opportunity` is a custom-field host type.** `supportedEntityTypeSchema` in
  `@endora-commerce/contracts` gains the member `'opportunity'`. A consumer that switches
  exhaustively over `SupportedEntityType`, or builds a `Record` over it, needs a case for it.
- **A host type may name the module it belongs to.** `SupportedEntityMeta` in
  `@endora-commerce/mod-custom-fields` gains an optional `ownerModuleId`. While that module is
  not effectively present, `GET /api/v1/admin/custom-fields/entity-types` omits the type and
  the definition and option mutation routes answer `409 CUSTOM_FIELD_HOST_MANAGED` for it;
  definitions and stored values are kept. Types that declare no owner — every type that
  existed before — answer exactly as they did.
- **`CreateOpportunityRequestSchema` and `UpdateOpportunityRequestSchema` accept an optional
  `customFieldValues`**, and `OpportunityDetail` carries `customFieldValues`. A value that
  breaks its definition answers `422 CUSTOM_FIELD_VALUE_INVALID` with one issue per field. The
  values are stored in a new `crm_opportunities.custom_field_values` column, added by a second
  migration of the module, and are written and audited by the opportunity's own create and
  update.
- **`crm` depends on `custom_fields`** (a module the platform does not allow to be switched
  off), and `crm:read` now names `custom_fields:read` among the permissions a role should also
  hold.
- **`CustomFieldValuesPanel` in `@endora-commerce/admin-kit` can be embedded in a form.**
  `save` is now optional; with `onChange` and no `save` the panel renders the fields and no
  button, and reports the whole edited bag on every change. Two further optional props:
  `fieldErrors` (a message per field key, shown at the field) and `language` (the language
  labels are shown in; `en` when omitted). A caller passing none of them sees no change.

**CRM where the rest of the platform already is.**

- **Two published ports.** `opportunityReadPort` (`OpportunityReadPort`: `findById`,
  `findByDocument`, `listOpenForOrganization`, answering plain `OpportunityRecord` values under
  the caller's tenant scope) and `opportunityTransitionPort` (`OpportunityTransitionPort`:
  `applyStatus`, answering `applied`, `already_there`, `not_found`, `unknown_status`,
  `not_permitted` or `vetoed` as a value). Both are gated: resolving either while `crm` is off
  throws `ModuleDisabledError`. The two interfaces in `@endora-commerce/contracts` now carry
  their `Container name:` lines; their shapes are unchanged.
- **Recent activity names an opportunity.** The module contributes a resolver for
  `crm_opportunity` to `auditReferenceRegistry` (title and `/crm/opportunities/:id`), and
  `crm` now lists `audit_logs` in `dependencies`, as the registry's other contributors do.
- **An "Open opportunities" panel on the organization screen**, contributed to the existing
  `organization.detail.after` zone under `crm:read`, with a "New opportunity" link for a
  holder of `crm:write`. `organizations` is unchanged.
- **No demo data.** The manifest keeps `demo: false`; a demo pipeline needs rows of other
  modules and is a step of the instance's demo composition, not of this module.

**The order screen shows its opportunity.**

- **A new admin zone, `order.detail.after`**, in `AdminZoneNameSchema` and `AdminZonePropsMap`
  of `@endora-commerce/contracts` (props: the existing `OrderDetailZoneProps`), mounted once by
  `@endora-commerce/mod-orders` at the end of the order screen, below the tabs. `orders` names
  no contributor; with nothing contributed the screen is unchanged. A module adds a panel with
  `zoneComponent('order.detail.after', …)`.
- **`GET /api/v1/admin/crm/documents/:documentKind/:documentId/opportunity`** (`crm:read`)
  answers the summary of the opportunity an order is linked to, or `{ data: null }`; `404
  CRM_DOCUMENT_NOT_FOUND` for an order that is missing or outside the caller's scope; `422` for
  any other kind, `quote_request` included until quote requests can be linked.
  `OpportunityOfDocumentResponseSchema` is the response schema.
- **A "Linked opportunity" panel on the order screen**, contributed by `crm` to that zone under
  `crm:read`: the opportunity's number, title, status, assignee and value, or — for a holder of
  `crm:write` — "Link to an opportunity" and "Create opportunity".
- **The create form honours `linkDocumentKind=order` and `linkDocumentId`** beside
  `organizationId`: after a successful create it links the order through the existing link
  endpoint and then opens the opportunity. The create request itself is unchanged.

