import type { EntityManager } from '@mikro-orm/postgresql';
import type { Mailer } from '../../email/services/mailer.js';
import type { EventBus } from '../../../events/bus.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
import { z } from 'zod';
import { Product } from '../../catalog/entities/product.entity.js';
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

interface AdjustedPayload {
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
    private readonly mailer: Mailer,
    private readonly settingsService?: SettingsService,
    /** Channel id used to read inventory settings — typically the
     *  system default. */
    private readonly settingsChannelId?: string,
    private readonly templateEmail?: InventoryTemplateEmailPort,
  ) {}

  attach(eventBus: EventBus): void {
    eventBus.on('inventory.adjusted.v1', (payload) => {
      const cast = payload as unknown as AdjustedPayload;
      void this.handleAdjusted(cast);
    });
  }

  async listLowStock(): Promise<LowStockSummaryRow[]> {
    const em = this.emFactory();
    const knex = em.getKnex();
    const rows = (await knex('stock_levels')
      .select('product_id')
      .sum({ on_hand: 'on_hand' })
      .groupBy('product_id')) as Array<{ product_id: string; on_hand: string | null }>;
    if (rows.length === 0) return [];

    const productIds = rows.map((r) => r.product_id);
    const products = await em.find(
      Product,
      { id: { $in: productIds } },
      { fields: ['id', 'sku', 'name', 'manageStock', 'lowStockThreshold'] },
    );
    const productById = new Map(products.map((p) => [p.id, p]));
    const result: LowStockSummaryRow[] = [];
    for (const row of rows) {
      const p = productById.get(row.product_id);
      if (!p) continue;
      if (!(p.manageStock ?? true)) continue;
      const threshold = p.lowStockThreshold;
      if (threshold === null || threshold === undefined) continue;
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

  private async handleAdjusted(payload: AdjustedPayload): Promise<void> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: payload.productId });
    if (!product || !(product.manageStock ?? true)) return;
    const threshold = product.lowStockThreshold;
    if (threshold === null || threshold === undefined) return;

    // Recompute cumulative across all warehouses (the event payload only
    // carries one warehouse's delta). before/after for the cumulative
    // crossing is `cumulativeBefore = (newCumulative - delta)`.
    const knex = em.getKnex();
    const sumRow = await knex('stock_levels')
      .where('product_id', product.id)
      .sum<{ on_hand: string | null }[]>('on_hand as on_hand')
      .first();
    const cumulativeAfter = Number(sumRow?.on_hand ?? 0);
    const cumulativeBefore = cumulativeAfter - (payload.after - payload.before);

    if (cumulativeBefore > threshold && cumulativeAfter <= threshold) {
      await this.fireEmail(product, cumulativeAfter, threshold);
    }
  }

  private async fireEmail(
    product: Product,
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
    await this.mailer.send({
      messageId,
      to: recipient,
      subject: `Low stock: ${productName}`,
      text: `Cumulative on-hand for "${productName}" (SKU ${product.sku}) has crossed the low-stock threshold.\n\n  Current cumulative on-hand: ${cumulative}\n  Threshold: ${threshold}\n`,
      meta,
    });
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
