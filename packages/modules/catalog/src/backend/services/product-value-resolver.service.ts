import type { EntityManager } from '@mikro-orm/postgresql';
import {
  resolveAttribute,
  resolveAll,
  type AttributeDef,
  type OverrideRow,
  type Resolved,
  type ResolveAllResult,
  type LanguageReadPort,
  type ResolverContext,
  type ScopeLevel,
} from '@endora-commerce/contracts';

import type { Product } from '../entities/product.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import type { CatalogAttributeReadService } from './catalog-attribute-read.service.js';
import {
  SYSTEM_ATTRIBUTE_SCOPES,
  type SystemAttributeKey,
} from './system-attribute-scopes.js';

/**
 * The one read of `product_value_overrides`: every override row for a set of
 * products, in one statement, bucketed by product id. `channelId` narrows the
 * read to one sales channel's rows — what a storefront read needs (issue #384);
 * without it every channel's rows come back, as the admin scope editor needs.
 */
export async function loadOverridesByProduct(
  em: EntityManager,
  args: { productIds: readonly string[]; channelId?: string },
): Promise<Map<string, OverrideRow[]>> {
  const out = new Map<string, OverrideRow[]>();
  if (args.productIds.length === 0) return out;
  const rows = await em.find(ProductValueOverride, {
    productId: { $in: [...new Set(args.productIds)] },
    ...(args.channelId !== undefined ? { channelId: args.channelId } : {}),
  });
  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    list.push({
      attributeKey: r.attributeKey,
      channelId: r.channelId,
      languageCode: r.languageCode ?? null,
      value: r.value,
    });
    out.set(r.productId, list);
  }
  return out;
}

/**
 * Feature 022 — backend wrapper around the pure resolver in
 * `@endora-commerce/contracts`. Handles the EM-side concerns:
 *   - fetching the override map for a product in a single SELECT,
 *   - assembling AttributeDefs for the system + user-defined attrs,
 *   - resolving the platform's primary admin language.
 *
 * The actual fallback-chain logic lives in `@endora-commerce/contracts` so the
 * admin SPA imports the same code (guaranteeing server / client
 * agreement — SC-004).
 */
export class ProductValueResolverService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly languageService: LanguageReadPort,
    /** Feature 061 — composed attribute read model (scope lookups). */
    private readonly attributeRead?: CatalogAttributeReadService,
  ) {}

  /** Load every override row for a product — every channel's — in one query. */
  async loadOverrides(productId: string): Promise<OverrideRow[]> {
    const byProduct = await loadOverridesByProduct(this.emFactory(), { productIds: [productId] });
    return byProduct.get(productId) ?? [];
  }

  /** Resolve the platform's primary admin language. */
  async getPrimaryAdminLanguage(): Promise<string> {
    const def = await this.languageService.getDefault();
    if (def) return def.code;
    const actives = await this.languageService.listActive();
    return actives[0]?.code ?? 'en';
  }

  /**
   * Build a ResolverContext from a (channelId, languageCode) pair,
   * filling in the primary admin language.
   */
  async makeContext(
    channelId: string | null,
    languageCode: string | null,
  ): Promise<ResolverContext> {
    // Feature 168 — no primary language any more: the Global value is one value (FR-014).
    return { channelId, languageCode };
  }

  /**
   * Resolve every attribute for the given product in one pass: system
   * Name + Description plus every user-defined attribute defined in the
   * `product_attributes` table whose value is present in
   * `attribute_values` JSONB (or every row in the assigned set, see
   * below).
   *
   * For simplicity this implementation walks the union of (a) the
   * product's `attributeValues` keys and (b) `SYSTEM_ATTRIBUTE_SCOPES`.
   * Attributes defined in the assigned `AttributeSet` but currently
   * empty are skipped — the admin UI re-introduces them when binding
   * fields. The resolver tolerates empty inputs gracefully.
   */
  async resolveForProduct(
    product: Product,
    ctx: ResolverContext,
  ): Promise<ResolveAllResult> {
    const overrides = await this.loadOverrides(product.id);
    const userAttrKeys = Object.keys(product.attributeValues ?? {});

    // Look up user-defined attribute metadata through the composed view
    // (feature 061 — the key/scope pair spans definition + extension).
    if (!this.attributeRead) {
      throw new Error(
        'ProductValueResolverService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    const wantedKeys = new Set(userAttrKeys);
    const userAttrRows =
      userAttrKeys.length === 0
        ? []
        : (await this.attributeRead.listAll()).filter((v) => wantedKeys.has(v.key));
    const userAttrByKey = new Map(userAttrRows.map((r) => [r.key, r]));

    const defs: AttributeDef[] = [];

    // System attributes — their baseline lives directly on the product.
    for (const sysKey of Object.keys(SYSTEM_ATTRIBUTE_SCOPES) as SystemAttributeKey[]) {
      const baseline =
        sysKey === 'name' ? product.name : sysKey === 'description' ? product.description : null;
      defs.push({
        attributeKey: sysKey,
        levels: ['G', 'C', 'CL'],
        baseline,
      });
    }

    // User-defined attributes — baseline is product.attributeValues[key].
    for (const key of userAttrKeys) {
      const row = userAttrByKey.get(key);
      defs.push({
        attributeKey: key,
        levels: row ? row.scopeLevels : ['G'],
        baseline: (product.attributeValues as Record<string, unknown>)[key],
      });
    }

    return resolveAll(defs, overrides, ctx);
  }

  /**
   * Resolve a single attribute. Convenience for handlers that only need
   * Name or Description (e.g., the public PDP route).
   */
  resolveOne(args: {
    baseline: unknown;
    overrides: readonly OverrideRow[];
    attributeKey: string;
    levels: readonly ScopeLevel[];
    ctx: ResolverContext;
  }): Resolved {
    return resolveAttribute(args);
  }
}
