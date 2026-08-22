import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AttributeValueType,
  CatalogAttributeFlag,
  CatalogAttributeOptionView,
  CatalogAttributeView,
  CustomFieldDefinitionReadPort,
  CustomFieldDefinitionWithOptions,
} from '@endora-commerce/contracts';

import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { cfToLegacyValueType } from './attribute-type-mapping.js';

/**
 * CatalogAttributeReadService — the composed attribute read model (feature 061,
 * contracts/catalog-attribute-view.md).
 *
 * The ONLY sanctioned way any module — including catalog's own route
 * serializers — reads product-attribute definitions (Principle I). Composes the
 * custom_fields per-entity cache (`listForEntity('product')`) with the catalog
 * extension rows (`product_attributes`), yielding a view shaped like the
 * pre-061 `ProductAttribute` so consumer rewires stay mechanical.
 *
 * Freshness: the definitions half rides the CF cache (invalidated by every
 * committed catalog attribute command + 5 s TTL fallback); the extension half
 * is a live query, so flag reads are always fresh.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The three shapes moved to `@endora-commerce/contracts` in feature 075's Phase P — four
 * modules type themselves against `CatalogAttributeView` today by importing
 * this file. Re-exported here for the length of Phase P, which cuts no
 * consumer.
 */
export type { CatalogAttributeOptionView, CatalogAttributeView, CatalogAttributeFlag };

/**
 * Raised when the total-1:1 invariant is violated (an extension row without a
 * product-host definition, or vice versa). Loud by design — a silent skip
 * would hide data corruption from every consumer (contract: Totality).
 */
export class CatalogAttributeIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogAttributeIntegrityError';
  }
}

/**
 * The stale-definition window this service self-heals, and why the recovery is
 * one call now (D-97.1).
 *
 * A just-committed catalog attribute Command may dispatch its domain event
 * BEFORE the post-commit cache invalidation runs, so a subscriber reading the
 * view observes fresh `product_attributes` rows against a stale definition
 * list, and `composeAll` raises {@link CatalogAttributeIntegrityError}. The
 * window is benign and converges; the error is loud because the same symptom is
 * what real corruption looks like. One reload separates the two.
 *
 * This module used to reach for the *mechanism* — it widened the published read
 * port with an optional `publishInvalidate?` and called it when present. Two
 * things were wrong with that. `lazyPort`'s proxy answers every property with a
 * function, so `!this.definitions.publishInvalidate` was `false` whatever was
 * registered, the recovery branch always fired, and the forward threw
 * `'…publishInvalidate' is not a function` — a benign window turned into a 500
 * on the attribute screens. And a cache flush is an instruction about another
 * module's internals: the question this service has is "give me definitions I
 * can trust", which is what `listForEntityFresh` answers. The cache stays
 * inside `custom_fields`; only this module can detect the inconsistency, and
 * only that one can resolve it.
 */
