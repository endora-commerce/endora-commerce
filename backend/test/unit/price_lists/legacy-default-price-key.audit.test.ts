import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T103 — guardrail audit.
 *
 * The legacy `attributeValues.defaultPrice` (and the older
 * `attributeValues.price`) JSONB keys on Product are decommissioned
 * by feature 011 / migration 031: every read site should consume the
 * resolver via `PricingService.resolveEngine` instead. Migration 031
 * is intentionally additive — the legacy keys keep working until
 * every reader is swapped (T076 + a follow-up migration that strips
 * the columns) — but no NEW occurrence should land outside this
 * allowlist.
 *
 * The allowlist is the inventory at the time the test was added; new
 * lines force the author to either add a justification here or
 * migrate the call site to the resolver.
 */

const ALLOW = new Set<string>([
  // Migration helper itself — strips the legacy keys; the references
  // are fundamental to the migration logic.
  'backend/src/modules/price_lists/migrations/031_price_lists_engine.ts',
  'backend/src/modules/price_lists/services/default-price-list-migration.ts',

  // Resolver foundation path. The new resolveEngine pipeline is
  // additive; the legacy resolvePrice still feeds the old cart-service
  // until T076 lands.
  'backend/src/modules/price_lists/services/pricing-service.ts',

  // Catalog projection layer — feeds storefront ProductSummary.price
  // until T076 swaps the consumer side. catalog-query is the read
  // path; product-link mirrors the same projection on cross-sell
  // payloads.
  'backend/src/modules/catalog/services/catalog-query.service.ts',
  'backend/src/modules/catalog/services/product-link.service.ts',

  // Cart-service still reads the legacy key for line pricing — T076.
  'backend/src/modules/carts/services/cart-service.ts',

  // Comparison + search projections mirror the same fallback as
  // catalog-query; they will swap to the resolver alongside T076.
  'backend/src/modules/comparisons/services/comparison-service.ts',
  'backend/src/modules/search/services/search-query.service.ts',

  // Dev seed populates the legacy key so existing dev catalogs stay
  // useful before migration 031 promotes them to brackets.
  'backend/src/modules/catalog/seeds/dev-catalog-seed.ts',

  // Admin Product editor still reads/writes the legacy default price
  // input. T076 + the contract migration will retire it.
  'admin/src/modules/catalog/ProductEditor.tsx',

  // Storefront fallback path — only a comment (string match).
  'storefront/components/ProductCard.tsx',
]);

const REPO_ROOT = resolve(__dirname, '../../../..');
const PATTERN = "attributeValues\\['defaultPrice'\\]\\|attributeValues\\['price'\\]\\|attributeValues\\.defaultPrice\\|attributeValues\\.price\\b";

describe('legacy attributeValues.defaultPrice / .price audit (T103)', () => {
  it('every occurrence of the legacy keys is on the allowlist', () => {
    let raw: string;
    try {
      raw = execSync(
        `grep -rn "${PATTERN}" backend/src admin/src storefront/lib storefront/components storefront/app 2>/dev/null || true`,
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
    } catch {
      raw = '';
    }
    const offenders: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const file = line.split(':')[0]!;
      if (!ALLOW.has(file)) offenders.push(line);
    }
    expect(
      offenders,
      `New uses of attributeValues['defaultPrice'] / attributeValues['price'] must either swap to PricingService.resolveEngine() or be added to the allowlist in this file:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
