import {
  channelUrlLanguages,
  grossAmountHalfUp,
  lineAmountHalfUp,
  productPath,
  roundAmountHalfUp,
  type ChannelUrlFacts,
} from '@endora-commerce/contracts';
import type { FeedRunIssueReason } from '@endora-commerce/contracts';
import { feedPackQuantity, MAX_FEED_PACK_QUANTITY, packCountMeasure } from './feed-pack.js';
import type { FeedItemField } from './serializers/serializer.interface.js';
import type {
  FeedItemPrice,
  FeedItemSource,
  FeedResolutionContext,
  ItemFieldResolverPort,
  ResolvableTemplateField,
  ResolvedFeedItem,
  ResolvedItemIssue,
  ResolveFeedItemInput,
} from './item-field-resolver.interface.js';

/**
 * The core item field resolver — feature 067 / FR-003, FR-037, FR-040–FR-045.
 *
 * Pure by construction: no `em`, no `await`, no I/O. Everything it needs was
 * hydrated by the generation pipeline, which is what keeps peak memory flat and
 * this whole matrix unit-testable.
 *
 * The one behavioural rule worth stating up front, because everything else
 * follows from it: **an item-level problem never aborts a run** (FR-037). A
 * field that cannot resolve is either omitted (optional) or skips its one item
 * with an enumerated reason (`providerRequired`). Nothing throws.
 */

/** Attribute key conventionally holding the manufacturer, for `source_kind = 'brand'`. */
const DEFAULT_BRAND_KEY = 'brand';

/** The delimiter Google and Meta both expect in `additional_image_link`. */
const ADDITIONAL_IMAGE_SEPARATOR = ',';

/** Category breadcrumb separator, per Google's `product_type` grammar. */
const CATEGORY_PATH_SEPARATOR = ' > ';

interface FieldOutcome {
  value: string;
  /** Issues discovered while resolving, regardless of whether a value was produced. */
  issues: ResolvedItemIssue[];
}

function issue(
  severity: 'skip' | 'warning',
  reason: FeedRunIssueReason,
  outputName: string | null,
  detail: string | null = null,
): ResolvedItemIssue {
  return { severity, reason, outputName, detail };
}

/** Renders an arbitrary attribute / custom-field value as a feed string. */
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyValue).filter((v) => v !== '').join(',');
  if (value instanceof Date) return value.toISOString();
  // A JSONB object has no single sensible feed rendering; treat it as absent so
  // the field's fallback (or the required-field rule) decides what happens.
  return '';
}

/** `123.00 PLN` — the "amount currency" form both Google and Meta parse. */
function formatMoney(amount: string, currencyCode: string): string {
  return `${roundAmountHalfUp(amount)} ${currencyCode}`;
}

/**
 * The amount a price field publishes: the unit price, or — for a sub-cent
 * price (issue #430) — the price of `packQuantity` units, which is exact at
 * two places by the choice of the pack. Its gross is the gross of that pack's
 * net, half-up, as a basket line of that many units is charged (§10.18).
 */
function publishedAmount(price: FeedItemPrice, context: FeedResolutionContext, packQuantity: number): string {
  if (packQuantity === 1) return context.pricePresentation === 'gross' ? price.gross : price.net;
  const net = lineAmountHalfUp(price.net, packQuantity);
  if (context.pricePresentation !== 'gross' || price.taxRatePercent === null) return net;
  return grossAmountHalfUp(net, price.taxRatePercent);
}

function priceValue(
  price: FeedItemPrice | null,
  context: FeedResolutionContext,
  outputName: string,
  packQuantity: number,
): FieldOutcome {
  if (!price) return { value: '', issues: [] };
  const issues: ResolvedItemIssue[] = [];
  const amount = publishedAmount(price, context, packQuantity);
  if (context.pricePresentation === 'gross' && !price.taxResolved) {
    // Never a silent zero-VAT price: the operator asked for gross, and no tax
    // rule matched, so the number on the offer is not what it claims to be.
    issues.push(
      issue(
        'warning',
        'zero_tax_rate_on_gross_feed',
        outputName,
        context.taxCountry ? `No tax rule matched for ${context.taxCountry}.` : 'No tax country set.',
      ),
    );
  }
  return { value: formatMoney(amount, context.currencyCode), issues };
}

function applyTransform(value: string, field: ResolvableTemplateField, context: FeedResolutionContext): string {
  if (value === '') return value;
  switch (field.transform) {
    case null:
    case undefined:
    case 'none':
      return value;
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    case 'trim':
      return value.trim();
    case 'truncate': {
      const limit = Number.parseInt(field.transformArg ?? '', 10);
      return Number.isFinite(limit) && limit > 0 ? value.slice(0, limit) : value;
    }
    case 'strip_html':
      return value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    case 'absolute_url': {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
      const origin = context.storefrontOrigin.replace(/\/+$/, '');
      if (origin === '') return value;
      return `${origin}/${value.replace(/^\/+/, '')}`;
    }
    default:
      return value;
  }
}

