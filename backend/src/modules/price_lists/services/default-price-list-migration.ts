import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../catalog/entities/product.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { PriceList } from '../entities/price-list.entity.js';
import { PriceListProduct } from '../entities/price-list-product.entity.js';
import { PriceListPriceBracket } from '../entities/price-list-price-bracket.entity.js';

/**
 * Default price list migration helper (feature 011 / US1, FR-002, FR-003,
 * research §R7).
 *
 * Surfaced as a callable service so:
 *   - migration `031` invokes it inline at upgrade time (preserved here),
 *   - an admin "repair" command can re-run it idempotently,
 *   - integration tests can re-seed `Default` after a truncate.
 *
 * Returns a structured report: how many products got fresh assignments, how
 * many bracket rows were written, and which products received an identity
 * copy across more than one currency (so administrators can revisit and set
 * proper per-currency values per Q3).
 */
export const DEFAULT_PRICE_LIST_ID = '00000000-0000-4000-8000-00000000d51b';

export interface MigrationReport {
  /** Products newly assigned to the Default list during this run. */
  productsAssigned: number;
  /** Bracket rows newly inserted during this run. */
  bracketRowsInserted: number;
  /** Products that ended up with > 1 currency bracket (multi-currency identity copy). */
  productsWithMultiCurrencyIdentityCopy: Array<{
    productId: string;
    currencies: string[];
    legacyAmount: string;
  }>;
  /** Products skipped because the legacy field was unparseable. */
  productsSkipped: Array<{ productId: string; reason: string }>;
}

export class DefaultPriceListMigrator {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Idempotent upsert of the seeded `Default` price list. Re-running is a
   * no-op when the row already exists. Used by both migration 031 and any
   * test fixture that truncates `price_lists` and needs to restore Default.
   */
  async seedDefault(): Promise<void> {
    // command-coverage-ignore: one-time system bootstrap that seeds the Default
    // price list at install/migration time — not an admin action.
    const em = this.emFactory();
    const existing = await em.findOne(PriceList, { id: DEFAULT_PRICE_LIST_ID });
    if (existing) {
      // Keep engine columns coherent if they were left unset on an older row.
      existing.name = 'Default';
      existing.type = 'base';
      existing.status = 'active';
      existing.applicationRule = { kind: 'all' };
      existing.isSystem = true;
      existing.modifiedAt = new Date();
      await em.flush();
      return;
    }
    const row = em.create(PriceList, {
      id: DEFAULT_PRICE_LIST_ID,
      code: 'default',
      name: 'Default',
      currency: 'PLN',
      isDefault: true,
      priority: 0,
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      isSystem: true,
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(row);
  }

  /**
   * Idempotent re-run of the legacy `attributeValues.defaultPrice` migration.
   * Re-runs are no-ops because every UPSERT keys on natural primary keys.
   * Does NOT strip the legacy `attributeValues.defaultPrice` / `price` keys
   * (per the expand→migrate→contract rollout — see Phase 2 strategy note in
   * tasks.md).
   *
   * Auto-seeds the Default row first so this method works against a fresh
   * test fixture that just truncated `price_lists`.
   */
  async run(): Promise<MigrationReport> {
    // command-coverage-ignore: one-time data migration (backfills the Default
    // price list + assignments) run at install/upgrade — not an admin action.
    await this.seedDefault();
    const em = this.emFactory();

    // Discover the currencies exposed by any sales channel + always include PLN
    // as the platform's default currency (matches migration 031's fallback).
    const channels = await em.find(SalesChannel, {});
    const currencies = new Set<string>(['PLN']);
    for (const ch of channels) {
      for (const c of ch.currencies ?? []) {
        if (typeof c === 'string' && c.length === 3) {
          currencies.add(c.toUpperCase());
        }
      }
    }

    // Discover legacy-priced products via the EM (sees uncommitted writes
    // inside the active transaction).
    const products = await em.find(Product, {});

    const skipped: MigrationReport['productsSkipped'] = [];
    const candidates: Array<{ productId: string; legacyAmount: string }> = [];
    for (const p of products) {
      const av = p.attributeValues as Record<string, unknown> | null;
      if (!av) continue;
      const raw = av['defaultPrice'] ?? av['price'];
      if (raw == null) continue;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        skipped.push({ productId: p.id, reason: 'legacy_price_invalid' });
        continue;
      }
      candidates.push({ productId: p.id, legacyAmount: amount.toFixed(4) });
    }

    let productsAssigned = 0;
    let bracketRowsInserted = 0;
    const multiCurrency: MigrationReport['productsWithMultiCurrencyIdentityCopy'] = [];
    const currencyList = [...currencies].sort();

    // Pass 1: assignments — flush before inserting brackets so the FK from
    // bracket → assignment is satisfied at insert time.
    for (const c of candidates) {
      const existingAssignment = await em.findOne(PriceListProduct, {
        priceListId: DEFAULT_PRICE_LIST_ID,
        productId: c.productId,
      });
      if (!existingAssignment) {
        em.create(PriceListProduct, {
          priceListId: DEFAULT_PRICE_LIST_ID,
          productId: c.productId,
        });
        productsAssigned += 1;
      }
    }
    await em.flush();

    // Pass 2: brackets per currency.
    for (const c of candidates) {
      for (const cur of currencyList) {
        const existingBracket = await em.findOne(PriceListPriceBracket, {
          priceListId: DEFAULT_PRICE_LIST_ID,
          productId: c.productId,
          currencyCode: cur,
          minQuantity: 1,
        });
        if (!existingBracket) {
          em.create(PriceListPriceBracket, {
            priceListId: DEFAULT_PRICE_LIST_ID,
            productId: c.productId,
            currencyCode: cur,
            minQuantity: 1,
            maxQuantity: null,
            amount: c.legacyAmount,
          });
          bracketRowsInserted += 1;
        }
      }

      if (currencyList.length > 1) {
        multiCurrency.push({
          productId: c.productId,
          currencies: currencyList,
          legacyAmount: c.legacyAmount,
        });
      }
    }
    await em.flush();

    return {
      productsAssigned,
      bracketRowsInserted,
      productsWithMultiCurrencyIdentityCopy: multiCurrency,
      productsSkipped: skipped,
    };
  }
}
