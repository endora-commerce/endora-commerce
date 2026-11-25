# Contract: every participant, its dispositions, its Command and what blocks it

This is derived from the spec's inventories, measured on `67351db04`.
`check:merge-participation` (`merge-participation-check.md`) is the source of truth, and this table
is what MR-C – MR-G implement. The legend:

- **Step** means the participant and its batch Command, which can be built after MR-A's contracts.
- **Port** means the publication of the same Command on the owner's aggregate port.
- **Blocked by** names what the *port* publication waits for. The step waits for nothing but MR-A.

Dispositions: *R* re-point, *U* union, *S* survivor wins, *S+f* survivor wins with fill gaps, *Σ* sum,
*str* stricter, *K* kept.

## A. Organization host: participants

| Module (MR) | Phase | References (`Entity.property`) → disposition | Batch Command | Aggregate-port method | Blocked by |
| --- | --- | --- | --- | --- | --- |
| `organizations` (host, MR-B) | structure (declared under the reserved key `host-structure`) | `Organization.parentId` (children) → R by the tree service's rules inside the structure Command; `OrganizationRole.organizationId` → name match or copy; `OrganizationInvitation.organizationId` → R + role map; `OrganizationSalesRepAssignment.organizationId` → U | host structure batch (`organization.merge.structure`) | `organizationCommandPort.startMerge / resumeMerge / cancelMerge` | **#1821** (same interface) |
| `organizations` | — (no step: plain *survivor wins* and *kept* write nothing) | `OrganizationPaymentMethodLink`, `OrganizationDeliveryMethodLink`, `OrganizationWarehouseLink` `.organizationId` → S; `Organization.mergedIntoOrganizationId` (the archived loser's own pointer) → K | — (no write) | — | — |
| `organizations` | finalize | `OrganizationTaxIdValidation.organizationId` → K (latest copied with a chosen tax ID) | `organization.merge.finalize` | — | — |
| platform kernel (MR-B) | structure | sales-channel memberships of `organization` → U through `SalesChannelMembershipService.addToChannel` | `organization.sales_channels.set` (186 #1821 conversion) or the membership service under the host's structure Command | — | #1821 for the converted Command; otherwise the host calls the kernel service inside its own structure Command |
| `customer_accounts` (MR-E) | members | `CustomerAccount.organizationId` + `organizationRoleId` → R with role map | 191 `customer_account.organization.change`, mode `merge` | `membershipPort.changeOrganization({ mode: 'merge' })` | **#1831** (hard, the step too) |
| `addresses` (C1) | addresses | `Address.organizationId` → R (survivor's defaults kept) | `address.merge_reassign` | — | — |
| `carts` (C1) | records | `Cart.organizationId` → R; `Cart.buyingForOrganizationId` → R, cleared when equal to the cart's own | `cart.merge_reassign` (marks for reprice) | — (`cartWritePort` is not an aggregate port) | — |
| `orders` (D1) | records | `Order.organizationId`, `Order.payerOrganizationId`, `OrderExternalReference.organizationId`, `OrderTransitionEffect.organizationId` → R; `OrderPlacementIntent.organizationId` → refusal while unsettled (R-20), else R | `order.merge_reassign` | `orderCommandPort.reassignOrganization` | **#1823** |
| `quote_requests` (D2) | records | `QuoteRequest.organizationId`, `QuoteRequestNotification.organizationId` → R; `QuoteRequestOrgPolicy.organizationId` → S+f (configuration phase) | `quote_request.merge_reassign` | `quoteRequestCommandPort.reassignOrganization` | **#1824 (PR #1914, in review)** |
| `invoices` (C1) | records | `Invoice.organizationId` → R (document unchanged) | `invoice.merge_reassign` | — | — |
| `invoice_ledger` (C1) | configuration / records | `InvoiceLedgerClientMap.organizationId` → S+f (loser's listed, OQ-10); `InvoiceLedgerDocumentMap.organizationId` → R; `InvoiceLedgerDelivery.organizationId` → K | `invoice_ledger.merge_reassign` | — | — |
| `credit_limits` (C1) | configuration / records | `CreditLimit.organizationId` → S+f; `CreditLimitReservation.reservingOrganizationId`, `CreditLimitReturnTopup.organizationId` → R; over-limit warning in preview (OQ-8) | `credit_limit.merge_reassign` | — | — |
| `related_payers` (C1) | records | `RelatedPayerLink.organizationId` / `.payerOrganizationId` → R, self-links and duplicates revoked; `RelatedPayerRequest.organizationId` / `.counterpartyOrganizationId` → R, self-requests closed | `related_payer.merge_reassign` | `relatedPayerWritePort` unchanged (not an aggregate port) | — |
| `price_lists` (C1) | configuration | `PriceListAudienceMember.organizationId` → U; `PriceListMatrixEntry.organizationId` → S+f per product (**re-derive**: on `master` after the 2026-11 price-book model the matrix entry holds no `organizationId`; `check:merge-participation` does not list it); `PriceDisplayModeOverride` (`scope = organization`) → S+f; price cache invalidated for both | `price_list.merge_reassign` | — | — |
| `promotions` (C1) | records | `Promotion.organizationId`, `PromotionUsage.organizationId` → R; `PromotionUsageCounter` (`scopeType = organization`) → Σ | `promotion.merge_reassign` | — | — |
| `returns` (C1) | records | `ReturnCase`, `ReturnCaseAttachment`, `ReturnWithdrawalStatement` `.organizationId` → R | `return_case.merge_reassign` | — | — |
| `catalog` (D4) | configuration | `Product.allowedOrganizationIds`, `ProductChannelScope.allowedOrganizationIds` → loser replaced by survivor, U | `catalog.product.merge_reassign` | `productCommandPort.replaceAllowedOrganization` | **#1825** |
| `crm` (D3) | records | `CrmOpportunity.organizationId` → R | `crm.opportunity.merge_reassign` | `opportunityCommandPort.reassignOrganization` | **#1827** |
| `projects` (D5) | records | `ProjectOrganization.organizationId` → U; `ProjectLink.organizationId` → R (after the union) | `projects.project.merge_reassign_organization` | `projectCommandPort.replaceOrganization` | **#1828** |
| `shopping_lists` (C2) | records | `ShoppingList.organizationId` → R | `shopping_list.merge_reassign` | — | — |
| `comparisons` (C2) | records | `Comparison.organizationId` → R | `comparison.merge_reassign` | — | — |
| `inventory` (C2) | records | `AvailabilityNotification.organizationId` → R | `availability_notification.merge_reassign` | — | — |
| `forms` (C2) | records | `FormEntry.organizationId` → R | `form_entry.merge_reassign` | — | — |
| `newsletter` (C2) | records | `NewsletterSubscriber.organizationId` → R | `newsletter_subscriber.merge_reassign` | — | — |
| `customer_notifications` (C2) | records | `CustomerNotification.organizationId` → R | `customer_notification.merge_reassign` | — | — |
| `pwa` (C2) | records | `PushSubscription.organizationId` → R; `PushNotificationPreference.organizationId` → R, de-duplicated per account | `pwa.merge_reassign` | — | — |
| `quick_order` (C2) | configuration | `QuickOrderDefaultPreference` (`scope = organization`) → S+f | `quick_order.merge_reassign` | — | — |
| `mfa` (C2) | configuration | `MfaOrganizationPolicy.organizationId` → str | `mfa.merge_reassign` | — | — |
| `api_keys` (C2) | records | `ApiKey.organizationId` (bound key) → R (OQ-9) | `api_key.merge_reassign` | — | — |
| `webhooks` (C2) | records | `Webhook.organizationId` → R (before finalize, so the merged event reaches them) | `webhook.merge_reassign` | — | — |
| `analytics` (C2) | records, **trailing** | `AnalyticsEvent.organizationId` → R (OQ-12) | `analytics.merge_reassign` | — | — |
| `admin_users` (C2) | — | `ImpersonationReason.organizationId` → K | — | — | — |
| platform kernel (MR-A) | — | `AuditLogEntry.objectId` (`objectType = organization`) → K; `CommandOutboxEntry.organizationId` (delivery log of committed Commands) → K. Declared in `KERNEL_MERGE_PARTICIPATIONS` (the kernel has no manifest) | — | — | — |

Saved admin list views that store an Organization filter are not references (no persisted
Organization-id property). They are excluded by the check's population rule and are not rewritten.

## B. Project host: participants (MR-G)

| Module | Phase | References → disposition | Batch Command | Aggregate-port method | Blocked by |
| --- | --- | --- | --- | --- | --- |
| `projects` (host) | structure | `ProjectOrganization` → U; `ProjectMember` → U (survivor's role on conflict); `ProjectViewer` → U | host structure batch | `projectCommandPort.startMerge / resumeMerge / cancelMerge` | **#1828** |
| `projects` | records | `ProjectComment`, `ProjectAttachment`, `ProjectLink` → R; `ProjectReference` (source and target) → R; `ProjectMessageRead*` → carried (FR-094) | `projects.project.merge_reassign` | — (host-internal) | #1828 |
| `projects` | — | `ProjectStage*`, `ProjectStageMove`, `ProjectStageEntry`, `ProjectValueChange`, `ProjectStageAlertDelivery` → K | — | — | — |
| `tasks` | records | `Task` (`contextType = project`).`contextId` → R, `contextGroupId` cleared; `TaskReference` (`targetType = project`).`targetId` → R | `task.merge_move_context` | `taskCommandPort.moveContext` | **#1829** |
| `crm` | records | `CrmOpportunityReference` (`targetType = project`).`targetId` → R | `crm.opportunity_reference.merge_reassign` | — (derived rows; no aggregate operation) | — |

## C. Ports not needed

- **#1822** (`customerAccountCommandPort`): members move through `membershipPort` (D-293.2).
- **#1826** (`categoryCommandPort`): categories hold no Organization or Project reference.
