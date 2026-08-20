import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  CatalogProductRecord,
  EmailMailerPort,
} from '@b2b/contracts';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
import { z } from 'zod';
import { StockLevel } from '../entities/stock-level.entity.js';
import { INVENTORY_SETTING_CODES } from '../manifest.js';

/** Feature 047 — structural port for sending via the admin-editable templates. */
export interface InventoryTemplateEmailPort {
  trySend(input: {
    code: string;
    to: string;
    messageId: string;
    variables: Record<string, unknown>;
    meta?: Record<string, unknown> | undefined;
  }): Promise<boolean>;
}

export interface LowStockSummaryRow {
  productId: string;
  productSku: string;
  productName: string;
  cumulativeOnHand: number;
  lowStockThreshold: number;
}

export interface AdjustedPayload {
  productId: string;
  warehouseId: string;
  variantId: string | null;
  before: number;
  after: number;
}

/**
 * LowStockAlertService (US4 / FR-013).
 *
 * Listens for `inventory.adjusted.v1` and fires a single email per
 * crossing — that is, when *cumulative* on-hand for a product drops
 * from above the threshold to at-or-below it. The crossing detector
 * is platform-wide (not per-channel) because the recipient is a
 * single platform-side mailbox configured by
 * `inventory.low_stock_alert_recipient_email`.
 *
 * `listLowStock()` powers the admin Home Stock Alerts panel + the
 * dedicated `/inventory/low-stock` page.
 */
export class LowStockAlertService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly mailer: EmailMailerPort,
    /**
     * `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). The
     * crossing detector and the admin panel both need the product's SKU, name
     * and threshold, and both used to load the entity out of a table that is
     * still there when `catalog` is off — so a switched-off catalogue still
     * produced low-stock alerts about it.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly settingsService?: SettingsService,
    /** Channel id used to read inventory settings — typically the
     *  system default. */
    private readonly settingsChannelId?: string,
    private readonly templateEmail?: InventoryTemplateEmailPort,
  ) {}

  async listLowStock(): Promise<LowStockSummaryRow[]> {
    const em = this.emFactory();
    // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
    // connection, so the report would answer from outside a transaction the
    // caller holds open (issue #207).
    const rows = (await em.execute(
      `select product_id, sum(on_hand) as on_hand from stock_levels group by product_id`,
    )) as Array<{ product_id: string; on_hand: string | null }>;
    if (rows.length === 0) return [];

    const productIds = rows.map((r) => r.product_id);
    const products = await this.catalogProducts.findByIds(productIds);
    const productById = new Map(products.map((p) => [p.id, p]));
    const result: LowStockSummaryRow[] = [];
    for (const row of rows) {
      const p = productById.get(row.product_id);
      if (!p) continue;
      if (!p.manageStock) continue;
      const threshold = p.lowStockThreshold;
      if (threshold === null) continue;
      const cumulative = Number(row.on_hand ?? 0);
      if (cumulative > threshold) continue;
      const productName = p.name['en-US'] ?? Object.values(p.name)[0] ?? p.sku;
      result.push({
        productId: p.id,
        productSku: p.sku,
        productName: String(productName),
        cumulativeOnHand: cumulative,
        lowStockThreshold: threshold,
      });
    }
    return result;
  }

  /**
   * `inventory.adjusted.v1` — one e-mail per crossing of the product's low-stock
   * threshold. Registered in this module's `backend.ts` through `ctx.subscribe`,
   * so the alert stops with the module (issue #107); it used to be a bare
   * `eventBus.on` here, which kept mailing while `inventory` was switched off.
   */
  async handleAdjusted(payload: AdjustedPayload): Promise<void> {
    const em = this.emFactory();
    const product = await this.catalogProducts.findById(payload.productId);
    if (!product || !product.manageStock) return;
    const threshold = product.lowStockThreshold;
    if (threshold === null) return;

    // Recompute cumulative across all warehouses (the event payload only
    // carries one warehouse's delta). before/after for the cumulative
    // crossing is `cumulativeBefore = (newCumulative - delta)`.
    // `em.execute`, not `em.getKnex()` — same reason as the report above.
    const sumRows = (await em.execute(
      `select sum(on_hand) as on_hand from stock_levels where product_id = ?`,
      [product.id],
    )) as Array<{ on_hand: string | null }>;
    const cumulativeAfter = Number(sumRows[0]?.on_hand ?? 0);
    const cumulativeBefore = cumulativeAfter - (payload.after - payload.before);

    if (cumulativeBefore > threshold && cumulativeAfter <= threshold) {
      await this.fireEmail(product, cumulativeAfter, threshold);
    }
  }

  private async fireEmail(
    product: CatalogProductRecord,
    cumulative: number,
    threshold: number,
  ): Promise<void> {
    const recipient = await this.resolveRecipient();
    if (!recipient) return;
    const productName = product.name['en-US'] ?? Object.values(product.name)[0] ?? product.sku;
    const messageId = `inventory.low-stock:${product.id}:${Date.now()}`;
    const meta = { productId: product.id, cumulativeOnHand: cumulative, threshold };
    if (this.templateEmail) {
      const sent = await this.templateEmail.trySend({
        code: 'low_stock_alert',
        to: recipient,
        messageId,
        variables: {
          product: { name: productName, sku: product.sku },
          cumulativeOnHand: cumulative,
          threshold,
        },
        meta,
      });
      if (sent) return;
    }
    const outcome = await this.mailer.send({
      messageId,
      to: recipient,
      subject: `Low stock: ${productName}`,
      text: `Cumulative on-hand for "${productName}" (SKU ${product.sku}) has crossed the low-stock threshold.\n\n  Current cumulative on-hand: ${cumulative}\n  Threshold: ${threshold}\n`,
      kind: 'low_stock_alert',
      meta,
    });
    if (outcome.status !== 'sent') {
      // This fires from a crossing detector with no caller to answer, so the
      // non-send is named here and durable in D-59's record.
      console.warn('[inventory] the low-stock alert was not sent', {
        productId: product.id,
        reason: outcome.reason,
      });
    }
  }

  private async resolveRecipient(): Promise<string | null> {
    if (this.settingsService && this.settingsChannelId) {
      try {
        const value = await this.settingsService.get(
          INVENTORY_SETTING_CODES.LOW_STOCK_ALERT_RECIPIENT_EMAIL,
          this.settingsChannelId,
          z.string(),
        );
        if (value && value.trim().length > 0) return value.trim();
      } catch {
        // fall through
      }
    }
    return process.env['INVENTORY_LOW_STOCK_RECIPIENT'] ?? null;
  }

  /**
   * Stand-in helper used by tests + the StockLevel mutation paths to
   * satisfy the unused-stock entity import. Removing it would risk
   * the pruner stripping the import in incremental builds.
   */
  static getStockLevelEntity(): typeof StockLevel {
    return StockLevel;
  }
}