/**
 * Resolves one field's raw value from the item, before fallback and transform.
 * Returns an empty string for "nothing here"; the caller decides what that means.
 */
function resolveSource(
  field: ResolvableTemplateField,
  item: FeedItemSource,
  context: FeedResolutionContext,
  packQuantity: number,
): FieldOutcome {
  const none: FieldOutcome = { value: '', issues: [] };
  switch (field.sourceKind) {
    case 'constant':
      return { value: field.constantValue ?? '', issues: [] };
    case 'product_id':
      return { value: item.productId, issues: [] };
    case 'sku':
      return { value: item.sku, issues: [] };
    case 'slug':
      return { value: item.slug, issues: [] };
    case 'product_type':
      return { value: item.productType, issues: [] };
    case 'name':
    case 'description': {
      // 168-shim: one string per item now (FR-014); the per-language pick moves to S2's reader.
      const text = field.sourceKind === 'name' ? item.name : item.description;
      return { value: text ?? '', issues: [] };
    }
    case 'brand': {
      const key = field.sourceKey ?? DEFAULT_BRAND_KEY;
      const raw = item.attributes[key] ?? item.customFields[key];
      return { value: stringifyValue(raw), issues: [] };
    }
    case 'attribute':
    case 'custom_field': {
      if (!field.sourceKey) return none;
      // One registry since feature 061 — an attribute IS a product-host custom
      // field, so both vocabularies resolve through the same lookup.
      const raw = item.attributes[field.sourceKey] ?? item.customFields[field.sourceKey];
      return { value: stringifyValue(raw), issues: [] };
    }
    case 'price':
      return priceValue(item.price, context, field.outputName, packQuantity);
    case 'sale_price':
      return priceValue(item.salePrice, context, field.outputName, packQuantity);
    case 'pack_quantity':
      return { value: packQuantity > 1 ? String(packQuantity) : '', issues: [] };
    case 'pack_unit_pricing_measure':
    case 'pack_unit_pricing_base_measure':
      // The base is the pack itself, so the unit price Google shows is the
      // pack price, exact — `1,25 PLN / 100 ct`, never a rounded `0,01 PLN / 1 ct`.
      return { value: packCountMeasure(packQuantity), issues: [] };
    case 'availability':
      if (item.inStock === null) return none;
      return { value: item.inStock ? 'in_stock' : 'out_of_stock', issues: [] };
    case 'stock_quantity':
      return item.stockQuantity === null ? none : { value: String(item.stockQuantity), issues: [] };
    case 'link': {
      const origin = context.storefrontOrigin.replace(/\/+$/, '');
      if (origin === '' || item.slug === '') {
        return {
          value: '',
          issues: [
            issue(
              'warning',
              'unresolvable_link',
              field.outputName,
              'No storefront URL is configured for this feed’s sales channel.',
            ),
          ],
        };
      }
      // Feature 167 (FR-033, FR-034) — the product's own key in the feed's link
      // language, under that language's path prefix; `productPath` is the one
      // product URL composer.
      const path = productPath({ key: item.slug, languageCode: feedLinkLanguage(context), channel: context.channelUrl });
      return { value: `${origin}${path}`, issues: [] };
    }
    case 'image_link': {
      const first = item.imageUrls[0];
      if (first) return { value: first, issues: [] };
      // Distinguish "has no image" from "has images we may not publish" — the
      // second is an actionable asset-visibility problem, the first is not.
      const reason: FeedRunIssueReason =
        item.privateImageCount > 0 ? 'private_image_asset' : 'missing_image';
      return { value: '', issues: [issue('warning', reason, field.outputName)] };
    }
    case 'additional_image_link':
      return {
        value: item.imageUrls.slice(1).join(ADDITIONAL_IMAGE_SEPARATOR),
        issues: [],
      };
    case 'category_path':
      return { value: item.categoryPath.join(CATEGORY_PATH_SEPARATOR), issues: [] };
    case 'provider_category': {
      if (item.providerCategory) return { value: item.providerCategory, issues: [] };
      // FR-083: omit the field and STILL EMIT the item. Both providers treat
      // the category as optional and infer one, so skipping a sellable product
      // over it would shrink the feed for nothing. The distinct reason is what
      // lets run diagnostics separate "never mapped" from "went stale".
      const reason = item.providerCategoryMissReason ?? 'unmapped_provider_category';
      return { value: '', issues: [issue('warning', reason, field.outputName)] };
    }
    case 'grouping_id':
      return { value: item.groupingId ?? item.productId, issues: [] };
    default:
      return none;
  }
}

