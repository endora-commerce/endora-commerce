import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { SalesChannelCodeSchema } from './sales-channels.js';
import type { ScopeRef, ScopedSource, SeoProductMetaField } from './product-scope-model.js';
import type { ScopedFieldView } from './product-scoped-values.js';
import type { ScopedWriteOp } from './scoped-write-encoding.js';

/**
 * SEO meta + sitemap contracts (T235 / FR-101, FR-102).
 *
 * The `entityType` enum is closed — only entities the storefront actually
 * renders public pages for can carry meta overrides.
 */

export const seoEntityTypeSchema = z.enum(['product', 'category', 'cms_page']);
export type SeoEntityType = z.infer<typeof seoEntityTypeSchema>;

export const resolvedMetaSchema = z.object({
  title: z.string(),
  description: z.string(),
  openGraph: z.object({
    title: z.string(),
    description: z.string(),
    image: z.string().nullable(),
  }),
  /** Whether the resolved values came from a stored override or the rule. */
  source: z.enum(['override', 'rule']),
  locale: z.string(),
});
export type ResolvedMeta = z.infer<typeof resolvedMetaSchema>;

export const seoMetaOverrideSchema = z.object({
  id: uuidSchema,
  entityType: seoEntityTypeSchema,
  entityId: uuidSchema,
  /** `null` = a sales channel row (feature 163). */
  locale: z.string().min(2).max(10).nullable(),
  /** Feature 163 — `null` = a language row, for every channel. */
  channelId: uuidSchema.nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogDescription: z.string().nullable(),
  /** As written: an http(s) URL or a site-relative path ({@link ogImageUrlSchema}). */
  ogImageUrl: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * Where an override sits (feature 163, `contracts/seo-media-attachments.md` §1):
 * `locale` only = the language row, `channelId` only = the sales channel row,
 * both = the channel × language row. Naming **neither** keeps the meaning every
 * caller before feature 163 relied on — the `en-US` language row. Only a
 * `product` takes a `channelId`.
 */
export const seoMetaScopeQuerySchema = z.object({
  locale: z.string().min(2).max(10).optional(),
  channelId: uuidSchema.optional(),
});
export type SeoMetaScopeQuery = z.infer<typeof seoMetaScopeQuerySchema>;

/**
 * Feature 163 (checkpoint E security review, I5) — an Open Graph image URL: an
 * absolute `http(s)` URL or a site-relative path (`/…`, never `//…` or `/\…`). It is
 * written into every page's `og:image`, so no other scheme is accepted.
 */
export const ogImageUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => /^https?:\/\/[^\s/?#\\]+[^\s\\]*$/i.test(value) || /^\/(?![/\\])[^\s\\]*$/.test(value),
    { message: 'an http(s) URL or a path starting with a single /' },
  );

export const upsertSeoMetaOverrideRequestSchema = z.object({
  /** Optional since feature 163 — see {@link seoMetaScopeQuerySchema} for the addressing rule. */
  locale: z.string().min(2).max(10).optional(),
  /** Feature 163 — the sales channel scope of a product override. */
  channelId: uuidSchema.optional(),
  title: z.string().min(1).max(160).nullable().optional(),
  description: z.string().min(1).max(400).nullable().optional(),
  ogTitle: z.string().min(1).max(160).nullable().optional(),
  ogDescription: z.string().min(1).max(400).nullable().optional(),
  ogImageUrl: ogImageUrlSchema.nullable().optional(),
});
export type UpsertSeoMetaOverrideRequest = z.infer<typeof upsertSeoMetaOverrideRequestSchema>;

export const sitemapStatusSchema = z.object({
  generatedAt: isoDateTimeSchema.nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  urlCount: z.number().int().nonnegative().nullable(),
});
export type SitemapStatus = z.infer<typeof sitemapStatusSchema>;

/**
 * Per-channel sitemap row returned by the admin list endpoint
 * (`GET /api/v1/admin/seo/sitemap`). One row per active sales channel —
 * each carries its own cache (regenerate, preview and download act on a
 * single channel) and its own resolved storefront URL.
 */
export const sitemapChannelStatusSchema = sitemapStatusSchema.extend({
  salesChannelCode: z.string(),
  salesChannelName: z.string(),
  storefrontUrl: z.string(),
  storefrontUrlSource: z.enum(['setting', 'env', 'fallback']),
});
export type SitemapChannelStatus = z.infer<typeof sitemapChannelStatusSchema>;

export const sitemapChannelListResponseSchema = z.object({
  data: z.array(sitemapChannelStatusSchema),
});
export type SitemapChannelListResponse = z.infer<typeof sitemapChannelListResponseSchema>;

/**
 * A sales channel's default robots policy, as the storefront reads it from
 * `GET /api/v1/storefront/seo/robots-policy`.
 *
 * Two booleans and nothing else. The operator's choice is stored by `seo` as a
 * token (`NOINDEX, FOLLOW` …); that spelling is the module's own and never
 * crosses the wire, so a consumer branches on `index` and `follow` and the
 * stored vocabulary can change without a storefront noticing.
 *
 * **Strict about what it reads, tolerant of what it does not know.** `index`
 * and `follow` must both be present and must both be booleans: a storefront
 * validates the answer against this schema and treats a body that fails it as
 * unreadable, and a policy with half of it missing is not one to guess at.
 *
 * A member this schema does not name is **dropped, not refused**. A storefront
 * is deployed separately from its backend and is usually the older of the two;
 * were an unknown member a failure, the first backend release to add a field
 * here would make every storefront already in the field read the answer as
 * unreadable — and a freshly started one would then serve a `noindex` channel
 * with no directive at all, with nothing to say why. Additive changes to this
 * response are therefore safe by construction, and a consumer never sees a
 * member it was not written for.
 */
export const storefrontRobotsPolicySchema = z.object({
  /** `false` asks search engines not to index the channel's storefront. */
  index: z.boolean(),
  /** `false` asks search engines not to follow the links on its pages. */
  follow: z.boolean(),
});
export type StorefrontRobotsPolicy = z.infer<typeof storefrontRobotsPolicySchema>;

export const storefrontRobotsPolicyResponseSchema = z.object({
  data: storefrontRobotsPolicySchema,
});
export type StorefrontRobotsPolicyResponse = z.infer<typeof storefrontRobotsPolicyResponseSchema>;

/**
 * The most an operator may save as custom `robots.txt` instructions or as
 * additional `llms.txt` content, per sales channel: 64 KiB of UTF-8.
 *
 * **Bytes, not characters** — it bounds the file a crawler downloads, and one
 * character is up to four bytes. The `seo` module refuses a larger text when
 * it is saved. Search engines read the first 500 KiB of a `robots.txt`; the
 * system-generated rules are under 1 KiB, so the whole file stays well inside
 * that.
 */
export const CRAWLER_TEXT_MAX_BYTES = 65_536;

/** In `unreadable`: the channel's default robots — `index` and `follow` — is not known. */
export const CRAWLER_FILES_UNREADABLE_POLICY = 'policy';
/** In `unreadable`: the channel's additional `llms.txt` content is not known. */
export const CRAWLER_FILES_UNREADABLE_LLMS_TXT = 'llmsTxtAdditional';

/**
 * What a sales channel's crawler files are built from, as the storefront reads
 * it from `GET /api/v1/storefront/seo/crawler-files`.
 *
 * The two texts are the values resolved for the channel — its own, else the
 * all-channels value, else empty — **exactly as stored**: the backend changes
 * no character of them, line breaks included. What a served file does with
 * them is {@link composeCrawlerFile}'s to say.
 *
 * `index` and `follow` repeat the robots policy so that a file whose existence
 * depends on it needs one read rather than two.
 *
 * ## `unreadable` — the parts of the answer fail apart
 *
 * `robots.txt` reads the texts and never the policy; `llms.txt` reads all of
 * it. Were one unreadable stored value to fail the whole answer, a channel
 * whose *Default robots* row holds a value nobody can interpret would lose its
 * `robots.txt` — a file that row has no say in. So the backend answers `200`
 * and **names** what it could not read:
 *
 *  * {@link CRAWLER_FILES_UNREADABLE_POLICY} — `index` and `follow` are then
 *    both `false`, the restrictive reading, and mean "not known";
 *  * {@link CRAWLER_FILES_UNREADABLE_LLMS_TXT} — `llmsTxtAdditional` is then
 *    `''` and means "not known".
 *
 * A file that needs a named member treats it as unknown and is not served; a
 * file that does not is unaffected. The member is optional and additive: a
 * backend older than it never sends it (it failed the whole answer instead),
 * and a storefront older than it ignores it — and reads neither of the two
 * members it can name, which is why those two, and only those, may be answered
 * this way. `robotsTxtCustom` is read by every storefront that has this
 * endpoint, so an unreadable one still fails the whole answer: a `200` with an
 * empty text would be a `robots.txt` that silently omits an operator's rules.
 *
 * It is a list of names, not a closed enum, so that a later backend can name
 * something else without an earlier storefront finding the answer unreadable.
 *
 * Strict about the members it names and tolerant of any it does not, for the
 * reason given at {@link storefrontRobotsPolicySchema}. The `max` on the texts
 * is in characters and is deliberately the looser test: a text within the byte
 * limit never has more characters than that, so a longer one did not come
 * through the door that enforces the limit, and a storefront treats the answer
 * as unreadable rather than serve it.
 */
export const storefrontCrawlerFilesSchema = storefrontRobotsPolicySchema.extend({
  /** The operator's `robots.txt` instructions, or `''`. */
  robotsTxtCustom: z.string().max(CRAWLER_TEXT_MAX_BYTES),
  /** The operator's additional `llms.txt` content, or `''`. */
  llmsTxtAdditional: z.string().max(CRAWLER_TEXT_MAX_BYTES),
  shop: z.object({
    /** The channel's configured shop name, or `''` when none is set. */
    name: z.string(),
  }),
  /** The members above that could not be read. Absent means none. */
  unreadable: z.array(z.string()).optional(),
  /**
   * Whether the channel is open to anonymous visitors
   * (`specs/154-sales-channel-access/`). `false` is a store with nothing
   * public: its `robots.txt` disallows everything and names no sitemap, and
   * its `llms.txt` names the store and lists nothing — whatever the texts and
   * the policy above say. The texts are still answered as stored.
   *
   * Optional and additive: a backend older than it never sends it, and its
   * channels are all open; a consumer reads its absence as `true`.
   */
  anonymousAccess: z.boolean().optional(),
});
export type StorefrontCrawlerFiles = z.infer<typeof storefrontCrawlerFilesSchema>;

export const storefrontCrawlerFilesResponseSchema = z.object({
  data: storefrontCrawlerFilesSchema,
});
export type StorefrontCrawlerFilesResponse = z.infer<typeof storefrontCrawlerFilesResponseSchema>;

/**
 * A crawler file: the part the storefront generates, then the part an operator
 * wrote.
 *
 * One function, shared by the storefront that serves the file and by the Admin
 * UI that previews it, so the two cannot come to disagree about the join.
 *
 *  * `extra` empty or made only of whitespace → `base`, **byte for byte**. An
 *    instance nobody configured serves exactly what it generated.
 *  * otherwise → `base` ending in one line break, one blank line, `extra`, one
 *    line break.
 *
 * ## What happens to `extra` — the definition of "verbatim"
 *
 * Every character of it is kept, unchanged and in order — indentation,
 * trailing spaces, blank lines, comments, anything that is not a line break at
 * all. Two things are normalised, and both are about line breaks:
 *
 *  * **every line break is served as a line feed**, whether it was stored as
 *    `LF`, `CRLF` or a lone `CR`. A browser's text field sends `LF`; the
 *    settings API stores what it is sent, so a client that sends `CRLF` stores
 *    `CRLF`. Without this, one file would carry two conventions — the
 *    generated part's and the operator's — and the same text would be served
 *    as different bytes depending on which client saved it;
 *  * **line breaks at the end of the text become exactly one**, so the file
 *    always ends with a single line break.
 *
 * And one thing is removed that is not a line break: **a single byte order
 * mark (`U+FEFF`) at the very start of the text.** Editors put one there
 * unseen. Served, it is glued to the first line, and a crawler does not
 * recognise `\uFEFFUser-agent: …` as the start of a group — so the rules
 * under it attach to the group above, which is the generated one for every
 * crawler, and a `Disallow: /` written for one crawler would close the site
 * to all of them. Exactly one, and only there: a second one, or one anywhere
 * else in the text, is the operator's character like any other.
 *
 * `base` is never altered apart from the line breaks it ends with.
 *
 * ## Its cost is proportional to the text
 *
 * It runs for every request of a public file, on text an operator saved, so
 * it must not be possible to write a text that makes it slow. The trailing
 * line breaks are therefore counted from the end rather than matched with
 * `/\n+$/`: that pattern re-scans a run of line breaks from each of its
 * positions when the run is not at the end, and took four and a half seconds
 * on 64 KiB of them — during which a single-threaded server answers nobody.
 * `seo.test.ts` holds the function to a time bound on such texts.
 */
export function composeCrawlerFile(base: string, extra: string): string {
  const written = extra.charCodeAt(0) === BYTE_ORDER_MARK ? extra.slice(1) : extra;
  if (written.trim().length === 0) return base;
  // One pass, no backtracking: a `\r` is consumed with the `\n` after it, if any.
  const text = withoutTrailingLineFeeds(written.replace(/\r\n?/g, '\n'));
  return `${withoutTrailingLineFeeds(base)}\n\n${text}\n`;
}

const BYTE_ORDER_MARK = 0xfeff;
const LINE_FEED = 0x0a;

/** `text` without the line feeds it ends with. Linear in their number. */
function withoutTrailingLineFeeds(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === LINE_FEED) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/**
 * The response header by which a storefront says it serves crawler files the
 * way `specs/144-seo-search-engine-robots/` describes — it joins the
 * operator's text to its own rules and answers `?part=system` with its own
 * rules alone.
 *
 * A storefront is deployed separately from its backend and is often the older
 * of the two. One that predates the feature ignores `?part=system` and answers
 * its whole file, which looks exactly like an answer; the header is how the
 * preview tells the two apart instead of showing a file that storefront will
 * never serve.
 */
export const CRAWLER_FILES_CAPABILITY_HEADER = 'X-Endora-Crawler-Files';

/** The crawler file a preview is asked for. */
export const adminCrawlerFileSchema = z.enum(['robots', 'llms']);
export type AdminCrawlerFile = z.infer<typeof adminCrawlerFileSchema>;

/**
 * What `GET /api/v1/admin/seo/crawler-files/preview` is asked
 * (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §3).
 *
 * **Two members, both closed, and neither is an address.** The backend makes a
 * request to a storefront on the caller's behalf, so what the caller may say
 * is which of two files and which sales channel — a code, in the shape every
 * channel code has. Where the request goes is the channel's configured
 * storefront address and nothing a caller sends; the object is strict so that
 * a member nobody declared is refused rather than ignored, and adding one is a
 * visible change to this schema.
 */
export const adminCrawlerFilePreviewQuerySchema = z.strictObject({
  file: adminCrawlerFileSchema,
  /**
   * The sales channel to preview. Absent means the **system default channel**,
   * which always exists — it is what an administrator who may read settings
   * but may not list sales channels asks for (FR-045). There is still no
   * cross-channel file: the answer names the one channel it is about.
   */
  salesChannelCode: SalesChannelCodeSchema.optional(),
});
export type AdminCrawlerFilePreviewQuery = z.infer<typeof adminCrawlerFilePreviewQuerySchema>;

/**
 * What became of asking the channel's storefront for the part it generates.
 *
 *  * `ok` — it answered, and said it serves crawler files the current way;
 *  * `storefront-outdated` — it answered without
 *    {@link CRAWLER_FILES_CAPABILITY_HEADER}: it predates the feature, serves
 *    its own rules alone and applies none of the `seo` crawler settings;
 *  * `not-served` — `llms` only: the storefront serves no such file for the
 *    channel;
 *  * `storefront-unreachable` — no usable answer. Deliberately one state for a
 *    refusal, a timeout, a redirect, an error status, an answer that is not
 *    plain text and one that is too large: the endpoint tells an administrator
 *    whether the preview can be shown, not what is listening at an address;
 *  * `address-unknown` — no storefront address is configured for the channel,
 *    and no request was made.
 */
export const adminCrawlerFilePreviewStateSchema = z.enum([
  'ok',
  'storefront-outdated',
  'not-served',
  'storefront-unreachable',
  'address-unknown',
]);
export type AdminCrawlerFilePreviewState = z.infer<typeof adminCrawlerFilePreviewStateSchema>;

/** States whose answer carries no storefront-generated part at all. */
const STATES_WITHOUT_BASE: readonly AdminCrawlerFilePreviewState[] = [
  'not-served',
  'storefront-unreachable',
  'address-unknown',
];

/**
 * The preview of one sales channel's crawler file.
 *
 * `base` is the part the storefront generates, as that storefront answered it
 * a moment ago — never a copy the backend keeps (FR-041). It is `null`
 * whenever it was not obtained, so a consumer cannot show remembered or
 * invented rules as current (FR-042); the schema holds the two to each other.
 *
 * `savedExtra` is the operator's stored text as it resolves for the channel,
 * character for character. The Admin UI joins the two with
 * {@link composeCrawlerFile}, the function the storefront serves with.
 *
 * `base` is text a remote server sent. A consumer renders it as text.
 */
export const adminCrawlerFilePreviewSchema = z
  .object({
    file: adminCrawlerFileSchema,
    salesChannelCode: SalesChannelCodeSchema,
    state: adminCrawlerFilePreviewStateSchema,
    base: z.string().nullable(),
    /** The stored text that resolves for the channel, or `''`. */
    savedExtra: z.string(),
    /** Where that text comes from: the channel's own value, the all-channels value, or neither. */
    savedExtraSource: z.enum(['channel', 'global', 'default']),
    /** The codes of the channels holding a value of their own for the setting. */
    channelsWithOwnValue: z.array(SalesChannelCodeSchema),
    /** The channel's saved *Default robots*, as the storefront reads it. */
    policy: storefrontRobotsPolicySchema,
    storefront: z.object({
      /** The address the channel's storefront is taken to be at. */
      url: z.string(),
      /**
       * `setting` — the channel's own configured address; `env` — the
       * deployment-wide one, shared by every channel; `fallback` — neither is
       * configured.
       */
      source: z.enum(['setting', 'env', 'fallback']),
    }),
  })
  .superRefine((preview, ctx) => {
    if (preview.state === 'ok' && preview.base === null) {
      ctx.addIssue({ code: 'custom', path: ['base'], message: 'state "ok" carries the base' });
    }
    if (STATES_WITHOUT_BASE.includes(preview.state) && preview.base !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['base'],
        message: `state "${preview.state}" obtained no base and must not carry one`,
      });
    }
  });
