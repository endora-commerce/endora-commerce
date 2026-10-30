import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { storefrontPagePath, type ChannelUrlFacts } from './storefront-language-path.js';

/**
 * Feature 163, rewritten by feature 168 (`specs/168-product-editor-scope-switcher/contracts/
 * url-keys.md`, research R12) — product URL keys at Global (`products.slug`), Channel and
 * Channel × language, their redirects per (channel, language), and the one helper that composes
 * a product URL.
 *
 * A key text belongs to at most one product per channel across all the channel's languages,
 * orphans included; the same product may repeat it (owner round 7). There is no Language-only
 * key (FR-010).
 *
 * Kept apart from `product-scopes.ts` so the URL-key work edits its own file. This module is a
 * leaf for runtime imports: it imports nothing from the catalogue contracts.
 */

// --- Key grammar ---------------------------------------------------------------

/**
 * A product URL key: the grammar of `products.slug` (lower-case kebab case, at most
 * 160 characters — the column width). Global, channel and channel × language keys
 * all share it. Every writer normalises to NFC and lower case first ({@link normaliseUrlKey}).
 */
export const productSlugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case');
export type ProductSlug = z.infer<typeof productSlugSchema>;

const languageCodeSchema = z.string().min(1).max(16);

/** NFC, then lower case — what every key writer does before {@link productSlugSchema} (R12). */
export function normaliseUrlKey(raw: string): string {
  return raw.normalize('NFC').toLowerCase();
}

/** The most keys a `confirmTakeover` list names (R21). */
export const URL_KEY_TAKEOVER_MAX = 20;
/** The most redirects kept per (product, channel); the oldest are dropped (R12). */
export const URL_REDIRECTS_PER_CHANNEL_MAX = 50;
/** The most new keys one import or connector run reserves; the rest are `limit_reached` (R12). */
export const URL_KEYS_PER_RUN_MAX = 1000;

// --- The one URL seam (D7, Q-B → C) --------------------------------------------

export interface ProductPathInput {
  /** The effective key at (channel, language). */
  key: string;
  /** The content language the URL is for — already resolved against the channel. */
  languageCode: string;
  /** The channel's URL-language facts (feature 167): its languages, default and prefix setting. */
  channel: ChannelUrlFacts;
}

/**
 * The storefront path of a product page: `/p/<key>` under the language's path prefix
 * (`/en/p/drill`, or `/p/wiertarka` for the default language of a channel that does
 * not prefix it).
 *
 * **This is the only place a product URL is composed.** Every URL the platform
 * emits for a product — the admin's preview link, the resolve answer's redirect
 * target, the PDP's canonical and alternates, the sitemap, the product feeds — is
 * built here by the backend. A key is valid only in its own language (K1), so the
 * language travels with the link as its path prefix
 * (`specs/167-storefront-locale-path/`, which replaced 163's interim `?lang=`).
 */
export function productPath(input: ProductPathInput): string {
  return storefrontPagePath({
    path: `/p/${encodeURIComponent(input.key)}`,
    languageCode: input.languageCode,
    channel: input.channel,
  });
}

/** The unprefixed product path — the `x-default` target (`specs/167-storefront-locale-path/` url-shape §8). */
export function productDefaultPath(key: string): string {
  return `/p/${encodeURIComponent(key)}`;
}

// --- Admin read — GET /api/v1/admin/catalog/products/:id/url-keys ----------------

export const productUrlKeySourceSchema = z.enum(['channel_language', 'channel', 'global']);
export type ProductUrlKeySource = z.infer<typeof productUrlKeySourceSchema>;

