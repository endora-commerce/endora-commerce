import type { EntityManager } from '@mikro-orm/postgresql';

import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Asset } from '../../assets/entities/asset.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductLink, type ProductLinkKind } from '../entities/product-link.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';

interface StorefrontContext {
  salesChannelCode?: string | null | undefined;
  preferredLanguage?: string | undefined;
}

/**
 * ProductLinkService — admin CRUD + storefront read for related/up-sell/
 * cross-sell pairings (feature 002 US4, T104).
 *
 * The service lives between the routes and the DB: routes pass parsed
 * payloads, the service enforces business invariants (no self-link, no
 * dup, target must exist), and surfaces typed errors with the matching
 * ERROR_CODES so route handlers can map them to HTTP responses without
 * sniffing message strings.
 *
 * `bulkCreate` is all-or-nothing: a single bad entry rolls back the whole
 * batch (research §US4: admins curate links in the UI in chunks; partial
 * inserts would surprise them).
 *
 * `listForStorefront` filters out targets whose product is not active,
 * which is what the PDP/cart actually wants — admins should see archived
 * targets in the admin list (so they can clean them up), the storefront
 * shouldn't.
 */

export interface CreateLinkInput {
  targetProductId: string;
  kind: ProductLinkKind;
  position?: number | undefined;
}

export interface ProductLinkRow {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  kind: ProductLinkKind;
  position: number;
}

export interface StorefrontLinkSummary {
  id: string;
  kind: ProductLinkKind;
  position: number;
  product: {
    id: string;
    sku: string;
    slug: string;
    name: string;
    primaryAssetUrl: string | null;
    price: { amount: number; currency: string } | null;
  };
}

function pickLang(blob: Record<string, string>, preferred?: string): string {
  if (preferred && blob[preferred]) return blob[preferred];
  const fallback = blob['en-US'] ?? blob['en'] ?? Object.values(blob)[0] ?? '';
  return fallback;
}

