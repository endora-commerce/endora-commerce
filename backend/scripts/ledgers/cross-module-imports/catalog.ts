/**
 * Cross-module imports still standing in `catalog` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/catalog/commands/attribute-commands.ts:custom_fields/services/custom-field-definition.service':
    {
      permanent: true,
      reason:
        'D-77 — the apply seam, and the one entry in this shard that is not debt. ' +
        '`catalog/migrations/20260723T230401_catalog_attributes_on_custom_fields.ts:120-130` adds ' +
        '`fk_product_attributes_custom_field_definition` (`on delete restrict`) plus a `unique` on ' +
        '`product_attributes.custom_field_definition_id`, so a `product_attributes` insert must see ' +
        'its `custom_field_definitions` parent inside ONE transaction — a second transaction cannot ' +
        'satisfy a foreign key against a row it cannot see, and `attribute-commands.ts` flushes ' +
        'between the two writes for exactly that reason. No port can carry the caller\'s ' +
        '`EntityManager` without putting MikroORM into `@b2b/contracts` (FR-034); a branded handle ' +
        'publishes the coupling without removing it, a token needs a registry with a lifetime, and ' +
        'an ambient unit of work is refused in writing (D-77 rationale 3) because the ugly ' +
        'parameter is the deterrent that has kept this at one seam in 65 modules. 061 R4 refused ' +
        'compensation and nested commands five months earlier, on correctness. `catalog`\'s ' +
        'manifest declares `custom_fields`, as AGENTS.md § Migrations item 4 requires of a ' +
        'cross-module foreign key. What crosses is now ONE type, in THIS file: the returns are ' +
        '`CustomFieldDefinitionRecord` / `CustomFieldOptionRecord`, the failure is the published ' +
        'code union and guard, and `catalog-admin.service.ts` names the re-export here.',
      retiredBy:
        'F4 gives `custom_fields` a package entry point that exports `CustomFieldDefinitionApplyApi` ' +
        '— then this is a package dependency the manifest already declares, not an import of ' +
        'internals. Dropping `fk_product_attributes_custom_field_definition` would retire it too, ' +
        'and would cost the invariant the constraint buys.',
    },
  'modules/catalog/services/catalog-admin.service.ts:sql:inventory/product_warehouse_low_stock_thresholds':
    'D-87 seed — `catalog` writes `inventory`\'s `product_warehouse_low_stock_thresholds` ' +
    'table in raw SQL. The statement names no import specifier, so the boundary it ' +
    'crosses compiles and returns rows. Retired by: `inventoryStockReadPort`, resolved ' +
    'through `lazyPort` with `inventory` declared in this module\'s manifest dependencies.',
  'modules/catalog/services/catalog-admin.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed, and the live defect the sweep was named for (issue #174) — the product ' +
    'duplication copies the source product’s whole channel assortment with a raw `INSERT` ' +
    'into `sales_channel_products`, after its `CommandBus.run` has already returned. That ' +
    'is Principle XII’s accessor clause and Principle XIII in one statement: the copy ' +
    'writes the bridge directly and records no `sales_channel_membership` audit row for ' +
    'any of the memberships it creates. Retired by: the copy moving inside the ' +
    'duplication Command and onto the channel-membership service, so it is audited once ' +
    'with the rest of the duplication (D-87 handoff step 8).',
  'modules/catalog/services/catalog-org-price-decorator.ts:sql:kernel/sales_channel_products':
    'D-87 seed — `catalog` reads the `sales_channel_products` membership bridge directly. ' +
    'Principle XII says the `sales_channel_*` bridges are read and written only through ' +
    'the channel-membership service. Retired by: ' +
    '`SalesChannelMembershipPort.listEntityIdsForChannel`.',
  'modules/catalog/services/catalog-query.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed — `catalog` reads the `sales_channel_products` membership bridge directly. ' +
    'Principle XII says the `sales_channel_*` bridges are read and written only through ' +
    'the channel-membership service. Retired by: ' +
    '`SalesChannelMembershipPort.listEntityIdsForChannel`.',
  'modules/catalog/services/product-link.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed — `catalog` reads the `sales_channel_products` membership bridge directly. ' +
    'Principle XII says the `sales_channel_*` bridges are read and written only through ' +
    'the channel-membership service. Retired by: ' +
    '`SalesChannelMembershipPort.listEntityIdsForChannel`.',
  'modules/catalog/services/catalog-quick-search.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed, added at rebase — this site did not exist when the sweep ran. It arrived ' +
    'with `cb5be278`, the #174 fix that moved the quick-order type-ahead out of ' +
    '`quick_order` and into its owner and gave it the channel scoping it had never had: ' +
    'before that commit the query filtered neither visibility, nor organization, nor ' +
    'channel, so a buyer saw every active product. So this entry records a boundary that ' +
    'is now crossed *correctly* rather than one that is new debt — the scoping is applied, ' +
    'and what remains is that it is applied by hand against the bridge. Retired by: ' +
    '`SalesChannelMembershipPort.listEntityIdsForChannel`, together with the two ' +
    '`product-link.service.ts` entries above, which retire on the same method.',
};