/** A redirect answers at one (channel, language) (feature 168, `url-keys.md` §4). */
export const productUrlRedirectSchema = z.object({
  id: uuidSchema,
  channelId: uuidSchema,
  languageCode: languageCodeSchema,
  key: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ProductUrlRedirect = z.infer<typeof productUrlRedirectSchema>;

export const productUrlKeysResponseSchema = z.object({
  data: z.object({
    /** `products.slug` — the Global key. */
    globalKey: z.string(),
    /** `languageCode: null` = the Channel key. */
    channelKeys: z.array(
      z.object({
        channelId: uuidSchema,
        languageCode: languageCodeSchema.nullable(),
        key: z.string(),
        orphaned: z.boolean(),
      }),
    ),
    effective: z.array(
      z.object({
        channelId: uuidSchema,
        languageCode: languageCodeSchema,
        key: z.string(),
        source: productUrlKeySourceSchema,
        /** {@link productPath} for this (channel, language). */
        url: z.string(),
      }),
    ),
    /** Omitted when `seo` is not effectively present (Q-C, Constitution XVII). */
    redirects: z.array(productUrlRedirectSchema).optional(),
  }),
});
export type ProductUrlKeysResponse = z.infer<typeof productUrlKeysResponseSchema>;

// --- Admin write — PUT /api/v1/admin/catalog/products/:id/url-keys ----------------

/** The most entries one list of a URL-keys PUT carries (Phase 16 review; the scopes PATCH's bound). */
const URL_KEY_LIST_MAX = 64;

/** `{ inherit: true }` — the write encoding's "remove the own key" (`write-encoding.md` §5). */
const inheritKeySchema = z.object({ inherit: z.literal(true) }).strict();

export const putProductUrlKeysRequestSchema = z
  .object({
    globalKey: productSlugSchema.optional(),
    /**
     * Keys at Channel (`languageCode` absent or `null`) or Channel × language. `key` is a key or
     * `{ inherit: true }` (deletes the row); `null` is refused — the URL key is required (FR-062).
     */
    channelKeys: z
      .array(
        z
          .object({
            channelId: uuidSchema,
            languageCode: languageCodeSchema.nullable().optional(),
            key: z.union([productSlugSchema, inheritKeySchema]),
          })
          .strict(),
      )
      .max(URL_KEY_LIST_MAX)
      .optional(),
    /** The operator's confirmation of taking over another product's redirect (163 FR-072). */
    confirmTakeover: z.array(productSlugSchema).max(URL_KEY_TAKEOVER_MAX).optional(),
  })
  .strict();
export type PutProductUrlKeysRequest = z.infer<typeof putProductUrlKeysRequestSchema>;

/**
 * Where a conflict sits: `channelId` `null` = the Global key (slug); `languageCode` `null` = a
 * Channel key or the slug.
 */
const keyAddressSchema = { channelId: uuidSchema.nullable(), languageCode: languageCodeSchema.nullable() };

/** `409 URL_KEY_TAKEN` details. */
export const urlKeyTakenDetailsSchema = z.object({
  conflicts: z.array(
    z.object({
      ...keyAddressSchema,
      key: z.string(),
      heldByProductId: uuidSchema,
      heldByProductName: z.string(),
    }),
  ),
});
export type UrlKeyTakenDetails = z.infer<typeof urlKeyTakenDetailsSchema>;

/** `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` details. */
export const urlKeyRedirectTakeoverRequiredDetailsSchema = z.object({
  takeovers: z.array(
    z.object({
      ...keyAddressSchema,
      key: z.string(),
      losingProductId: uuidSchema,
      losingProductName: z.string(),
    }),
  ),
});
export type UrlKeyRedirectTakeoverRequiredDetails = z.infer<typeof urlKeyRedirectTakeoverRequiredDetailsSchema>;

/** `404 URL_REDIRECT_NOT_FOUND` details. */
export const urlRedirectNotFoundDetailsSchema = z.object({ redirectId: uuidSchema });
export type UrlRedirectNotFoundDetails = z.infer<typeof urlRedirectNotFoundDetailsSchema>;

// --- Public resolve — GET /api/v1/catalog/products/resolve/:key (§4) ------------

export const productKeyResolutionSchema = z.discriminatedUnion('kind', [
  /** `key` is the effective key at (channel, language). */
  z.object({ kind: z.literal('product'), productId: uuidSchema, key: z.string() }),
  /**
   * `path` = {@link productPath} built by catalog. `permanent: true` — a former key (163),
   * answered 308; `false` — a current key of the same product in another channel
   * language (feature 167, FR-024), answered 307 because the mapping depends on key data
   * that can change hands.
   */
  z.object({
    kind: z.literal('redirect'),
    key: z.string(),
    languageCode: languageCodeSchema,
    path: z.string(),
    permanent: z.boolean(),
  }),
]);
export type ProductKeyResolution = z.infer<typeof productKeyResolutionSchema>;

// --- Storefront product page — the PDP response's `paths` (§6) -----------------

/**
 * The product page's own URLs, ready-made by catalog with {@link productPath}: the
 * canonical for the request's (channel, language), and one alternate per channel
 * language where the product is available to the **anonymous** audience (FR-074 —
 * `hreflang` advertises only what a crawler may open). The storefront renders them
 * verbatim: it composes no product URL of its own.
 */
export const productPagePathsSchema = z.object({
  canonical: z.string(),
  alternates: z.array(z.object({ languageCode: languageCodeSchema, path: z.string() })),
  /** {@link productDefaultPath} of the key at the channel's default language — `hreflang="x-default"`. */
  xDefault: z.string(),
});
export type ProductPagePaths = z.infer<typeof productPagePathsSchema>;

// --- Connectors and import (§5) ------------------------------------------------

/**
 * Per `urlKey` cell written through `catalogProductScopeWritePort.applyScopes` or a CSV import:
 * written, or not written with the reason. An integration never takes over a redirect and is
 * never asked to confirm one; the product keeps its previous key at that scope (163 FR-093).
 * `limit_reached` — the run already reserved {@link URL_KEYS_PER_RUN_MAX} new keys (R12).
 */
export const urlKeyWriteOutcomeSchema = z.union([
  z.object({ written: z.literal(true) }),
  z.object({
    written: z.literal(false),
    issue: z.object({
      ...keyAddressSchema,
      key: z.string(),
      /** `null` for `limit_reached`. */
      heldByProductId: uuidSchema.nullable(),
      kind: z.enum(['current', 'redirect', 'limit_reached']),
    }),
  }),
]);
export type UrlKeyWriteOutcome = z.infer<typeof urlKeyWriteOutcomeSchema>;

// --- Port — catalogProductUrlKeyReadPort (owner `catalog`, R28) ------------------

/**
 * Container name: `catalogProductUrlKeyReadPort`. Owner: `catalog`.
 *
 * URL keys for whole-channel readers such as `seo`'s sitemap generator (R28).
 * `catalog` is non-deactivatable, so the port is always present.
 */
export interface CatalogProductUrlKeyReadPort {
  /**
   * The effective key per channel language for each product: the product's
   * channel × language key, else its channel key, else its global key. Products the
   * channel does not carry are absent.
   *
   * **Applies no availability beyond membership** (checkpoint C security review, I8):
   * a member product switched off, outside its window or outside its audience still
   * has keys here. A buyer-facing caller narrows the ids with
   * `catalogProductAvailabilityPort.filterAvailable` first and links only what is left.
   */
  effectiveKeys(productIds: readonly string[], channelId: string): Promise<Map<string, Map<string, string>>>;
}
