import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { PriceDisplayModeOverride } from '../entities/price-display-mode-override.entity.js';
import type { SurfaceChange } from './surface-change.js';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  decideDisplayMode,
  settingsDisplayModeKey,
  type DisplayModeCategoryCandidate,
} from './display-mode-resolver.js';

export type DisplayMode = 'gross_only' | 'net_only' | 'both' | 'none';
export type DisplayModeOverrideScope = 'organization' | 'category' | 'product';

/**
 * The neighbours this service has to **ask** rather than query (feature 075
 * Phase C).
 *
 * A price-list rule and a display-mode override both point at rows two other
 * modules own — an organisation, a category, a product — and this service used
 * to validate them with `em.count(Organization, …)` and friends, which is
 * another module's table on this module's connection. It answers rows whatever
 * state that module is in, so an operator with `catalog` switched off could
 * still pin a price list to a category the platform will not serve.
 *
 * Grouped into one object because it is one decision: a composition either
 * knows how to reach its neighbours or it does not, and there is no coherent
 * state where it can resolve categories but not organisations.
 */
export interface PriceListTargetReads {
  organizationDetails: OrganizationDetailsPort;
  catalogCategoryRead: CatalogCategoryReadPort;
  catalogProductRead: CatalogProductReadPort;
  /**
   * Feature 076 (D-79) — customer groups moved to `customer_accounts`, so the
   * rule-target validation reads them the same way it already read
   * organisations and categories.
   */
  customerGroupRead: CustomerGroupReadPort;
  /**
   * Feature 148 — `catalog`'s attribute read model. The price matrix may select
   * products by an attribute value, and only attributes flagged *Price list
   * rules* (`isPriceRule`) qualify; both the write-time eligibility check and
   * the resolver's "is this entry still active" question read the flag here.
   */
  catalogAttributeRead: CatalogAttributeReadPort;
}

/**
 * PriceListService — the price **display mode** of `price_lists`: the
 * per-organization, per-category and per-product overrides, the settings tier,
 * and the chain that decides how a price is shown (gross, net, both, none).
 *
 * Feature 160 (D-287 P1) removed everything else this service held — the
 * Application-rule lists, their rosters and brackets, the matrix entries and
 * their admin writes — with the old model; price books are written through
 * `PriceBookService`. The container name `priceListService` and the class name
 * stay, because the display-mode routes and the pricing engine reach it by them.
 */