/**
 * The reason recorded when a required field cannot be satisfied. The generic
 * answer is `missing_required_field`; two source kinds have a more specific,
 * more actionable reason and use it instead.
 */
function requiredFailureReason(field: ResolvableTemplateField): FeedRunIssueReason {
  if (field.sourceKind === 'price' || field.sourceKind === 'sale_price') return 'missing_price';
  return 'missing_required_field';
}

/**
 * The pack every price of this item is published for (issue #430): 1 for a
 * price with two significant places, else the largest pack any price the
 * template publishes needs — the price and the sale price describe one offer,
 * so they are of the same pack. A skip when the template cannot state a pack
 * (it binds no `pack_quantity` field) or no pack of at most 10 000 is exact.
 */
function packFor(input: ResolveFeedItemInput): { quantity: number } | { skip: ResolvedItemIssue } {
  const template = input.templateFields ?? input.fields;
  let quantity = 1;
  for (const field of template) {
    const price =
      field.sourceKind === 'price' ? input.item.price : field.sourceKind === 'sale_price' ? input.item.salePrice : null;
    if (!price) continue;
    const needed = feedPackQuantity(price.net);
    const unitPrice = `${price.net} ${input.context.currencyCode}`;
    if (needed === null) {
      return {
        skip: issue(
          'skip',
          'sub_cent_price_beyond_pack_limit',
          field.outputName,
          `The unit price ${unitPrice} has more than two decimal places, and no pack of up to ` +
            `${MAX_FEED_PACK_QUANTITY} units makes it exact to the cent.`,
        ),
      };
    }
    if (needed > 1 && !template.some((f) => f.sourceKind === 'pack_quantity')) {
      return {
        skip: issue(
          'skip',
          'sub_cent_price_without_pack_field',
          field.outputName,
          `The unit price ${unitPrice} has more than two decimal places. It can be published only ` +
            `as the price of a pack of ${needed}, and this template has no field bound to the pack size.`,
        ),
      };
    }
    quantity = Math.max(quantity, needed);
  }
  return { quantity };
}

/**
 * The language a feed's product links are in (feature 167, FR-034): the feed's
 * language when the channel serves it (exact tag, then primary subtag), else the
 * channel's default language — a feed may be written in a language the channel has
 * no pages in. Without channel facts, the feed's language.
 */
export function feedLinkLanguage(context: { languageCode: string; channelUrl?: ChannelUrlFacts | undefined }): string {
  if (!context.channelUrl) return context.languageCode;
  const languages = channelUrlLanguages(context.channelUrl);
  const wanted = context.languageCode.toLowerCase();
  return (
    languages.find((l) => l.languageCode.toLowerCase() === wanted) ??
    languages.find((l) => l.languageCode.split('-')[0]!.toLowerCase() === wanted.split('-')[0]) ??
    languages.find((l) => l.isDefault)!
  ).languageCode;
}

export function resolveFeedItem(input: ResolveFeedItemInput): ResolvedFeedItem {
  const fields: FeedItemField[] = [];
  const issues: ResolvedItemIssue[] = [];
  let skipReason: FeedRunIssueReason | null = null;

  // Never a sub-cent price rounded to two places (issue #430): a pack, or no item.
  const pack = packFor(input);
  if ('skip' in pack) {
    return { fields: [], issues: [pack.skip], skipped: true, skipReason: pack.skip.reason };
  }

  for (const field of input.fields) {
    const sourced = resolveSource(field, input.item, input.context, pack.quantity);
    let value = sourced.value;
    let carryIssues = sourced.issues;

    if (value === '' && field.fallbackValue != null && field.fallbackValue !== '') {
      value = field.fallbackValue;
      // The fallback did its job, so a diagnostic about the empty source would
      // be noise — except a language substitution, which the operator asked to
      // be counted (FR-040). Keep only the reasons that survive a fallback.
      carryIssues = carryIssues.filter((i) => i.reason === 'missing_translation');
    }

    value = applyTransform(value, field, input.context);

    if (value === '') {
      if (field.providerRequired) {
        const reason = requiredFailureReason(field);
        skipReason ??= reason;
        issues.push(
          issue(
            'skip',
            reason,
            field.outputName,
            `Required field "${field.outputName}" has no value and no fallback.`,
          ),
        );
      }
      // An absent optional field is omitted, never written as an empty value.
      issues.push(...carryIssues);
      continue;
    }

    issues.push(...carryIssues);
    fields.push({ name: field.outputName, value });
  }

  return {
    fields,
    issues,
    skipped: skipReason !== null,
    skipReason,
  };
}

/** Class form of the same logic, for injection as the overlay seam. */
export class ItemFieldResolver implements ItemFieldResolverPort {
  resolve(input: ResolveFeedItemInput): ResolvedFeedItem {
    return resolveFeedItem(input);
  }
}
