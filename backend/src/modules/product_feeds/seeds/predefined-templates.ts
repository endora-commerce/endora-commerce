import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  FeedFieldSourceKind,
  FeedItemGranularity,
  FeedOutputFormat,
  FeedProviderCode,
} from '@endora-commerce/contracts';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';

/**
 * The five predefined feed templates — feature 067 / FR-007, FR-008.
 *
 * Two are **complete and production-usable** (Google Merchant Center, Meta) and
 * three are **skeletons** carrying only identity, price, availability, link and
 * image (Amazon, eBay, Allegro). That asymmetry is deliberate and stated in the
 * admin before the operator picks one: v1 delivers by pull URL and download
 * only, so a marketplace template exists to be extended by someone who has the
 * provider's current flat-file spec in front of them, not to be trusted blind.
 *
 * They are addressed by `systemCode`, never by id, so the boot reconciler can
 * restore one an operator deleted without ever touching a template the operator
 * authored (FR-008).
 *
 * **On `providerRequired` for images**: Google does require `image_link`, and it
 * is nevertheless declared optional here. `providerRequired` drives *skip the
 * item*, so marking it required would make the very first run of a catalogue
 * without images produce an empty feed — which FR-039 then refuses to publish,
 * leaving the operator with a feed that silently does nothing. The per-item
 * `missing_image` warning surfaces the same fact in run diagnostics (FR-054),
 * where it is actionable, and the operator can flip the flag in the editor.
 */

export interface PredefinedTemplateField {
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey?: string | null;
  constantValue?: string | null;
  fallbackValue?: string | null;
  providerRequired?: boolean;
  helpKey?: string | null;
}

export interface PredefinedTemplate {
  systemCode: string;
  name: string;
  description: string;
  providerCode: FeedProviderCode;
  outputFormat: FeedOutputFormat;
  itemGranularity: FeedItemGranularity;
  fields: PredefinedTemplateField[];
}

/**
 * Google Merchant Center — RSS 2.0 with the `g:` namespace.
 *
 * `g:google_product_category` is bound to the provider taxonomy installed by
 * the module's reconciler. It is **not** `providerRequired`: Google treats the
 * category as optional and infers one when it is absent, so dropping sellable
 * products over an unmapped category would silently shrink the feed for no
 * gain (contract admin-taxonomy-mappings.md §6). An unmapped category omits the
 * field and records a warning instead.
 */
const GOOGLE_MERCHANT: PredefinedTemplate = {
  systemCode: 'google_merchant_v1',
  name: 'Google Merchant Center',
  description:
    'Complete Google Merchant Center product feed (RSS 2.0). One item per purchasable variant, grouped by product.',
  providerCode: 'google_merchant',
  outputFormat: 'xml',
  itemGranularity: 'variant',
  fields: [
    { outputName: 'g:id', sourceKind: 'sku', providerRequired: true, helpKey: 'templateHelp.google.id' },
    { outputName: 'g:title', sourceKind: 'name', providerRequired: true, helpKey: 'templateHelp.google.title' },
    {
      outputName: 'g:description',
      sourceKind: 'description',
      providerRequired: true,
      helpKey: 'templateHelp.google.description',
    },
    { outputName: 'g:link', sourceKind: 'link', providerRequired: true, helpKey: 'templateHelp.google.link' },
    { outputName: 'g:image_link', sourceKind: 'image_link', helpKey: 'templateHelp.google.imageLink' },
    {
      outputName: 'g:additional_image_link',
      sourceKind: 'additional_image_link',
      helpKey: 'templateHelp.google.additionalImageLink',
    },
    {
      outputName: 'g:availability',
      sourceKind: 'availability',
      providerRequired: true,
      fallbackValue: 'in_stock',
      helpKey: 'templateHelp.google.availability',
    },
    { outputName: 'g:price', sourceKind: 'price', providerRequired: true, helpKey: 'templateHelp.google.price' },
    { outputName: 'g:sale_price', sourceKind: 'sale_price', helpKey: 'templateHelp.google.salePrice' },
    { outputName: 'g:brand', sourceKind: 'brand', helpKey: 'templateHelp.google.brand' },
    {
      outputName: 'g:condition',
      sourceKind: 'constant',
      constantValue: 'new',
      providerRequired: true,
      helpKey: 'templateHelp.google.condition',
    },
    { outputName: 'g:gtin', sourceKind: 'attribute', sourceKey: 'gtin', helpKey: 'templateHelp.google.gtin' },
    { outputName: 'g:mpn', sourceKind: 'attribute', sourceKey: 'mpn', helpKey: 'templateHelp.google.mpn' },
    {
      outputName: 'g:item_group_id',
      sourceKind: 'grouping_id',
      helpKey: 'templateHelp.google.itemGroupId',
    },
    {
      outputName: 'g:product_type',
      sourceKind: 'category_path',
      helpKey: 'templateHelp.google.productType',
    },
    {
      outputName: 'g:google_product_category',
      sourceKind: 'provider_category',
      helpKey: 'templateHelp.google.googleProductCategory',
    },
  ],
};

