---
'@endora-commerce/mod-returns': minor
---

Returns and complaints follow the buyer's organization role (`specs/170-organization-roles/` FR-052 – FR-054, owner ruling OR-11, research R-41). The manifest declares two organization permissions, labelled in English and Polish: `returns.create` ("Create returns and complaints", member-default) and `returns.view_organization` ("View the organization's returns and complaints", not member-default); *Administrator* holds both. `organizations` joins `dependencies` (it is `nonDeactivatable`, so no operator control is lost).

Behaviour on the buyer routes:

- `POST /api/v1/returns` is gated by `organizationPermissionPreHandler(…, 'returns.create')` after `requireCustomer`: a role without it is refused `403 ORGANIZATION_PERMISSION_REQUIRED` before the order is read.
- `GET /api/v1/orders/:orderId/returnable` and `POST /api/v1/returns` judge the order through `orderReadPort.findByIdForCustomer` instead of comparing the order's placer with the caller: a member holding `orders.view_organization` (or *Administrator*) may start a return from a colleague's order, filed in the starter's name; an order out of reach is still `404`.
- `GET /api/v1/returns` and `GET /api/v1/returns/:id` widen for a holder of `returns.view_organization` to every case of the Organization (its subtree for a roll-up login); anyone else keeps the cases they filed. The case summary and the operator's row carry `customerAccountId`.
- Comments, attachments, the delivery-method choice and cancelling stay the filer's (`404` to anyone else) and need no code.

*Member* keeps exactly its former reach. An administrator's reach widens on upgrade (owner's answer to Q-R3).

Shape changes: `ReturnsModuleOptions` gains the required `orderReadPort: OrderReadPort` and `organizationPermissions: OrganizationPermissionPort`; `ReturnCaseServiceDeps` gains the required `orderRead` and `scope: ReturnCaseScope`; `ReturnCaseService.getReturnable`, `.createCase`, `.listForCustomer` and `.getForCustomer` take a `ReturnCustomerContext` (`{ customerAccountId, organizationId, organizationRoleId? }`) where they took a `customerAccountId: string`.
