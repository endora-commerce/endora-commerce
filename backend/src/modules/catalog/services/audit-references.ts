import type { AuditReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../entities/product.entity.js';

/**
 * What a `product` audit row is called, and where the admin app shows it
 * (feature 075, D-87 drain).
 *
 * `audit_logs` used to run `select id, sku, name from products` for its
 * dashboard card and spell `/catalog/products/{id}` into its own switch
 * statement — a reader naming this module's table and this module's admin route.
 * Both are answered here now, over this module's own entity.
 */
export function registerCatalogAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'catalog',
    referenceType: 'product',
    resolve: async (ids) => {
      const rows = await emFactory().find(
        Product,
        { id: { $in: [...ids] } },
        { fields: ['id', 'sku', 'name'] },
      );
      return rows.map((row) => ({
        id: row.id,
        // The SKU is the fallback rather than a second field: a product with no
        // translated name still has to render as something an operator
        // recognises, and the audit card has one line to do it in.
        label: pickTranslation(row.name) ?? row.sku,
        url: `/catalog/products/${row.id}`,
      }));
    },
  });
}

/**
 * The language fallback chain the audit card has always used. Kept in that order
 * deliberately — moving `en-US` ahead of `en` would silently re-label existing
 * rows on a deployment that stores both.
 */
function pickTranslation(
  value: Record<string, string> | string | null | undefined,
): string | null {
  if (!value) return null;
  // Pre-multilingual rows stored a bare string. `Object.values` over one yields
  // its characters, so the guard is what stops a name rendering as `E`.
  if (typeof value === 'string') return value.length > 0 ? value : null;
  for (const key of ['en', 'en-US', 'pl', 'pl-PL']) {
    const v = value[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(value)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
