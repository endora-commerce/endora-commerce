import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AttributeValueType,
  CatalogAttributeFlag,
  CatalogAttributeOptionView,
  CatalogAttributeView,
} from '@b2b/contracts';
import type { DefinitionSource } from '../../custom_fields/services/custom-field-value.service.js';
import type { CachedDefinition } from '../../custom_fields/services/custom-field-definitions-cache.js';
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
 * The three shapes moved to `@b2b/contracts` in feature 075's Phase P — four
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
 * The definition source the read service composes over. `publishInvalidate` is
 * optional — when present (production wiring passes the
 * `CustomFieldDefinitionService`), the service self-heals a stale cache: a
 * just-committed catalog command may dispatch its domain event BEFORE the
 * post-commit cache invalidation runs, so a subscriber reading the view can
 * observe fresh extension rows against a stale definition list. One
 * invalidate-and-reload round separates that benign window from real
 * data corruption.
 */
export interface AttributeDefinitionSource extends DefinitionSource {
  publishInvalidate?(entityType: 'product'): Promise<void>;
}

export class CatalogAttributeReadService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly definitions: AttributeDefinitionSource,
  ) {}

  /** All attributes, definition-composed. Ordered by definition sortOrder, key. */
  async listAll(): Promise<CatalogAttributeView[]> {
    const defs = await this.definitions.listForEntity('product');
    const extensions = await this.emFactory().find(ProductAttribute, {});
    try {
      return this.composeAll(defs, extensions);
    } catch (err) {
      if (!(err instanceof CatalogAttributeIntegrityError) || !this.definitions.publishInvalidate) {
        throw err;
      }
      // Stale-cache window (see AttributeDefinitionSource) — reload once.
      await this.definitions.publishInvalidate('product');
      const freshDefs = await this.definitions.listForEntity('product');
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
    const build = async (): Promise<CatalogAttributeView[]> => {
      const defs = await this.definitions.listForEntity('product');
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
      if (!(err instanceof CatalogAttributeIntegrityError) || !this.definitions.publishInvalidate) {
        throw err;
      }
      // Stale-cache window (see AttributeDefinitionSource) — reload once.
      await this.definitions.publishInvalidate('product');
      return build();
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
        bucket.set(o.value, { label: o.label ?? {}, labelDefault: o.labelDefault });
      }
      out.set(definition.key, bucket);
    }
    return out;
  }

  // -- internals -------------------------------------------------------------

  private definitionIndex(defs: CachedDefinition[]): Map<string, CachedDefinition> {
    return new Map(defs.map((d) => [d.definition.id, d]));
  }

  private composeAll(
    defs: CachedDefinition[],
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
    defById: Map<string, CachedDefinition>,
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
    cached: CachedDefinition,
  ): CatalogAttributeView {
    const { definition, options } = cached;
    return {
      id: ext.id,
      customFieldDefinitionId: definition.id,
      key: definition.key,
      label: definition.label ?? {},
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
        label: o.label ?? {},
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
