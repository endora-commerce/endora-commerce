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
  'modules/catalog/commands/attribute-commands.ts:custom_fields/ports/index':
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
        '`EntityManager` without putting MikroORM into `@endora-commerce/contracts` (FR-034); a branded handle ' +
        'publishes the coupling without removing it, a token needs a registry with a lifetime, and ' +
        'an ambient unit of work is refused in writing (D-77 rationale 3) because the ugly ' +
        'parameter is the deterrent that has kept this at one seam in 65 modules. 061 R4 refused ' +
        'compensation and nested commands five months earlier, on correctness. `catalog`\'s ' +
        'manifest declares `custom_fields`, as AGENTS.md § Migrations item 4 requires of a ' +
        'cross-module foreign key. What crosses is now ONE type, in THIS file: the returns are ' +
        '`CustomFieldDefinitionRecord` / `CustomFieldOptionRecord`, the failure is the published ' +
        'code union and guard, and `catalog-admin.service.ts` and `plugin.ts` name the re-export ' +
        'here. T053(b) took the last two things off it that were not the seam: the specifier now ' +
        "names the owner's `ports/` directory, a file that compiles to `export {};` and can hand " +
        'out nothing else, and the committed-state definition read it used to carry is ' +
        '`CustomFieldDefinitionReadPort.getById` — a read, so by D-169 it may not take an ' +
        '`EntityManager`, and the seam was answering it with the owner\'s two managed ORM ' +
        'entities typed as records.',
      retiredBy:
        'F4 packages `custom_fields`, at which point that same directory is the package\'s ' +
        '`./ports` subpath, D-171 stops counting the reach, and the consumer-side edit is this one ' +
        'specifier. It is not retired by the relocation alone: `resolveModulePackage` returns ' +
        '`null` for anything starting with `.`, so a relative specifier has no subpath for the ' +
        'exemption to apply to, and the three edits (package the owner, publish the interface, ' +
        'rewrite the specifier) are separable by design — this entry stands with the second done. ' +
        'Dropping `fk_product_attributes_custom_field_definition` would retire it too, and would ' +
        'cost the invariant the constraint buys.',
    },
  'modules/catalog/services/catalog-admin.service.ts:sql:carts/cart_items':
    'Issue #187 seed — `assertProductDeletable` refuses a product delete that would ' +
    'orphan a cart line, and it asks with `knex(\'cart_items\').where({ product_id }).' +
    'count()`. A knex builder names its table as a call argument, so this crossed the ' +
    'boundary while naming no import specifier and no SQL statement. Note the direction ' +
    'the remedy cannot take: `carts` already declares `catalog`, so `catalog` declaring ' +
    '`carts` would close a cycle `module-graph.test.ts` fails on. Retired by: `carts` ' +
    'answering "does anything of mine reference this product?" itself — either a veto on ' +
    'a `product.delete.requested` event, or the acknowledged reverse port edge D-94.3 ' +
    'establishes for exactly this shape.',
  'modules/catalog/services/catalog-admin.service.ts:sql:orders/order_items':
    'Issue #187 seed — the twin of the `cart_items` entry above, in the same method: ' +
    '`assertProductDeletable` counts `orders`\' `order_items` with a knex builder before ' +
    'letting a product go. `orders` already declares `catalog`, so the same cycle rules ' +
    'out the obvious dependency direction. Retired by: `orders` answering the reference ' +
    'question itself, through the same veto or acknowledged reverse edge the `carts` half ' +
    'takes — the two are one decision and should be cut together.',
  'modules/catalog/services/catalog-quick-search.service.ts:sql:kernel/sales_channel_products':
    'D-87 seed, added at rebase — this site did not exist when the sweep ran. It arrived ' +
    'with `cb5be278`, the #174 fix that moved the quick-order type-ahead out of ' +
    '`quick_order` and into its owner and gave it the channel scoping it had never had: ' +
    'before that commit the query filtered neither visibility, nor organization, nor ' +
    'channel, so a buyer saw every active product. So this entry records a boundary that ' +
    'is now crossed *correctly* rather than one that is new debt — the scoping is applied, ' +
    'and what remains is that it is applied by hand against the bridge. It is the one ' +
    'member of the six-site family issue #185 did not retire, and the difference is the ' +
    'shape of the read rather than a smaller appetite: the other five narrow a **bounded ' +
    'set of ids** the caller already holds, which is exactly ' +
    '`SalesChannelMembershipPort.filterEntityIdsInChannel`, while this one *joins* the ' +
    'bridge inside a text-predicate query whose candidate set is unbounded until the join ' +
    'and the `limit` have been applied together. Neither published method can express that: ' +
    '`listEntityIdsForChannel` would pull every product in the channel per keystroke, and ' +
    'filtering an already-limited page would silently return fewer hits than the caller ' +
    'asked for. Retired by: an accessor that can carry the membership predicate into ' +
    'another query — a channel-scoped id stream the caller can page, or the port answering ' +
    'the type-ahead itself — which is a kernel decision rather than a call-site rewrite.',
};
