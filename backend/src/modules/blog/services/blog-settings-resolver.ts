import { z } from 'zod';
import { ERROR_CODES, BLOG_RESERVED_URL_PREFIXES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import {
  BLOG_DEFAULT_ENABLED,
  BLOG_DEFAULT_LATEST_COUNT,
  BLOG_DEFAULT_POSTS_PER_PAGE,
  BLOG_DEFAULT_URL_PREFIX,
  BLOG_SETTING_CODES,
} from '../manifest.js';

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
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

export interface ResolvedBlogSettings {
  enabled: boolean;
  urlPrefix: string;
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
 *     the value, so this branch is a defence-in-depth safeguard);
 *   - a pure `assertValidPrefix(value)` validator used as the setter
 *     callback for `blog.url_prefix` (per the spec FR-024 + the
 *     reference-scan contract § R-5).
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

  /**
   * Pure validator wired into the Settings module's setter callback for
   * the `blog.url_prefix` key. Refuses an invalid shape, a reserved
   * Next.js segment, or a value already owned by another storefront route
   * (the cross-module owner check is delegated; v1 only enforces the
   * shape + reserved-segments rule).
   */
  static assertValidPrefix(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !URL_PREFIX_REGEX.test(value)) {
      throw new HttpError(
        400,
        ERROR_CODES.BLOG_URL_PREFIX_INVALID,
        'Blog URL prefix must match ^[a-z0-9-]+$ (1–64 characters).',
      );
    }
    if (BLOG_RESERVED_URL_PREFIXES.has(value)) {
      throw new HttpError(
        409,
        ERROR_CODES.BLOG_URL_PREFIX_RESERVED,
        `URL prefix "${value}" is reserved by the storefront and cannot be assigned to the blog.`,
      );
    }
  }
}

function clampPositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  return n >= 1 ? n : fallback;
}
