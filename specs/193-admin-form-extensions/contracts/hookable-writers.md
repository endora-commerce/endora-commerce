# Contract: hookable writers for `customer_accounts`, `crm` and `catalog` (FR-110 – FR-114, R-22)

All of these follow `specs/176-command-hooks-outbox/contracts/command-hooks-api.md` §6. All are
additive: each action is a new frozen identity, and its data types are additive-only.

## §1 `customer_accounts`, in `packages/contracts/src/customer-account-hooks.ts`

```ts
export interface CustomerAccountCreateHookData { readonly customerAccount: CustomerAccountRecord }
export interface CustomerAccountUpdateHookData {
  readonly customerAccount: CustomerAccountRecord;       // after-state
  readonly changedFields: readonly string[];
  readonly changedCustomFields: readonly string[];
}
export type CustomerAccountOutbox = { customerAccountId: string; organizationId: string | null; changedFields: readonly string[]; changedCustomFields: readonly string[] }; // changedCustomFields: the keys whose value changed; empty on create and on a profile update (as `organizations`)
export const CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS = {
  create:             hookableAction<CustomerAccountCreateHookData, CustomerAccountOutbox>('customer_account.create', 'customer_account', ['beforeCommit', 'afterCommit']),
  updateProfile:      hookableAction<CustomerAccountUpdateHookData, CustomerAccountOutbox>('customer_account.update_profile', 'customer_account', ['beforeCommit', 'afterCommit']),
  customFieldsUpdate: hookableAction<CustomerAccountUpdateHookData, CustomerAccountOutbox>('customer.custom_fields.update', 'customer_account', ['beforeCommit', 'afterCommit']),
};
```

`customer_account.create` is also run by the buyer self-registration Commands as a child Command.
For those runs the field-rule check skips the buyer actor (D-300.3). The registration runs
anonymously under a `system` actor, so the root Command declares `buyerSelfService: true`, and the
child inherits it through the bus's lineage (D-300.10). The roots are `organization.register`,
`customer_account.register_standalone`, and the invitation acceptance's `customer_account.create`.
That last one is run through `CustomerAccountMemberWritePort.create`, whose input gains an optional
`buyerSelfService?: true` for it. Slot hooks still run, and they
see no `extensions`.

## §2 `crm`, in `opportunity-hooks.ts`

```ts
export const OPPORTUNITY_HOOKABLE_ACTIONS = {
  create: hookableAction<OpportunityCreateHookData, OpportunityOutbox>('crm.opportunity.create', 'crm_opportunity', ['beforeCommit', 'afterCommit']),
  update: hookableAction<OpportunityUpdateHookData, OpportunityOutbox>('crm.opportunity.update', 'crm_opportunity', ['beforeCommit', 'afterCommit']),
};
```

The hook data carries `opportunity: OpportunityRecord` (the after-state), `changedFields` and
`changedCustomFields`. The outbox carries ids and names only.

## §3 `catalog`, in `product-hooks.ts`

```ts
export const PRODUCT_HOOKABLE_ACTIONS = {
  create:             hookableAction<ProductCreateHookData, ProductOutbox>('product.create', 'product', ['beforeCommit', 'afterCommit']),
  update:             hookableAction<ProductUpdateHookData, ProductOutbox>('product.update', 'product', ['beforeCommit', 'afterCommit']),
  scopedValuesSave:   hookableAction<ProductScopedValuesHookData, ProductOutbox>('product.scoped_values.save', 'product', ['beforeCommit', 'afterCommit']),
  scopedValuesImport: hookableAction<ProductScopedValuesHookData, ProductOutbox>('product.scoped_values.import', 'product', ['beforeCommit', 'afterCommit']),
};
export interface ProductScopedValuesHookData {
  readonly productId: string;
  /** One entry per scope the Command saved. */
  readonly scopes: readonly { readonly scope: ScopeRef; readonly after: Readonly<Record<string, unknown>>; readonly changedFields: readonly string[] }[];
}
```

### §3.1 The bulk edit (D-300.8)

A bulk edit writes no `product.update`. Here is how it writes, measured on WP-H3 (`753b15f16`):

| Entry | What it is | Hookable | Writer |
| --- | --- | --- | --- |
| `product.bulk_update` | One summary audit row per run, written by `CatalogBulkUpdateService.recordSummaryAudit` through the audit port. It is **not** a Command. | no | no |
| `product.bulk_update.item` | The Command per product for status, visibility, returnable, attribute set, categories and attribute values, on the inline and the queued path. Before D-300.8 this was `product.update`. | **no** | rule-check-only |
| `product.archive` / `product.restore`, `product.scopes.update` | The Commands a bulk edit runs for `archived` and `scopedStatus`. | no | not in the product field set |
| `product.bulk_update.undo` | One Command per undo (`objectType: 'bulk_operation'`). It restores columns and scope rows directly from `revertState` and writes no product Command. | no | no (undo) |

- `product.bulk_update.item` runs the same `run` as `product.update`. It records the same audit
  state (`stateBefore`, `stateAfter`, `changedFields`), emits `product.updated.v1`, and supplies
  `hookData` of type `ProductUpdateHookData` for the field-rule check. It has no `outboxData`,
  because no `afterCommit` handler can exist for it.
- The action is module-local. It is not in `PRODUCT_HOOKABLE_ACTIONS` and not in the manifest's
  `hookableActions`, so a hook registered on it is refused at composition
  (`UndeclaredHookableActionError`). The ref that `ctx.fieldSets` needs for `on` stays inside
  `catalog`.
- It is not reachable from `catalogProductCommandPort`. The aggregate port's `update` and
  `setCustomFieldValues` stay `product.update`.
- **What a hook author can rely on.** `product.update` hooks see every product write except a bulk
  edit's. To observe bulk edits and their undo, listen to `product.updated.v1`: the per-product
  Command emits it, and the undo emits it for every product it restores. An invariant that has to
  bind bulk edits too is a field rule (`requiredWhen`, `options`, `writePermission`), which a
  rule-check-only writer enforces. A `beforeCommit` veto does not bind bulk edits.
- The undo is not a writer. A rule added after a bulk edit cannot block undoing it (R-22).

## §4 Obligations per action

1. A test showing the Command is not reversible, run before the action is declared (T002, T006, T008). If it is
   reversible, or a reversible parent operation composes it (D-300.8), the write it performs for that
   parent runs under an action of its own, which is rule-check-only.
2. `hookData` and `outboxData` on the Command, and `expectHookableCommand(command, ref)` in its tests.
3. A manifest `hookableActions` entry (`toHookableActionDeclaration`).
4. A changeset on `@endora-commerce/contracts` and the owner package. The change is additive.
5. The owner's aggregate command port forwards `options.extensions`, as `organizationCommandPort`
   does (176 *Ports*).
