# Data model: Aggregate ports (186)

## No schema change

No table, column, index or migration is added, changed or removed. Every port operation writes
columns its owner already maps; every Command conversion (research R-2) keeps the same write and the
same audit action. The feature therefore needs nothing from `pnpm --filter backend run migration:new`
and does not collide with the MikroORM 7 entity freeze (#1866) beyond landing its service changes after
it.

## Contract types (in `@endora-commerce/contracts`)

### `AggregateCommandOptions` — `packages/contracts/src/aggregate-ports.ts` (new file)

| Field | Type | Rule |
| --- | --- | --- |
| `extensions` | `Readonly<Record<string, unknown>>?` | keyed by hook module id; an unclaimed key → `422 COMMAND_EXTENSION_UNCLAIMED` before any write (spec 176) |
| `expectedVersion` | `number?` | honoured where the aggregate has a `version` the admin route checks; stale → `409 VERSION_CONFLICT`; elsewhere documented as ignored |
| `source` | `string?` | `^[a-z][a-z0-9_.-]{0,63}$`; recorded as `source` in the Command's `stateAfter` (code, `audit-state.md` list 1); `null` when absent; an invalid code → `422 VALIDATION_FAILED`. With no administrator the actor is `system` and this code is what tells integrations apart — there is no `automation` actor kind (D-293.6) |

`CustomFieldMerge = (current: Record<string, unknown>) => Promise<Record<string, unknown>>`.

`OrganizationCommandPortOptions` becomes `type OrganizationCommandPortOptions = AggregateCommandOptions`
(its one field, `extensions`, is unchanged).

### Records — additive fields

| Record | File | Added |
| --- | --- | --- |
| `OpportunityRecord` | `packages/contracts/src/crm.ts` | `customFieldValues?: Record<string, unknown>` — optional on the type, always filled (research R-21.4) |
| `ProjectRecord` | `packages/contracts/src/projects.ts` | `customFieldValues: Record<string, unknown>` |
| `TaskRecord` | `packages/contracts/src/tasks.ts` | `customFieldValues: Record<string, unknown>` |
| `OrderRecord` | `packages/contracts/src/orders.ts` | `payer: OrderPayer \| null` (`orderPayerSchema`, `specs/182-related-payers/`) |

Already present and unchanged: `OrganizationRecord`, `CustomerAccountRecord`, `OrderRecord`,
`QuoteRequestRecord`, `CatalogCategoryRecord` (`customFieldValues`); `CatalogProductRecord`
(`attributeValues`).

### `CUSTOM_FIELD_HOST_BINDINGS` — `packages/contracts/src/custom-fields.ts`

Each entry gains `aggregatePort` (research R-14):

| Key | `ownerModuleId` | `aggregatePort` |
| --- | --- | --- |
| `organization` | `organizations` | `organizationCommandPort` |
| `customer` | `customer_accounts` | `customerAccountCommandPort` |
| `order` | `orders` | `orderCommandPort` |
| `quote_request` | `quote_requests` | `quoteRequestCommandPort` |
| `product` | `catalog` | `catalogProductCommandPort` |
| `category` | `catalog` | `catalogCategoryCommandPort` |
| `opportunity` | `crm` | `opportunityCommandPort` |
| `project` | `projects` | `projectCommandPort` |
| `task` | `tasks` | `taskCommandPort` |

`extensible-hosts.ts` (`packages/platform/src/kernel/schema-extensions/`) reads `table` and
`ownerModuleId` only and is unaffected.

## Port disposition

What happens to each existing write-shaped port of the nine owners. "Deprecated" = `@deprecated since
0.113.0; use {@link …}` and a delegating implementation in 0.113.0, removed in 0.114.0 (US12).

| Port (container name) | Method(s) | Disposition | Replacement |
| --- | --- | --- | --- |
| `organizationCommandPort` | `convertToCompany`, `changeTaxId` | **kept, widened** | — |
| `organizationWritePort` | `findByTaxId` | deprecated | `organizationDetailsPort.findByTaxId` |
| | `create`, `update` | deprecated | `organizationCommandPort.create` / `.update` |
| `organizationCustomFieldWritePort` | `setCustomFieldValues` | deprecated | `organizationCommandPort.setCustomFieldValues` |
| `customerAccountLifecycleWritePort` | `createStandalone`, `block`, `unblock`, `softDelete`, `restore`, `setCustomerGroup`, `setCustomFieldValues`, `anonymize` | deprecated | `customerAccountCommandPort.*` |
| | `listDueForAnonymization`, `hasDueForAnonymization` | deprecated | `customerAccountReadPort.*` (moved) |
| | `setOrganization`, `detachToPersonalOrganization` | **deprecated by spec 191** | `membershipPort.changeOrganization` / `.detachToPersonal` |
| `customerAccountMemberWritePort` | `create`, `updateProfile`, `setSubtreeRollup`, `promoteToOrganizationAdmin`, `markEmailVerified` | deprecated | `customerAccountCommandPort.*` |
| | `attachToOrganization` | **deprecated by spec 191** | `membershipPort` |
| `customerAccountPreferencePort` | `setPreferredLanguage` | kept (the buyer's own write, research R-17.4); runs `customerAccountCommandPort.setPreferredLanguage` | — |
| | `captureIfUnset` | kept (sign-in capture, not a lifecycle operation) | — |
| `customerAccountRoleCommandPort` | `changeRole`, `holdersOf` | kept (child-Command factory for `organizations`' own Commands) | — |
| `customerAccountMemberCommandPort` | `prepareCreate` | kept (same reason) | — |
| `orderTransitionPort` | `applyStatus` | deprecated | `orderCommandPort.applyStatus` |
| | `isTerminal` | deprecated | `orderReadPort.isTerminal` (moved) |
| `orderPaymentStatusApplyPort` | (all) | deprecated | `orderCommandPort.applyPaymentStatus` |
| `orderExternalReferencePort` | `set` | deprecated | `orderCommandPort.setExternalReference` |
| | `get`, `listForOrder`, `findOrderIds` | kept (reads; may move to `orderReadPort` later, not here) | — |
| `orderPlacementPort` | `placeOrder` | deprecated **when US11 lands** | `orderCommandPort.place` |
| `orderStatusAnnouncePort`, `orderQuoteSourcePort` | (all) | kept (not lifecycle writes) | — |
| `catalogProductWritePort` | `createProduct`, `updateProduct`, `createVariant`, `updateVariant`, `deleteVariant` | deprecated | `catalogProductCommandPort.*` |
| | `listAttributes`, `listAttributesByFlag` | deprecated | `catalogAttributeReadPort.listAll` / `.listByFlag` |
| | `createAttribute`, `updateAttributeByIdOrKey`, `addAttributeOption`, `patchAttributeOption` | deprecated | `catalogAttributeCommandPort.*` |
| `catalogProductScopeWritePort` | `applyScopes` | deprecated | `catalogProductCommandPort.applyScopedValues` |
| `catalogBulkImportPort` | (all) | kept (bulk report semantics) | — |
| `catalogCategoryWritePort` | `listAll` | deprecated | `catalogCategoryReadPort.listAll` (exists) |
| | `create`, `update`, `setInventoryThresholds` | deprecated | `catalogCategoryCommandPort.*` |
| `opportunityTransitionPort` | `applyStatus` | deprecated | `opportunityCommandPort.transition` |
| `taskWritePort` | `createMany`, `deleteInContext` | deprecated | `taskCommandPort.createMany` / `.deleteInContext` |

## Contract surface entry (conceptual; derived, never stored)

| Attribute | Meaning |
| --- | --- |
| `kind` | one of the kinds in `contracts/contract-surface.md` |
| `id` | stable identity within the kind (e.g. `port:organizationCommandPort#setParent`, `hook-data:organization.create`) |
| `tier` | `frozen` \| `stable` \| `additive-only` — the kind's |
| `direction` | `read` \| `write` \| `call` — the kind's |
| `deprecation` | parsed from the base release's JSDoc: `{ since, replacement \| reason }` or none |

The release-intent comparison computes entries for HEAD and for the base tag on every run; nothing is
committed. Port entries (`port:<containerName>`, `port:<containerName>#<method>`) come from the
`Container name:` population `check:port-shape` already derives (`backend/scripts/lib/port-population.ts`
after the extraction); there is no `@api` tag.

## Sanctioned contract break (committed ledger entry; D-293.7)

`backend/scripts/ledgers/contract-surface-breaks.ts`, `SANCTIONED_CONTRACT_BREAKS: Readonly<Record<entryId,
SanctionedContractBreak>>`, opening empty. Not a database row — a reviewed source file.

| Field | Rule |
| --- | --- |
| key | a contract-surface entry id as the check prints it (`port:organizationWritePort#create`) |
| `base` | `v<major>.<minor>.<patch>`, the release the break is measured against; equal to the run's base → live; older → spent; newer → malformed |
| `finding` | exactly one of `contract-removed-without-deprecation`, `contract-changed-without-deprecation`, `frozen-contract-changed`, `additive-contract-narrowed` |
| `ruling` | `^D-\d{3,}$`; existence not checked (withheld pre-migration records) |
| `upgradeNote` | a `{#anchor}` id present in `docs/docs/upgrading-an-instance.md` and the Polish translation; each section names the entry's symbol and the D-number |
| `why` | non-empty sentence |

Lifecycle: written with the break → live and `ruled` until the release that carries it is tagged →
spent → removed by the next release pull request (`spent-contract-break` refuses it there). A live
entry that matches no finding is `stale-contract-break`.

## Deprecation marker grammar

```text
@deprecated since <major>.<minor>.<patch>; use {@link <Symbol>[.<member>]} instead.
@deprecated since <major>.<minor>.<patch>; no replacement: <reason>.
```

Anything else on a surface entry is `deprecation-unparseable`. The instance-level overlay build of
`specs/190-overlay-full-modules/` reads the same marker to warn an instance author.