export class CatalogAttributeReadService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly definitions: CustomFieldDefinitionReadPort,
  ) {}

  /** All attributes, definition-composed. Ordered by definition sortOrder, key. */
  async listAll(): Promise<CatalogAttributeView[]> {
    const defs = await this.definitions.listForEntity('product');
    const extensions = await this.emFactory().find(ProductAttribute, {});
    try {
      return this.composeAll(defs, extensions);
    } catch (err) {
      if (!(err instanceof CatalogAttributeIntegrityError)) throw err;
      // Stale-definition window (see the note above) — reload once, past every
      // process's cache.
      const freshDefs = await this.definitions.listForEntityFresh('product');
      const freshExtensions = await this.emFactory().find(ProductAttribute, {});
      return this.composeAll(freshDefs, freshExtensions);
    }
  }

  /** By extension id, definition id, or key (the admin routes' `:idOrKey` affordance). */
  async getByIdOrKey(idOrKey: string): Promise<CatalogAttributeView | null> {
    const all = await this.listAll();
    if (UUID_REGEX.test(idOrKey)) {
      const lowered = idOrKey.toLowerCase();
      return (
        all.find(
          (v) =>
            v.id.toLowerCase() === lowered ||
            v.customFieldDefinitionId.toLowerCase() === lowered,
        ) ?? null
      );
    }
    return all.find((v) => v.key === idOrKey) ?? null;
  }

  /** Flag-filtered listing (indexed extension columns). Ordered by key ASC. */
  async listByFlag(flag: CatalogAttributeFlag): Promise<CatalogAttributeView[]> {
    const build = async (
      preloaded?: CustomFieldDefinitionWithOptions[],
    ): Promise<CatalogAttributeView[]> => {
      const defs = preloaded ?? (await this.definitions.listForEntity('product'));
      const extensions = await this.emFactory().find(
        ProductAttribute,
        { [flag]: true } as Partial<ProductAttribute>,
      );
      const defById = this.definitionIndex(defs);
      const views = extensions.map((ext) => this.compose(ext, defById));
      views.sort((a, b) => a.key.localeCompare(b.key));
      return views;
    };
    try {
      return await build();
    } catch (err) {
      // Said at the site rather than left to the condition below. The `throw`
      // already carries `ModuleDisabledError` out, but by accident: the test is
      // for an integrity error, and one more `instanceof` branch would turn
      // "custom_fields is off" into a cache reload that reads the same absent
      // port twice.
      rethrowIfModuleDisabled(err);
      if (!(err instanceof CatalogAttributeIntegrityError)) throw err;
      // Stale-definition window (see the note above) — reload once, past every
      // process's cache. `listForEntityFresh` is a gated port call like any
      // other, so `custom_fields` switched off still reaches the line above
      // rather than being caught here.
      return build(await this.definitions.listForEntityFresh('product'));
    }
  }

  /** Option-label lookup for select-style attributes (key → value → labels). */
  async optionLabelIndex(): Promise<
    Map<string, Map<string, { label: Record<string, string>; labelDefault: string }>>
  > {
    const defs = await this.definitions.listForEntity('product');
    const out = new Map<
      string,
      Map<string, { label: Record<string, string>; labelDefault: string }>
    >();
    for (const { definition, options } of defs) {
      if (options.length === 0) continue;
      const bucket = new Map<string, { label: Record<string, string>; labelDefault: string }>();
      for (const o of options) {
        bucket.set(o.value, { label: o.label, labelDefault: o.labelDefault });
      }
      out.set(definition.key, bucket);
    }
    return out;
  }

  // -- internals -------------------------------------------------------------

  private definitionIndex(
    defs: CustomFieldDefinitionWithOptions[],
  ): Map<string, CustomFieldDefinitionWithOptions> {
    return new Map(defs.map((d) => [d.definition.id, d]));
  }

  private composeAll(
    defs: CustomFieldDefinitionWithOptions[],
    extensions: ProductAttribute[],
  ): CatalogAttributeView[] {
    const extByDefId = new Map(extensions.map((e) => [e.customFieldDefinitionId, e]));
    const views: CatalogAttributeView[] = [];
    // `listForEntity` returns definitions ordered by (sortOrder, key) already.
    for (const cached of defs) {
      const ext = extByDefId.get(cached.definition.id);
      if (!ext) {
        throw new CatalogAttributeIntegrityError(
          `Product-host definition "${cached.definition.key}" (${cached.definition.id}) has no product_attributes extension row.`,
        );
      }
      views.push(this.composeFromCached(ext, cached));
      extByDefId.delete(cached.definition.id);
    }
    const orphan = extByDefId.values().next().value as ProductAttribute | undefined;
    if (orphan) {
      throw new CatalogAttributeIntegrityError(
        `product_attributes row ${orphan.id} references a missing product-host definition ${orphan.customFieldDefinitionId}.`,
      );
    }
    return views;
  }

  private compose(
    ext: ProductAttribute,
    defById: Map<string, CustomFieldDefinitionWithOptions>,
  ): CatalogAttributeView {
    const cached = defById.get(ext.customFieldDefinitionId);
    if (!cached) {
      throw new CatalogAttributeIntegrityError(
        `product_attributes row ${ext.id} references a missing product-host definition ${ext.customFieldDefinitionId}.`,
      );
    }
    return this.composeFromCached(ext, cached);
  }

  private composeFromCached(
    ext: ProductAttribute,
    cached: CustomFieldDefinitionWithOptions,
  ): CatalogAttributeView {
    const { definition, options } = cached;
    return {
      id: ext.id,
      customFieldDefinitionId: definition.id,
      key: definition.key,
      label: definition.label,
      labelDefault: definition.labelDefault,
      valueType: cfToLegacyValueType(
        definition.valueType,
        ext.selectDisplay,
        ext.numericKind,
      ) as AttributeValueType,
      isRequired: definition.required,
      options: options.map((o) => ({
        id: o.id,
        value: o.value,
        label: o.label,
        labelDefault: o.labelDefault,
        isDefault: o.isDefault,
        sortOrder: o.sortOrder,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
      isSearchable: ext.isSearchable,
      isFilterable: ext.isFilterable,
      isVariantAxis: ext.isVariantAxis,
      displayAsSlider: ext.displayAsSlider,
      isComparable: ext.isComparable,
      quickSearchable: ext.quickSearchable,
      isPromoRule: ext.isPromoRule,
      filterPosition: ext.filterPosition,
      isVisibleOnProductPage: ext.isVisibleOnProductPage,
      channelScoped: ext.channelScoped,
      languageScoped: ext.languageScoped,
      massEditable: ext.massEditable,
      createdAt: ext.createdAt,
      updatedAt: ext.updatedAt,
    };
  }
}
