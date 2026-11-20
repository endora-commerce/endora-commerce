# Contract: Commands and audit state

Every write below is one `CommandBus.run` (Principle XIII), one audit entry, events via the
`afterCommit` outbox. Audit state follows `specs/conventions/audit-state.md`: both entities are
tenant-scoped, so states carry **names, ids and codes only**. Export `RELATED_PAYERS_AUDIT_KEYS` and
ship a sentinel test per Command (`expectNoAuditValues`).

## Actor

The bus draws the actor from the ambient TenantContext: admin user (operator), customer account
(buyer or payer user — with the Organization they acted for), system (expiry sweep, port). The
port's Commands record `actorKind: 'automation'` and `source` (a code, `^[a-z0-9_.-]+$`) in the state,
which is how the audit log tells operator, automation and customer apart (FR-100, SC-006).

## Commands

| Action | Target | Recorded state (list 1 only) |
| --- | --- | --- |
| `related_payers.link.create` | link | `state`, `addressScope`, `billingAddressId`, `validFrom`, `validTo`, `commercialTerms`, `origin`, `source`, `payerOrganizationId`, `originRequestId` |
| `related_payers.link.update` | link | `changedFields` (e.g. `commercialTerms`, `validTo`) plus the code/date values before and after (FR-118) |
| `related_payers.link.set_state` | link | `state` before / after |
| `related_payers.link.revoke` | link | `revokedByKind`, `source` |
| `related_payers.request.create` | request | `direction`, `routing`, `operatorReason`, `approvalMode`, `unregisteredMode`, `counterpartyMatched: boolean` |
| `related_payers.request.accept` | request | `state`, `step` (`counterparty` \| `operator`), `linkId` |
| `related_payers.request.reject` | request | `state`, `rejectionReasonLength` |
| `related_payers.request.withdraw` | request | `state` |
| `related_payers.request.expire` | request | `state` (system actor) |
| `related_payers.request.route` | request | `routing`, `operatorReason`, `counterpartyOrganizationId` (assign / attach on registration) |
| `related_payers.invitation.send` | request | `routing` |

After commit (research R-8): `request.create`, `request.accept`, `request.reject`, `link.revoke`
(Phase 5), `request.expire` (RP-20 c — the requester is told) and `request.route` (US5 — the
counterparty or the operators are told) write outbox rows. `request.withdraw` writes none (RP-20 c).
`invitation.send` issues the token: the row keeps its sha-256, the caller e-mails the token, and no
audit entry or outbox row carries it.

**Never recorded**: tax ID, contact e-mail, comment, rejection reason, names, addresses, the buyer
anchor `organizationId` of the record itself.

## Events (names-only payloads)

`related_payers.link.created.v1`, `.link.changed.v1`, `.link.revoked.v1`,
`related_payers.request.created.v1`, `.request.decided.v1`. Payload: ids, codes, both Organization
ids. Subscribers: the module's own notification dispatch and its cache drop (research R-9). The
module subscribes to `organization.status_changed.v1` (drop cache; attach `awaiting_registration`
requests on approval) through `ctx.subscribe`.

## Writes in other modules

- `orders` placement: unchanged Command/audit path; the order's audit state gains
  `payerOrganizationId` and `payerTerms` (ids and codes), never `payerSnapshot`.
- `carts` `PUT /cart/buying-for`: through the cart's existing write path; the cart records
  `buyingForTerms` and the payer id where it records cart changes today.