export class PriceListService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * The pricing cache, invalidated **after** a display-mode write has
     * committed (D-287 P0). Production hands in `PricingGeneration`, whose
     * `invalidateAll` also announces the bump to every other process.
     */
    private readonly pricingCache?: { invalidateAll: (change?: SurfaceChange) => void | Promise<void> },
    /**
     * Feature 075 Phase C — the ports behind every override-target existence
     * check. Optional in the signature; **never optional in effect**: the paths
     * that need them refuse rather than skip when they are absent.
     */
    private readonly targetReads?: PriceListTargetReads,
  ) {}

  /**
   * The neighbour ports, or a refusal. Skipping the validation when nothing was
   * wired would turn "this composition cannot reach `catalog`" into "every
   * category id is valid", which is the fail-open shape feature 075 exists to
   * remove.
   */
  private targets(): PriceListTargetReads {
    if (!this.targetReads) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'This price-list operation validates a target owned by `catalog` or `organizations`, ' +
          'and this composition constructed PriceListService without their read ports.',
      );
    }
    return this.targetReads;
  }

  /**
   * Clear the pricing cache after a display-mode write. The price surface
   * stores amounts, not how they are shown, so the viewer's tail — an
   * organization override, a settings key — marks nothing there (`none`). A
   * product or category override does (issue #491): a product whose own step is
   * `none` is withheld from every viewer and left out of the surface, so the
   * products the override concerns are marked for the worker to refresh.
   */
  private async invalidatePricingCache(change: SurfaceChange = { kind: 'none' }): Promise<void> {
    await this.pricingCache?.invalidateAll(change);
  }

  /** What a display-mode override moves on the price surface — see {@link invalidatePricingCache}. */
  private overrideSurfaceChange(scope: DisplayModeOverrideScope, targetId: string): SurfaceChange {
    if (scope === 'product') return { kind: 'products', productIds: [targetId] };
    if (scope === 'category') return { kind: 'categories', categoryIds: [targetId] };
    return { kind: 'none' };
  }

  /**
   * Issue #491 — whether any product or category override is `none`, the only
   * way the product step of the chain withholds a product from every viewer.
   * One statement; the price surface's worker asks it before it reads the
   * product step, which it otherwise does not need.
   */
  async anyProductStepWithholds(): Promise<boolean> {
    const row = await this.emFactory().findOne(
      PriceDisplayModeOverride,
      { scope: { $in: ['product', 'category'] }, mode: 'none' },
      { fields: ['scope', 'targetId'] },
    );
    return row !== null;
  }

  // ---- Engine: display mode (US7) ------------------------------------

  /**
   * Upsert a per-Org / per-Category / per-Product display-mode override
   * (FR-038). The mode value `'inherit'` deletes the override row.
   * Validates the target ID against the appropriate table — orphans are
   * refused with 400 (the polymorphic FK is enforced here, not at the DB
   * level, since the target table varies — see data-model.md §1.4).
   */
  async upsertDisplayModeOverride(
    scope: DisplayModeOverrideScope,
    targetId: string,
    mode: DisplayMode | 'inherit',
  ): Promise<PriceDisplayModeOverride | null> {
    // command-coverage-ignore: a pricing-DISPLAY config toggle
    // (PriceDisplayModeOverride) — a presentation setting for how prices render,
    // not a price/catalog value mutation, so it is not an admin-audit target.
    const em = this.emFactory();
    await this.assertOverrideTargetExists(scope, targetId);
    const existing = await em.findOne(PriceDisplayModeOverride, { scope, targetId });
    const change = this.overrideSurfaceChange(scope, targetId);
    if (mode === 'inherit') {
      if (existing) {
        await em.removeAndFlush(existing);
        await this.invalidatePricingCache(change);
      }
      return null;
    }
    if (existing) {
      existing.mode = mode;
      existing.updatedAt = new Date();
      await em.flush();
      await this.invalidatePricingCache(change);
      return existing;
    }
    const row = em.create(PriceDisplayModeOverride, { scope, targetId, mode });
    await em.persistAndFlush(row);
    await this.invalidatePricingCache(change);
    return row;
  }

  async listDisplayModeOverrides(
    scope?: DisplayModeOverrideScope,
  ): Promise<PriceDisplayModeOverride[]> {
    const em = this.emFactory();
    return em.find(
      PriceDisplayModeOverride,
      scope ? { scope } : {},
      { orderBy: { scope: 'asc', targetId: 'asc' } },
    );
  }

  async getDisplayModeOverride(
    scope: DisplayModeOverrideScope,
    targetId: string,
  ): Promise<PriceDisplayModeOverride | null> {
    if (!isUuidShape(targetId)) return null;
    return this.emFactory().findOne(PriceDisplayModeOverride, { scope, targetId });
  }

  /**
   * Update a `pricing.*` settings-group display-mode key. Settings are
   * per-sales-channel under the foundation settings module — when no
   * channel is supplied, this method writes the value across every
   * sales channel (treating it as a tenant-wide override). For
   * channel-specific overrides, callers may pass a single channel.
   *
   * `key` is the bare suffix (e.g. `default_display_mode` or
   * `unauthenticated_display_mode`) — the full code is derived as
   * `pricing.<key>`.
   */
  async setSettingsDisplayMode(
    key: 'default_display_mode' | 'unauthenticated_display_mode',
    mode: DisplayMode,
    salesChannelId?: string,
  ): Promise<void> {
    // command-coverage-ignore: writes SettingValue rows owned by the settings
    // module (a cross-module config write); settings changes are the settings
    // module's audit concern, not the price-list admin audit log.
    const em = this.emFactory();
    const code = `pricing.${key}`;
    const setting = await em.findOneOrFail(Setting, { code });
    const channels = salesChannelId
      ? [await em.findOneOrFail(SalesChannel, { id: salesChannelId })]
      : await em.find(SalesChannel, {});
    for (const channel of channels) {
      const existing = await em.findOne(SettingValue, {
        setting: setting.id,
        salesChannel: channel.id,
      });
      if (existing) {
        existing.value = mode;
        existing.updatedAt = new Date();
        continue;
      }
      em.create(SettingValue, { setting, salesChannel: channel, value: mode });
    }
    await em.flush();
    // The engine memoises the display-mode tail under the pricing generation.
    await this.invalidatePricingCache();
  }

  /**
   * Read the value of a `pricing.*` display-mode setting for a sales
   * channel. Resolves along the settings tier chain
   *   per-channel override → global value → manifest `defaultValue`
   * (mirroring `SettingsService.get`). The global tier lives on
   * `settings.global_value` and is what the admin "All channels" editor
   * writes; without it a globally-set mode (e.g. `both`) was ignored and
   * the resolver silently fell back to the manifest default `gross_only`.
   */
  async readSettingsDisplayMode(
    key: 'default_display_mode' | 'unauthenticated_display_mode',
    salesChannelId: string,
  ): Promise<DisplayMode> {
    const em = this.emFactory();
    const code = `pricing.${key}`;
    const setting = await em.findOne(Setting, { code });
    if (!setting) return 'gross_only';
    const value = await em.findOne(SettingValue, {
      setting: setting.id,
      salesChannel: salesChannelId,
    });
    const raw = (value?.value ?? setting.globalValue ?? setting.defaultValue) as string;
    if (raw === 'gross_only' || raw === 'net_only' || raw === 'both' || raw === 'none') {
      return raw;
    }
    return 'gross_only';
  }

  /**
   * Resolve the effective display mode for a (product, organization?,
   * salesChannel) tuple along the FR-039 chain
   *   Product → Category → Organization → Settings.
   *
   * Walks the product's category memberships to find the most specific
   * category override (deepest in the tree, with `(sort_order ASC, id ASC)`
   * as the deterministic tie-break). Reads override rows from
   * `price_display_mode_overrides`; falls back to the per-channel
   * settings value (`default_display_mode` for signed-in customers,
   * `unauthenticated_display_mode` for guests).
   */
  async resolveDisplayMode(input: {
    productId: string;
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }): Promise<DisplayMode> {
    const em = this.emFactory();

    // 1. Product-level override.
    const productOverride = await em.findOne(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: input.productId,
    });

    // 2. Category-level override — the candidates the chain ranks.
    let categoryCandidates: DisplayModeCategoryCandidate[] = [];
    if (!productOverride) {
      const assignments = await this.targets().catalogCategoryRead.listAssignmentsForProducts([
        input.productId,
      ]);
      if (assignments.length > 0) {
        const categoryIds = assignments.map((a) => a.categoryId);
        const overrides = await em.find(PriceDisplayModeOverride, {
          scope: 'category',
          targetId: { $in: categoryIds },
        });
        categoryCandidates = await this.rankCategoryOverrides(overrides);
      }
    }

    // 3. Organization-level override (only signed-in customers).
    const needsOrganization =
      !productOverride &&
      categoryCandidates.length === 0 &&
      input.customerKind === 'signed_in' &&
      input.organizationId !== null;
    const organizationOverride = needsOrganization
      ? await em.findOne(PriceDisplayModeOverride, {
          scope: 'organization',
          targetId: input.organizationId!,
        })
      : null;

    const decision = decideDisplayMode({
      productOverride: (productOverride?.mode as DisplayMode | undefined) ?? null,
      categoryCandidates,
      organizationOverride: (organizationOverride?.mode as DisplayMode | undefined) ?? null,
    });
    if (decision.source !== 'settings') return decision.mode;

    // 4. Settings fallback.
    return this.readSettingsDisplayMode(
      settingsDisplayModeKey(input.customerKind),
      input.salesChannelId,
    );
  }

  /**
   * The chain's answer with **no product in hand** — feature 086 / FR-016.
   *
   * A price ordering and a price range are refused where the page may not show
   * prices at all, and `pricing.unauthenticated_display_mode = none` is the
   * supported "hide prices until login" configuration. Deciding that needs the
   * mode a *page* resolves to, which is the Organization → Settings tail of the
   * FR-039 chain with the product and category steps deliberately absent.
   *
   * **The absence is the ruling, not a shortcut** (spec 086, clarification 2):
   * withdrawing the whole control because one product opts out would make the
   * sort appear and disappear as a buyer walks the catalogue. A single product
   * overridden to `none` (or in a category overridden to `none`) does not take
   * part in the order either, since issue #491: its amount is withheld on the
   * server, so the price surface leaves it out and the catalogue walks it in
   * the unpriced tail (`BookPricing.resolveProfileListing`), where its position
   * says nothing about its price. Spec 086's recommendation — such a product
   * "keeps its position" — was written when the API sent the amount anyway.
   *
   * The decision itself still goes through `decideDisplayMode`, so a page and a
   * card cannot rank the organisation tier differently.
   */
  async resolvePageDisplayMode(input: {
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
  }): Promise<DisplayMode> {
    const em = this.emFactory();
    const organizationOverride =
      input.customerKind === 'signed_in' && input.organizationId !== null
        ? await em.findOne(PriceDisplayModeOverride, {
            scope: 'organization',
            targetId: input.organizationId,
          })
        : null;
    const decision = decideDisplayMode({
      productOverride: null,
      categoryCandidates: [],
      organizationOverride: (organizationOverride?.mode as DisplayMode | undefined) ?? null,
    });
    if (decision.source !== 'settings') return decision.mode;
    return this.readSettingsDisplayMode(
      settingsDisplayModeKey(input.customerKind),
      input.salesChannelId,
    );
  }

  /**
   * The chain's product and category steps for a set of products — the part no
   * viewer moves. A product neither step decides is absent; its mode is the
   * viewer's tail, {@link resolvePageDisplayMode}. The price-book engine caches
   * this half under the pricing profile and applies the tail per request, since
   * the profile is shared by viewers whose tails differ (a guest and an
   * organization with no buyer book).
   */
  async resolveProductDisplayModes(input: {
    productIds: readonly string[];
    categoryIdsByProduct?: ReadonlyMap<string, ReadonlySet<string>>;
  }): Promise<Map<string, DisplayMode>> {
    const out = new Map<string, DisplayMode>();
    const productIds = [...new Set(input.productIds)];
    if (productIds.length === 0) return out;
    const em = this.emFactory();

    // 1. Product-scope overrides for the whole set.
    for (const row of await em.find(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: { $in: productIds },
    })) {
      out.set(row.targetId, row.mode as DisplayMode);
    }

    // 2. Category memberships, then the category-scope overrides over their
    //    union — one lookup for the page rather than one per card.
    const undecided = productIds.filter((id) => !out.has(id));
    if (undecided.length === 0) return out;
    const categoryIdsByProduct =
      input.categoryIdsByProduct ?? (await this.loadCategoryMemberships(undecided));
    const categoryUnion = new Set<string>();
    for (const productId of undecided) {
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        categoryUnion.add(categoryId);
      }
    }
    if (categoryUnion.size === 0) return out;
    const rankedByCategory = new Map<string, DisplayModeCategoryCandidate>();
    const overrides = await em.find(PriceDisplayModeOverride, {
      scope: 'category',
      targetId: { $in: [...categoryUnion] },
    });
    for (const candidate of await this.rankCategoryOverrides(overrides)) {
      rankedByCategory.set(candidate.categoryId, candidate);
    }

    // 3. Decide with no organization step: what is left is the viewer's tail.
    for (const productId of undecided) {
      const candidates: DisplayModeCategoryCandidate[] = [];
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        const ranked = rankedByCategory.get(categoryId);
        if (ranked) candidates.push(ranked);
      }
      const decision = decideDisplayMode({
        productOverride: null,
        categoryCandidates: candidates,
        organizationOverride: null,
      });
      if (decision.source !== 'settings') out.set(productId, decision.mode);
    }
    return out;
  }

  /**
   * `(product, category)` memberships for a set of products, read through
   * `catalog`'s port (feature 075 / D-87).
   *
   * One call for the whole set, not one per product: the port takes the array
   * for exactly this reason, and a page turning into a round trip per card is
   * the regression this shape exists to prevent.
   *
   * **Structural, deliberately** — no `activeOnly`. The single-product path
   * ranks the same memberships, and a price book's category row tests the raw
   * membership too, so narrowing to live categories here would make the
   * display-mode chain and the row that prices the product disagree about which
   * categories a product is in.
   *
   * Every product asked about gets an entry, so an uncategorised product is an
   * empty set rather than a missing key.
   */
  private async loadCategoryMemberships(
    productIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set());
    if (productIds.length === 0) return out;
    for (const assignment of await this.targets().catalogCategoryRead.listAssignmentsForProducts(
      productIds,
    )) {
      out.get(assignment.productId)?.add(assignment.categoryId);
    }
    return out;
  }

  /**
   * Turn category-scope override rows into the chain's ranking inputs.
   *
   * `ancestorsOf` answers the category **and** its ancestors, nearest-first, so
   * one port call replaces the `findOne` plus the parent-pointer loop that
   * walked `catalog`'s table a level at a time. Depth is the chain length minus
   * the category itself; an unknown id answers an empty chain and is dropped,
   * which is what the old `continue` did.
   */
  private async rankCategoryOverrides(
    overrides: readonly PriceDisplayModeOverride[],
  ): Promise<DisplayModeCategoryCandidate[]> {
    const out: DisplayModeCategoryCandidate[] = [];
    for (const override of overrides) {
      const chain = await this.targets().catalogCategoryRead.ancestorsOf(override.targetId);
      const category = chain[0];
      if (!category) continue;
      out.push({
        mode: override.mode as DisplayMode,
        depth: chain.length - 1,
        sortOrder: category.sortOrder,
        categoryId: category.id,
      });
    }
    return out;
  }

  /**
   * Validate that a polymorphic override target exists in the appropriate
   * table. Throws 400 VALIDATION_FAILED on orphan target IDs (FR-038).
   */
  private async assertOverrideTargetExists(
    scope: DisplayModeOverrideScope,
    targetId: string,
  ): Promise<void> {
    let exists: number;
    switch (scope) {
      case 'organization':
        exists = await this.targets().organizationDetails.countByIds([targetId]);
        break;
      case 'category':
        exists = await this.targets().catalogCategoryRead.countByIds([targetId]);
        break;
      case 'product':
        exists = await this.targets().catalogProductRead.countByIds([targetId]);
        break;
    }
    if (exists === 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `No ${scope} found with id ${targetId} for display-mode override.`,
      );
    }
  }

  // ---- Engine: product roster + bracket pricing (US3) ----------------
}