/** Meta catalogue — the same RSS envelope; Meta accepts both XML and CSV. */
const META_CATALOG: PredefinedTemplate = {
  systemCode: 'meta_catalog_v1',
  name: 'Meta (Facebook & Instagram) catalogue',
  description:
    'Complete Meta catalogue feed (RSS 2.0). One item per purchasable variant, grouped by product.',
  providerCode: 'meta',
  outputFormat: 'xml',
  itemGranularity: 'variant',
  fields: [
    { outputName: 'g:id', sourceKind: 'sku', providerRequired: true, helpKey: 'templateHelp.meta.id' },
    { outputName: 'g:title', sourceKind: 'name', providerRequired: true, helpKey: 'templateHelp.meta.title' },
    {
      outputName: 'g:description',
      sourceKind: 'description',
      providerRequired: true,
      helpKey: 'templateHelp.meta.description',
    },
    { outputName: 'g:link', sourceKind: 'link', providerRequired: true, helpKey: 'templateHelp.meta.link' },
    { outputName: 'g:image_link', sourceKind: 'image_link', helpKey: 'templateHelp.meta.imageLink' },
    {
      outputName: 'g:additional_image_link',
      sourceKind: 'additional_image_link',
      helpKey: 'templateHelp.meta.additionalImageLink',
    },
    {
      outputName: 'g:availability',
      sourceKind: 'availability',
      providerRequired: true,
      fallbackValue: 'in_stock',
      helpKey: 'templateHelp.meta.availability',
    },
    { outputName: 'g:price', sourceKind: 'price', providerRequired: true, helpKey: 'templateHelp.meta.price' },
    { outputName: 'g:sale_price', sourceKind: 'sale_price', helpKey: 'templateHelp.meta.salePrice' },
    { outputName: 'g:brand', sourceKind: 'brand', helpKey: 'templateHelp.meta.brand' },
    {
      outputName: 'g:condition',
      sourceKind: 'constant',
      constantValue: 'new',
      providerRequired: true,
      helpKey: 'templateHelp.meta.condition',
    },
    {
      outputName: 'g:item_group_id',
      sourceKind: 'grouping_id',
      helpKey: 'templateHelp.meta.itemGroupId',
    },
    {
      outputName: 'g:product_type',
      sourceKind: 'category_path',
      helpKey: 'templateHelp.meta.productType',
    },
    {
      outputName: 'g:google_product_category',
      sourceKind: 'provider_category',
      helpKey: 'templateHelp.meta.googleProductCategory',
    },
  ],
};

