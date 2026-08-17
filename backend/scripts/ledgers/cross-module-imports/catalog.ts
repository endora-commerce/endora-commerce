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
  'modules/catalog/commands/attribute-commands.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:email/services/mailer':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/bulk-operation.service.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/bulk-operation.service.ts:email/services/mailer':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-admin.service.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-attribute-read.service.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-attribute-read.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-org-price-decorator.ts:organizations/entities/organization.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-org-price-decorator.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-query.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/category-admin.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/product-scope-context.service.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/product-value-resolver.service.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
};