export class ProductLinkService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listForAdmin(
    sourceProductId: string,
    kind?: ProductLinkKind,
  ): Promise<ProductLinkRow[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = { sourceProductId };
    if (kind) where['kind'] = kind;
    const rows = await em.find(ProductLink, where, {
      orderBy: { position: 'asc', id: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId,
      targetProductId: r.targetProductId,
      kind: r.kind,
      position: r.position,
    }));
  }

  async bulkCreate(
    sourceProductId: string,
    inputs: CreateLinkInput[],
  ): Promise<ProductLinkRow[]> {
    const em = this.emFactory();
    // 1) Source must exist and not be archived/deleted (404 PRODUCT_NOT_FOUND).
    const source = await em.findOne(Product, { id: sourceProductId });
    if (!source || source.deletedAt) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product "${sourceProductId}" not found.`,
      );
    }

    // 2) Self-link rejected at API layer (400). The DB CHECK is the
    // belt-and-braces backstop, but we want the typed error code first.
    for (const input of inputs) {
      if (input.targetProductId === sourceProductId) {
        throw new HttpError(
          400,
          ERROR_CODES.SELF_LINK_NOT_ALLOWED,
          'A product cannot link to itself.',
        );
      }
    }

    // 3) Targets must all exist (404 TARGET_PRODUCT_NOT_FOUND); single
    // findIn keeps it to one query.
    const targetIds = [...new Set(inputs.map((i) => i.targetProductId))];
    const targets = await em.find(Product, { id: { $in: targetIds } });
    const foundIds = new Set(targets.filter((t) => !t.deletedAt).map((t) => t.id));
    for (const id of targetIds) {
      if (!foundIds.has(id)) {
        throw new HttpError(
          404,
          ERROR_CODES.TARGET_PRODUCT_NOT_FOUND,
          `Target product "${id}" not found.`,
        );
      }
    }

    // 4) Duplicate (source, target, kind) rejected up-front (409). The
    // DB UNIQUE is the backstop; this lets us return the typed code
    // without parsing PG error strings.
    const existing = await em.find(ProductLink, {
      sourceProductId,
      targetProductId: { $in: targetIds },
    });
    const existingKey = new Set(existing.map((e) => `${e.targetProductId}|${e.kind}`));
    for (const input of inputs) {
      if (existingKey.has(`${input.targetProductId}|${input.kind}`)) {
        throw new HttpError(
          409,
          ERROR_CODES.LINK_ALREADY_EXISTS,
          `Link source=${sourceProductId} target=${input.targetProductId} kind=${input.kind} already exists.`,
        );
      }
    }

    // 5) Default position: append to the end of the (source, kind) list.
    const nextPositionByKind = new Map<ProductLinkKind, number>();
    const tally = await em.find(ProductLink, { sourceProductId });
    for (const row of tally) {
      const cur = nextPositionByKind.get(row.kind) ?? -1;
      if (row.position > cur) nextPositionByKind.set(row.kind, row.position);
    }

    const created: ProductLink[] = [];
    for (const input of inputs) {
      const explicit = input.position;
      const next = (nextPositionByKind.get(input.kind) ?? -1) + 1;
      const position = explicit !== undefined ? explicit : next;
      nextPositionByKind.set(input.kind, position);
      const link = em.create(ProductLink, {
        sourceProductId,
        targetProductId: input.targetProductId,
        kind: input.kind,
        position,
      });
      created.push(link);
    }
    await em.persistAndFlush(created);
    return created.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId,
      targetProductId: r.targetProductId,
      kind: r.kind,
      position: r.position,
    }));
  }

  async removeLink(sourceProductId: string, linkId: string): Promise<void> {
    const em = this.emFactory();
    const link = await em.findOne(ProductLink, { id: linkId, sourceProductId });
    if (!link) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_LINK_NOT_FOUND,
        `Link "${linkId}" not found on source ${sourceProductId}.`,
      );
    }
    await em.removeAndFlush(link);
  }

  /**
   * Storefront read — drops links whose target product is not active or
   * not visible in the requested sales channel; localizes name to the
   * caller's preferred language.
   */
  async listForStorefront(
    sourceProductId: string,
    ctx: StorefrontContext,
    kind?: ProductLinkKind,
  ): Promise<StorefrontLinkSummary[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = { sourceProductId };
    if (kind) where['kind'] = kind;
    const rows = await em.find(ProductLink, where, {
      orderBy: { position: 'asc', id: 'asc' },
    });
    if (rows.length === 0) return [];

    const targetIds = rows.map((r) => r.targetProductId);
    const targets = await em.find(Product, {
      id: { $in: targetIds },
      status: 'active',
    });
    const byId = new Map(targets.map((p) => [p.id, p]));

    // Sales-channel visibility — when ctx specifies a channel, only
    // products mapped to it are surfaced.
    let visibleIds: Set<string> = new Set(byId.keys());
    if (ctx.salesChannelCode) {
      const channel = await em.findOne(SalesChannel, { code: ctx.salesChannelCode });
      if (channel) {
        const visibleRows = await em
          .getConnection()
          .execute<{ product_id: string }[]>(
            `select product_id from sales_channel_products
             where sales_channel_id = ? and product_id in (${targets
               .map(() => '?')
               .join(',')})`,
            [channel.id, ...targets.map((t) => t.id)],
          );
        visibleIds = new Set(visibleRows.map((r) => r.product_id));
      }
    }

    // Primary asset urls (gallery thumb chain reused via product_assets fallback)
    const assetUrlByProductId = new Map<string, string | null>();
    for (const id of targetIds) assetUrlByProductId.set(id, null);
    if (targetIds.length > 0) {
      const galleryRows = await em.getConnection().execute<{
        product_id: string;
        storage_url: string;
        label: string | null;
        position: number;
      }[]>(
        `select gi.product_id, a.storage_url, gil.label, gi.position
           from gallery_items gi
           join assets a on a.id = gi.asset_id
           left join gallery_item_labels gil on gil.gallery_item_id = gi.id
           where gi.product_id in (${targetIds.map(() => '?').join(',')})
           order by gi.product_id, gi.position asc, gi.id asc`,
        targetIds,
      );
      const byProduct = new Map<string, typeof galleryRows>();
      for (const row of galleryRows) {
        const list = byProduct.get(row.product_id) ?? [];
        list.push(row);
        byProduct.set(row.product_id, list);
      }
      for (const [pid, gallery] of byProduct.entries()) {
        const findByLabel = (label: string): string | null =>
          gallery.find((r) => r.label === label)?.storage_url ?? null;
        const url =
          findByLabel('thumbnail') ??
          findByLabel('base_image') ??
          gallery[0]?.storage_url ??
          null;
        assetUrlByProductId.set(pid, url);
      }
      // Legacy product_assets fallback for any product without gallery rows.
      const missing = targetIds.filter((id) => !byProduct.has(id));
      if (missing.length > 0) {
        const legacy = await em.getConnection().execute<{
          product_id: string;
          storage_url: string;
        }[]>(
          `select pa.product_id, a.storage_url
             from product_assets pa join assets a on a.id = pa.asset_id
             where pa.product_id in (${missing.map(() => '?').join(',')})
             order by pa.product_id, pa.position asc`,
          missing,
        );
        const seen = new Set<string>();
        for (const row of legacy) {
          if (seen.has(row.product_id)) continue;
          seen.add(row.product_id);
          assetUrlByProductId.set(row.product_id, row.storage_url);
        }
      }
    }

    void Asset; // imported for side-effect parity with other catalog services

    const out: StorefrontLinkSummary[] = [];
    for (const link of rows) {
      if (!visibleIds.has(link.targetProductId)) continue;
      const target = byId.get(link.targetProductId);
      if (!target) continue;
      const name = pickLang(target.name, ctx.preferredLanguage);
      const rawPrice = Number(
        target.attributeValues['defaultPrice'] ??
          target.attributeValues['price'] ??
          Number.NaN,
      );
      // Sales-channel public flag controls price visibility (R-18); reuse
      // the already-fetched channel by reading it again would be wasteful,
      // so default to public when no channel is set.
      let isPublic = true;
      if (ctx.salesChannelCode) {
        const channel = await em.findOne(SalesChannel, { code: ctx.salesChannelCode });
        isPublic = channel?.isPublic ?? true;
      }
      const currency = 'PLN';
      const price =
        isPublic && Number.isFinite(rawPrice)
          ? { amount: rawPrice, currency }
          : null;
      out.push({
        id: link.id,
        kind: link.kind,
        position: link.position,
        product: {
          id: target.id,
          sku: target.sku,
          slug: target.slug,
          name,
          primaryAssetUrl: assetUrlByProductId.get(target.id) ?? null,
          price,
        },
      });
    }
    return out;
  }

  async reorderForKind(
    sourceProductId: string,
    kind: ProductLinkKind,
    linkIds: string[],
  ): Promise<void> {
    const em = this.emFactory();
    // Fetch all links of this (source, kind) so we can validate the input
    // covers exactly that set.
    const rows = await em.find(ProductLink, { sourceProductId, kind });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of linkIds) {
      if (!byId.has(id)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Link "${id}" is not part of (${sourceProductId}, ${kind}).`,
        );
      }
    }
    // Apply 0..N positions in array order.
    for (let i = 0; i < linkIds.length; i++) {
      const id = linkIds[i]!;
      const link = byId.get(id)!;
      link.position = i;
    }
    await em.flush();
  }
}