/** The three marketplace skeletons: identity, price, availability, link, image. */
function skeleton(
  systemCode: string,
  name: string,
  providerCode: FeedProviderCode,
  outputFormat: FeedOutputFormat,
  description: string,
): PredefinedTemplate {
  return {
    systemCode,
    name,
    description,
    providerCode,
    outputFormat,
    itemGranularity: 'product',
    fields: [
      { outputName: 'sku', sourceKind: 'sku', providerRequired: true },
      { outputName: 'title', sourceKind: 'name', providerRequired: true },
      { outputName: 'description', sourceKind: 'description' },
      { outputName: 'price', sourceKind: 'price', providerRequired: true },
      { outputName: 'availability', sourceKind: 'availability', fallbackValue: 'in_stock' },
      { outputName: 'link', sourceKind: 'link' },
      { outputName: 'image_link', sourceKind: 'image_link' },
    ],
  };
}

export const PREDEFINED_TEMPLATES: readonly PredefinedTemplate[] = [
  GOOGLE_MERCHANT,
  META_CATALOG,
  skeleton(
    'amazon_flat_file_v1',
    'Amazon flat file (skeleton)',
    'amazon',
    'tsv',
    'Starting point for an Amazon flat file. Carries identity, price, availability, link and image only — extend it against the category template Amazon gives you.',
  ),
  skeleton(
    'ebay_v1',
    'eBay (skeleton)',
    'ebay',
    'csv',
    'Starting point for an eBay listing file. Carries identity, price, availability, link and image only.',
  ),
  skeleton(
    'allegro_v1',
    'Allegro (skeleton)',
    'allegro',
    'csv',
    'Starting point for an Allegro offer file. Carries identity, price, availability, link and image only.',
  ),
];

/**
 * Installs any missing system template. Idempotent, and deliberately
 * **non-destructive**: an existing row with the same `systemCode` is left
 * exactly as it is, so a future revision of this file never silently rewrites
 * what is already installed, and an operator's own template — which by
 * definition has no `systemCode` — is never touched.
 *
 * A failure here logs and returns rather than aborting boot, the same posture
 * as the `_i18n` bundle reconciler: a missing predefined template is an
 * inconvenience, an unbootable API is an outage.
 */
export async function reconcilePredefinedTemplates(em: EntityManager): Promise<number> {
  // command-coverage-ignore: boot convergence of the database to the templates
  // this build ships, in the same shape as `_lifecycle`'s registry reconcile —
  // a system invariant with no operator behind it. It only ever *installs* a
  // missing `isSystem` row (see the contract above); the moment it starts
  // editing or deleting one, it is changing an operator's configuration and the
  // write belongs in a Command, not under this hatch.
  let installed = 0;
  for (const definition of PREDEFINED_TEMPLATES) {
    const existing = await em.findOne(FeedTemplate, { systemCode: definition.systemCode });
    if (existing) continue;

    const template = em.create(FeedTemplate, {
      name: definition.name,
      description: definition.description,
      providerCode: definition.providerCode,
      outputFormat: definition.outputFormat,
      itemGranularity: definition.itemGranularity,
      isSystem: true,
      systemCode: definition.systemCode,
    });
    // The template row must exist before its fields: the field table's foreign
    // key is checked per statement, and MikroORM batches inserts by entity type
    // in an order it chooses, not in persist order.
    await em.persistAndFlush(template);
    definition.fields.forEach((field, index) => {
      em.persist(
        em.create(FeedTemplateField, {
          feedTemplateId: template.id,
          outputName: field.outputName,
          sourceKind: field.sourceKind,
          sourceKey: field.sourceKey ?? null,
          constantValue: field.constantValue ?? null,
          fallbackValue: field.fallbackValue ?? null,
          providerRequired: field.providerRequired ?? false,
          transform: null,
          transformArg: null,
          sortOrder: index,
          helpKey: field.helpKey ?? null,
          unbound: false,
        }),
      );
    });
    installed += 1;
  }
  if (installed > 0) await em.flush();
  return installed;
}
