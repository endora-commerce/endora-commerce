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
  'backend/src/modules/price_lists/migrations/20260504T125655_price_lists_engine.ts',
  'backend/src/modules/price_lists/services/default-price-list-migration.ts',

  // Issue #132 — the one read of the legacy keys on any *serving* path, and it
  // belongs to the module that owns pricing. It is the second step of the
  // product ruling's chain (applicable list → the Product's own price →
  // nothing), so the catalogue, search, comparisons and product links no
  // longer read the keys at all: they ask this module and render its answer.
  'backend/src/modules/price_lists/services/listing-price-chain.ts',

  // Cart-service keeps the legacy reader as a foundation fallback for
  // composition rigs that don't wire pricingService (T076 made the
  // dependency optional).
  'backend/src/modules/carts/services/cart-service.ts',

  // External order intake (feature 062) mirrors cart-service's fallback in
  // its PRICE_UNAVAILABLE probe so a product the org's buyer can put in a
  // cart is never refused by the API surface; migrates together with
  // cart-service when the legacy keys are stripped.
  'backend/src/modules/orders/services/order-api-intake-service.ts',

  // Dev seed comment only — the seed itself now invokes the engine
  // migrator (T011) and writes no legacy rows.
  'backend/src/seeds/dev-catalog-seed.ts',

  // Admin Product editor still reads/writes the legacy default price
  // input. The contract migration will retire it.
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
