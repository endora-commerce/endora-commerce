import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
   * A display mode is not on the price surface (it holds amounts, not how they
   * are shown), so nothing there is marked; the cache is cleared as ever.
   */
  private async invalidatePricingCache(): Promise<void> {
    await this.pricingCache?.invalidateAll({ kind: 'none' });
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
    if (mode === 'inherit') {
      if (existing) {
        await em.removeAndFlush(existing);
        await this.invalidatePricingCache();
      }
      return null;
    }
    if (existing) {
      existing.mode = mode;
      existing.updatedAt = new Date();
      await em.flush();
      await this.invalidatePricingCache();
      return existing;
    }
    const row = em.create(PriceDisplayModeOverride, { scope, targetId, mode });
    await em.persistAndFlush(row);
    await this.invalidatePricingCache();
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
   * **The absence is the ruling, not a shortcut** (spec 086, clarification 2).
   * A single product overridden to `none` keeps its position in a price
   * ordering: a per-product override reads as "ask us for a quote" rather than
   * "this price is secret", and withdrawing the whole control because one
   * product opts out would make the sort appear and disappear as a buyer walks
   * the catalogue. Moving those products to the tail instead is a change to
   * this method's two omitted steps and to nothing else.
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
   * The same chain for a **set** of products (issue #132 follow-up).
   *
   * A catalogue listing asked this question once per product, which cost four
   * to six queries per card on the page's hottest read. Every step is a set
   * lookup — the product-scope overrides, the category memberships, the
   * category-scope overrides, the one organization row and the one settings
   * pair — so the whole page costs what a single product used to.
   *
   * The *decision* is not duplicated: both this method and `resolveDisplayMode`
   * hand their four inputs to `decideDisplayMode`, so a batched page cannot
   * rank an override differently from a product page. Only the loading differs.
   *
   * `categoryIdsByProduct` is an optional prefetch for a caller that has
   * already read the memberships — `PricingService.resolveListingPrices` needs
   * them for the application rules and would otherwise read the same table
   * twice per page.
   */
  async resolveDisplayModes(input: {
    productIds: readonly string[];
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
    categoryIdsByProduct?: ReadonlyMap<string, ReadonlySet<string>>;
  }): Promise<Map<string, DisplayMode>> {
    const out = new Map<string, DisplayMode>();
    const productIds = [...new Set(input.productIds)];
    if (productIds.length === 0) return out;
    const em = this.emFactory();

    // 1. Product-scope overrides for the whole set.
    const productOverrides = new Map<string, DisplayMode>();
    for (const row of await em.find(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: { $in: productIds },
    })) {
      productOverrides.set(row.targetId, row.mode as DisplayMode);
    }

    // 2. Category memberships, then the category-scope overrides over their
    //    union — one lookup for the page rather than one per card.
    const undecided = productIds.filter((id) => !productOverrides.has(id));
    const categoryIdsByProduct =
      input.categoryIdsByProduct ?? (await this.loadCategoryMemberships(undecided));
    const categoryUnion = new Set<string>();
    for (const productId of undecided) {
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        categoryUnion.add(categoryId);
      }
    }
    const rankedByCategory = new Map<string, DisplayModeCategoryCandidate>();
    if (categoryUnion.size > 0) {
      const overrides = await em.find(PriceDisplayModeOverride, {
        scope: 'category',
        targetId: { $in: [...categoryUnion] },
      });
      for (const candidate of await this.rankCategoryOverrides(overrides)) {
        rankedByCategory.set(candidate.categoryId, candidate);
      }
    }

    // 3. The organization row is one row for the whole set.
    let organizationOverride: DisplayMode | null = null;
    if (input.customerKind === 'signed_in' && input.organizationId) {
      const row = await em.findOne(PriceDisplayModeOverride, {
        scope: 'organization',
        targetId: input.organizationId,
      });
      organizationOverride = (row?.mode as DisplayMode | undefined) ?? null;
    }

    // 4. Decide, and read the settings pair once if anything still needs it.
    const needingSettings: string[] = [];
    for (const productId of productIds) {
      const candidates: DisplayModeCategoryCandidate[] = [];
      for (const categoryId of categoryIdsByProduct.get(productId) ?? []) {
        const ranked = rankedByCategory.get(categoryId);
        if (ranked) candidates.push(ranked);
      }
      const decision = decideDisplayMode({
        productOverride: productOverrides.get(productId) ?? null,
        categoryCandidates: candidates,
        organizationOverride,
      });
      if (decision.source === 'settings') needingSettings.push(productId);
      else out.set(productId, decision.mode);
    }
    if (needingSettings.length > 0) {
      const fallback = await this.readSettingsDisplayMode(
        settingsDisplayModeKey(input.customerKind),
        input.salesChannelId,
      );
      for (const productId of needingSettings) out.set(productId, fallback);
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
