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
For those runs the field-rule check skips the buyer actor (D-300.3). Slot hooks still run, and they
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

`product.bulk_update` is reversible, so it is **not** declared hookable. It supplies `hookData` and
is registered in `ctx.fieldSets` as `{ on: …, ruleCheckOnly: true }`. The undo Command
`product.bulk_update.undo` is not a writer.

## §4 Obligations per action

1. A test showing the Command is not reversible, run before the action is declared (T002, T006, T008). If it is
   reversible, it becomes rule-check-only instead.
2. `hookData` and `outboxData` on the Command, and `expectHookableCommand(command, ref)` in its tests.
3. A manifest `hookableActions` entry (`toHookableActionDeclaration`).
4. A changeset on `@endora-commerce/contracts` and the owner package. The change is additive.
5. The owner's aggregate command port forwards `options.extensions`, as `organizationCommandPort`
   does (176 *Ports*).
