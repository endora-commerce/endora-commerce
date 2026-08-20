import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ERROR_CODES,
  listingPriceMoney,
  type AssetReadPort,
  type ListingPricePort,
  type OrganizationDetailsPort,
  type ProductAudience,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import type { CommandBus } from '../../../commands/index.js';
import { Product } from '../entities/product.entity.js';
import { ProductLink, type ProductLinkKind } from '../entities/product-link.entity.js';
import { resolvePrimaryAssetUrls } from './primary-asset-url.js';
import { viewerOrganizationFor } from './viewer-organization.js';
interface StorefrontContext {
  /**
   * The request's resolved sales channel (feature 053 / FR-002). Always
   * present — the canonical resolver guarantees a concrete channel — so
   * cross/up-sell filtering is unconditional and fails closed (Principle XII).
   * `isPublic` is the price-visibility flag, and `defaultCurrency` is the
   * currency the link tiles quote in — it used to be the literal `'PLN'`, which
   * mislabelled every amount on a channel trading in anything else.
   */
  resolvedChannel: {
    id: string;
    code: string;
    isPublic: boolean;
    defaultCurrency: string;
  };
  /**
   * Who is asking. A cross-sell tile is a card with an Add-to-cart on it, and
   * the cart line it leads to is priced for the buyer's organisation — so a
   * strip quoting the channel price beside a listing quoting the buyer's would
   * put two prices for two products on one page, arrived at two different ways.
   *
   * **Required, not defaulted**, for the reason `CatalogQueryContext` states:
   * the safe default is the anonymous audience, and a caller that forgot to
   * resolve its viewer would then quietly quote every buyer the channel price
   * — a defect that reads as "the negotiated list does not work" and is found
   * by nobody. Both call sites pass it; `tsc` names a third.
   *
   * It is read for the **price** and not, today, for the tile's visibility:
   * `listForStorefront` filters by status and channel membership and has never
   * applied `isProductVisibleTo`, which is issue #227 residue this change does
   * not close. Do not read the presence of this field as the entitlement
   * question having been answered here.
   */
  audience: ProductAudience;
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
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits product-link writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /**
     * Issue #132 — the pricing engine, through the `pricingService` port. A
     * related-product tile is a listing: it prices through the same chain as the
     * catalogue grid, not off the catalogue's legacy default-price attribute.
     */
    private readonly listingPrices?: ListingPricePort,
    /**
     * Feature 075 — `assets_library`'s read port. The two `join assets` clauses
     * this service used to write are gone; the tile's image is resolved by the
     * shared `resolvePrimaryAssetUrls` helper, which asks the owner for the
     * asset row and keeps the bridge query on this module's own tables.
     */
    private readonly assets?: AssetReadPort,
    /**
     * Issue #185 — the kernel's channel-membership accessor. The storefront
     * link read below asked `sales_channel_products` in raw SQL, which crosses
     * the boundary while naming no import specifier and is the read
     * Constitution XII reserves to this service.
     *
     * Optional only in the signature, like the two above; a link read that
     * reaches it unwired fails loudly rather than quietly answering the
     * cross-channel set.
     */
    private readonly channelMembership?: SalesChannelMembershipPort,
    /**
     * `organizations`' read model — the customer group a group-targeted price
     * list is selected by, which lives on the organisation row. Optional only
     * in the signature, and never reached by an anonymous strip.
     */
    private readonly organizationDetails?: OrganizationDetailsPort,
  ) {}

  #requireOrganizationDetails(): OrganizationDetailsPort {
    if (!this.organizationDetails) {
      throw new Error(
        'ProductLinkService: the organization read port is not wired — a signed-in buyer cannot be priced.',
      );
    }
    return this.organizationDetails;
  }

  #requireChannelMembership(): SalesChannelMembershipPort {
    if (!this.channelMembership) {
      throw new Error(
        'ProductLinkService: the channel-membership port is not wired — link tiles cannot be ' +
          'scoped to a channel without leaking the cross-channel set.',
      );
    }
    return this.channelMembership;
  }

  #requireAssets(): AssetReadPort {
    if (!this.assets) {
      throw new Error(
        'ProductLinkService: the asset read port is not wired — link tiles cannot show an image.',
      );
    }
    return this.assets;
  }

  #requireListingPrices(): ListingPricePort {
    if (!this.listingPrices) {
      throw new Error(
        'ProductLinkService: the pricing port is not wired — link tiles cannot be priced.',
      );
    }
    return this.listingPrices;
  }

  /** Feature 054 — run a product-link write through the Command Bus. */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType: 'product_link', objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

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

    const created = await this.#audited('product_link.bulk_create', sourceProductId, async (cem) => {
      const rows: ProductLink[] = [];
      for (const input of inputs) {
        const explicit = input.position;
        const next = (nextPositionByKind.get(input.kind) ?? -1) + 1;
        const position = explicit !== undefined ? explicit : next;
        nextPositionByKind.set(input.kind, position);
        rows.push(
          cem.create(ProductLink, {
            sourceProductId,
            targetProductId: input.targetProductId,
            kind: input.kind,
            position,
          }),
        );
      }
      await cem.flush();
      return { result: rows, before: null, after: { sourceProductId, count: rows.length } };
    });
    return created.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId,
      targetProductId: r.targetProductId,
      kind: r.kind,
      position: r.position,
    }));
  }

  async removeLink(sourceProductId: string, linkId: string): Promise<void> {
    await this.#audited('product_link.delete', linkId, async (em) => {
      const link = await em.findOne(ProductLink, { id: linkId, sourceProductId });
      if (!link) {
        throw new HttpError(
          404,
          ERROR_CODES.PRODUCT_LINK_NOT_FOUND,
          `Link "${linkId}" not found on source ${sourceProductId}.`,
        );
      }
      const before = { sourceProductId, targetProductId: link.targetProductId, kind: link.kind };
      em.remove(link);
      return { result: undefined, before, after: null };
    });
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

    // Feature 053 (FR-006 / Principle XII) — sales-channel visibility. The
    // channel is resolved once upstream (`getResolvedChannel()`) and handed in;
    // the membership filter is ALWAYS applied, failing closed to an empty
    // visible set rather than leaking the full cross-channel target set.
    // Through the kernel's accessor since issue #185: this was a `select
    // product_id from sales_channel_products` written here, which is the one
    // read Principle XII names the membership service for.
    const channel = ctx.resolvedChannel;
    const visibleIds =
      targets.length > 0
        ? new Set(
            await this.#requireChannelMembership().filterEntityIdsInChannel(
              channel.id,
              'product',
              targets.map((t) => t.id),
            ),
          )
        : // No targets → nothing is visible (fail closed).
          new Set<string>();

    // Primary asset urls: the gallery thumb chain, with the legacy
    // `product_assets` fallback. Shared with `CatalogQueryService` so the chain
    // and the `assets_library` port call have one home.
    const assetUrlByProductId = await resolvePrimaryAssetUrls(
      em,
      this.#requireAssets(),
      targetIds,
    );

    // Sales-channel public flag controls price visibility (R-18), read off the
    // resolved channel handed in by the route. A channel that withholds prices
    // is not asked for them (issue #132).
    const visibleTargets = rows
      .filter((link) => visibleIds.has(link.targetProductId))
      .map((link) => byId.get(link.targetProductId))
      .filter((target): target is Product => target !== undefined);
    const viewerOrganization =
      ctx.audience.organizationId === null
        ? null
        : await viewerOrganizationFor(this.#requireOrganizationDetails(), ctx.audience);
    const resolvedPrices =
      ctx.resolvedChannel.isPublic && visibleTargets.length > 0
        ? await this.#requireListingPrices().resolveListingPrices({
            products: visibleTargets,
            context: {
              salesChannel: {
                id: ctx.resolvedChannel.id,
                defaultCurrency: ctx.resolvedChannel.defaultCurrency,
              },
              organization: viewerOrganization,
            },
          })
        : new Map();

    const out: StorefrontLinkSummary[] = [];
    for (const link of rows) {
      if (!visibleIds.has(link.targetProductId)) continue;
      const target = byId.get(link.targetProductId);
      if (!target) continue;
      const name = pickLang(target.name, ctx.preferredLanguage);
      const resolved = resolvedPrices.get(target.id);
      const price = resolved === undefined ? null : listingPriceMoney(resolved);
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
    await this.#audited('product_link.reorder', sourceProductId, async (em) => {
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
        const link = byId.get(linkIds[i]!)!;
        link.position = i;
      }
      return { result: undefined, before: null, after: { sourceProductId, kind, count: linkIds.length } };
    });
  }
}