export type AdminCrawlerFilePreview = z.infer<typeof adminCrawlerFilePreviewSchema>;

export const adminCrawlerFilePreviewResponseSchema = z.object({
  data: adminCrawlerFilePreviewSchema,
});
export type AdminCrawlerFilePreviewResponse = z.infer<typeof adminCrawlerFilePreviewResponseSchema>;

/**
 * Container name: `seoMetaWritePort`. Owner: `seo`.
 *
 * Narrow write surface for PIM importers (feature 089 / FR-029): upsert product
 * meta overrides by locale — the language rows. Feature 163 added channel and
 * channel × language rows; this port writes none of them, so an import never
 * touches an operator's channel override (FR-091).
 *
 * **Owner off:** resolving this port throws `ModuleDisabledError` (503).
 */
export interface SeoMetaWritePort {
  upsertProductMeta(input: {
    productId: string;
    locale: string;
    title?: string | null;
    description?: string | null;
  }): Promise<void>;
}

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/contracts/seo-ports.md`; research R9,
 * R21) — product metadata at the three product scopes: Global (no channel, no locale),
 * Channel (channel, no locale) and Channel × language. There is no locale-only product row any
 * more (FR-010). `SeoProductMetaField` is declared once, in `product-scope-model.ts`.
 */

/** Where an effective metadata value came from; `derived` = the product page's own fallback. */
export type SeoProductMetaSource = ScopedSource | 'derived';

export interface SeoProductMetaValues {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string | null;
}

/** `GET /api/v1/admin/seo/meta/product/:entityId` query — `catalog:read` (FR-093). No locale-only scope. */
export const seoProductMetaQuerySchema = z
  .object({
    channelId: uuidSchema.optional(),
    languageCode: z.string().min(2).max(16).optional(),
  })
  .strict();
export type SeoProductMetaQuery = z.infer<typeof seoProductMetaQuerySchema>;

/**
 * Container name: `seoProductMetaPort`. Owner: `seo` (feature 163 R13, rewritten by 168).
 *
 * `catalog` declares the edge as degrades-without and probes `seo`'s presence before resolving
 * it; with `seo` off the product editor shows no SEO section (FR-092).
 *
 * **Owner off:** resolving this port throws `ModuleDisabledError` (503).
 */
export interface SeoProductMetaPort {
  /**
   * Storefront: effective values at (C, L) along C×L → C → G, then the caller's derived
   * fallback. A field whose effective source is an empty override (`set_empty`) also takes the
   * derived value (owner round 6).
   */
  resolveForProduct(input: {
    productId: string;
    channelId: string;
    languageCode: string;
    fallback: SeoProductMetaValues;
  }): Promise<SeoProductMetaValues & { sources: Record<SeoProductMetaField, SeoProductMetaSource> }>;
  /** Admin: each field's view at one scope; an invalid scope → `422 SCOPE_INVALID`, never an empty view. */
  readScoped(productId: string, scope: ScopeRef): Promise<Record<SeoProductMetaField, ScopedFieldView<string>>>;
  /** Overview: every scope holding a product row. */
  listScopesForProduct(
    productId: string,
  ): Promise<Array<{ channelId: string | null; languageCode: string | null; fields: SeoProductMetaField[] }>>;
}

/** A field's own value at a scope for an audit before-state: a text, an empty override, or none. */
export type SeoProductMetaOwnValue = { own: string | { empty: true } } | { inherited: true };

/**
 * Container name: `seoProductMetaWritePort`. Owner: `seo` (feature 168, FR-091).
 *
 * Writes product metadata **on the caller's EntityManager**: no fork, no flush, no audit entry,
 * no event — `catalog`'s save Command commits or rolls the rows back with its own. `catalog`
 * resolves it with `lazyPort` inside the Command only when the save changes SEO, and declares the
 * edge `refuses-without`.
 *
 * Row mapping: G = (no channel, no locale); C = (channel, no locale); C×L = (channel, locale).
 * `set` → the column holds the value; `empty` → `''`; `inherit` → `NULL`, and a row whose every
 * column is `NULL` is deleted. Refuses (`422 SCOPED_VALUE_INVALID`) `inherit` at Global, an
 * over-long value (title 160, description 400, OG title 160, OG description 400, image URL 2048)
 * and an image URL that is not `http:` / `https:`.
 *
 * **Owner off:** resolving this port throws `ModuleDisabledError` (503).
 */
export interface SeoProductMetaWritePort<EM = unknown> {
  /** The current own values of the named fields at `scope`, for the caller's audit before-state. */
  readWithin(
    em: EM,
    input: { productId: string; scope: ScopeRef; fields: SeoProductMetaField[] },
  ): Promise<Partial<Record<SeoProductMetaField, SeoProductMetaOwnValue>>>;
  applyWithin(
    em: EM,
    input: {
      productId: string;
      scope: ScopeRef;
      changes: Partial<Record<SeoProductMetaField, ScopedWriteOp<string>>>;
    },
  ): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
}
