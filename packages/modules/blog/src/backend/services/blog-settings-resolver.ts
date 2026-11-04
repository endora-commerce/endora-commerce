import { z } from 'zod';
import {
  BLOG_DEFAULT_ENABLED,
  BLOG_DEFAULT_LATEST_COUNT,
  BLOG_DEFAULT_POSTS_PER_PAGE,
  BLOG_DEFAULT_URL_PREFIX,
  BLOG_SETTING_CODES,
} from '../../manifest.js';

/**
 * Thin port over the Settings module — the only surface the Blog module
 * consumes from feature 004. We keep the dependency narrow on purpose
 * (Constitution I): the resolver does not import the Settings entities.
 *
 * `get<T>` throws when the setting is not registered or its value shape
 * mismatches the schema. The resolver swallows those errors and falls
 * back to the documented default (defence-in-depth: a Settings hiccup
 * must not break the storefront, mirroring the comparisons module's
 * `resolveMaxProducts` pattern).
 */
export interface SettingsServicePort {
  /** `salesChannelId` null is a platform-wide read (the kernel port's D-41 tier). */
  get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T>;
}

export interface ResolvedBlogSettings {
  enabled: boolean;
  urlPrefix: string;
  /** Feature 171 (US5) — language code → prefix, overriding `urlPrefix` for that language. */
  urlPrefixByLanguage: Record<string, string>;
  latestCount: number;
  postsPerPage: number;
}

/**
 * BlogSettingsResolver — feature 016 / R7.
 *
 * Wraps `settings.service.getValue('blog.*', salesChannelId)` with:
 *   - default fallbacks (when no row exists yet);
 *   - type coercion (the Settings module's value-type registry stores
 *     primitives as `unknown`; the resolver narrows them);
 *   - range clamps for `latestCount` and `postsPerPage` (any stored value
 *     ≤ 0 falls back to the documented default with a logged warning —
 *     the caller is the Settings admin form, which has already validated
 *     the value, so this branch is a defence-in-depth safeguard).
 *
 * The `blog.url_prefix` write rule is `BlogUrlPrefixService.validator()`,
 * registered with the settings module (feature 171); the regex below only
 * keeps a value stored before that rule existed from reaching a URL.
 */
const URL_PREFIX_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class BlogSettingsResolver {
  constructor(private readonly settings: SettingsServicePort) {}

  async getResolved(salesChannelId: string): Promise<ResolvedBlogSettings> {
    const enabled = await this.readWithFallback(
      BLOG_SETTING_CODES.ENABLED,
      salesChannelId,
      z.boolean(),
      BLOG_DEFAULT_ENABLED,
    );
    const urlPrefixRaw = await this.readWithFallback(
      BLOG_SETTING_CODES.URL_PREFIX,
      salesChannelId,
      z.string(),
      BLOG_DEFAULT_URL_PREFIX,
    );
    const byLanguageRaw = await this.readWithFallback(
      BLOG_SETTING_CODES.URL_PREFIX_BY_LANGUAGE,
      salesChannelId,
      z.unknown(),
      {},
    );
    const latestCount = await this.readWithFallback(
      BLOG_SETTING_CODES.LATEST_COUNT,
      salesChannelId,
      z.number(),
      BLOG_DEFAULT_LATEST_COUNT,
    );
    const postsPerPage = await this.readWithFallback(
      BLOG_SETTING_CODES.POSTS_PER_PAGE,
      salesChannelId,
      z.number(),
      BLOG_DEFAULT_POSTS_PER_PAGE,
    );

    return {
      enabled,
      urlPrefix: URL_PREFIX_REGEX.test(urlPrefixRaw) ? urlPrefixRaw : BLOG_DEFAULT_URL_PREFIX,
      urlPrefixByLanguage: validPrefixMap(byLanguageRaw),
      latestCount: clampPositiveInt(latestCount, BLOG_DEFAULT_LATEST_COUNT),
      postsPerPage: clampPositiveInt(postsPerPage, BLOG_DEFAULT_POSTS_PER_PAGE),
    };
  }

  private async readWithFallback<T>(
    code: string,
    salesChannelId: string,
    schema: z.ZodType<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await this.settings.get(code, salesChannelId, schema);
    } catch {
      return fallback;
    }
  }
}

function clampPositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  return n >= 1 ? n : fallback;
}

/** The well-formed entries of a stored per-language prefix map; anything else is dropped. */
function validPrefixMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [language, prefix] of Object.entries(raw)) {
    if (typeof prefix === 'string' && URL_PREFIX_REGEX.test(prefix)) out[language] = prefix;
  }
  return out;
}
