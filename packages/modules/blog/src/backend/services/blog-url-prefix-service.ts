import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  BLOG_RESERVED_URL_PREFIXES,
  ERROR_CODES,
  channelUrlLanguageAliases,
  channelUrlLanguages,
  type BlogRouting,
  type BlogUrlPrefixRow,
  type ChannelUrlFacts,
  type SettingWriteValidationInput,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { BLOG_SETTING_CODES } from '../../manifest.js';
import type { BlogSettingsResolver, SettingsServicePort } from './blog-settings-resolver.js';
import { prefixFor } from './blog-storefront-resolver.js';

/** The URL-prefix grammar: one lower-case path segment, 1–64 characters. */
const PREFIX_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The storefront's own blog route. It always redirects to the current prefix, so it is never stored as former. */
const BUILT_IN_PREFIX = 'blog';

/**
 * The deployment's reserved storefront segments — `cms`' setting, read here so the
 * blog refuses the same addresses a page may not take (`specs/105-cms-root-page-urls/`).
 */
const STOREFRONT_RESERVED_SEGMENTS_SETTING = 'cms.reserved_slug_segments';

const AUDIT_OBJECT_TYPE = 'blog_url_prefix';

export type BlogUrlPrefixChannel = ChannelUrlFacts & { readonly id: string; readonly code: string };

export interface BlogUrlPrefixServiceDeps {
  emFactory: () => EntityManager;
  settingsResolver: BlogSettingsResolver;
  settings: SettingsServicePort;
  /** Every sales channel — the language prefixes a blog prefix may not equal. */
  listChannels: () => Promise<readonly BlogUrlPrefixChannel[]>;
  /** The first slug segments of the CMS pages a channel serves; `[]` when `cms` cannot answer. */
  cmsFirstSegments: (salesChannelId: string) => Promise<string[]>;
  commandBus: CommandBus;
  /** Whether `seo` is effectively present — redirects are its to serve (research R7). */
  seoPresent: () => boolean;
}

type PrefixRow = {
  id: string;
  sales_channel_id: string;
  language_code: string | null;
  prefix: string;
  state: 'current' | 'former';
  updated_at: Date | string;
};

/**
 * BlogUrlPrefixService — feature 171 (`specs/171-blog-i18n-authors/` research R3, R4).
 *
 * Three jobs, one table:
 *
 * - **The write rule** for `blog.url_prefix`, contributed to the settings module's
 *   validator registry: a prefix is refused when it is malformed, a reserved
 *   storefront segment, a language prefix of any channel, or the first slug segment
 *   of a CMS page in the channel.
 * - **The prefix history.** `settings.value_changed` carries no old value, so the
 *   blog records what each channel serves: the validator records the pre-write
 *   prefix, and every read and the change subscriber record the current one. A
 *   prefix that stops being current becomes `former` and redirects. Recording is
 *   idempotent and serialised per channel, so the order those three arrive in does
 *   not matter — the settings event is dispatched fire-and-forget.
 * - **The routing answer** the storefront middleware maps the public prefix with.
 */
export class BlogUrlPrefixService {
  constructor(private readonly deps: BlogUrlPrefixServiceDeps) {}

  /** The `blog.url_prefix` write rule, for `SettingWriteValidatorRegistryPort`. */
  validator(): SettingWriteValidator {
    return {
      contributorModuleId: 'blog',
      codes: [BLOG_SETTING_CODES.URL_PREFIX, BLOG_SETTING_CODES.URL_PREFIX_BY_LANGUAGE],
      validate: (input) => this.#validate(input),
    };
  }

  /**
   * The routing of one channel, or `null` when the blog is disabled there. Former
   * prefixes are listed only while `seo` is present.
   */
  async routingFor(channel: { id: string; languages: readonly string[] }): Promise<BlogRouting | null> {
    const settings = await this.deps.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    await this.#sync(channel.id, channel.languages);
    const formerPrefixes = this.deps.seoPresent()
      ? (
          (await this.deps.emFactory().execute(
            `select language_code, prefix from blog_url_prefixes
              where sales_channel_id = ? and state = 'former'
              order by prefix asc`,
            [channel.id],
          )) as Array<{ language_code: string | null; prefix: string }>
        ).map((r) => ({ languageCode: r.language_code, prefix: r.prefix }))
      : [];
    return {
      defaultPrefix: settings.urlPrefix,
      prefixes: Object.fromEntries(channel.languages.map((language) => [language, prefixFor(settings, language)])),
      formerPrefixes,
    };
  }

  /** The prefixes of one channel (recording its current one first), or of every channel. */
  async list(salesChannelId?: string): Promise<BlogUrlPrefixRow[]> {
    if (salesChannelId !== undefined) await this.syncChannels([salesChannelId]);
    const rows = (await this.deps.emFactory().execute(
      `select id::text as id, sales_channel_id::text as sales_channel_id, language_code, prefix, state, updated_at
         from blog_url_prefixes
        ${salesChannelId !== undefined ? 'where sales_channel_id = ?' : ''}
        order by sales_channel_id, state, prefix`,
      salesChannelId !== undefined ? [salesChannelId] : [],
    )) as PrefixRow[];
    return rows.map(toRow);
  }

  /** Record the prefix each of these channels serves now. */
  async syncChannels(salesChannelIds: readonly string[]): Promise<void> {
    if (salesChannelIds.length === 0) return;
    const channels = await this.deps.listChannels();
    for (const channelId of salesChannelIds) {
      await this.#sync(channelId, channels.find((c) => c.id === channelId)?.languages ?? []);
    }
  }

  /**
   * Record what one channel serves now: its default prefix, and a row per language
   * with a prefix of its own. A language whose own prefix was removed falls back to
   * the default; its former own prefix becomes former.
   */
  async #sync(salesChannelId: string, languages: readonly string[]): Promise<void> {
    const settings = await this.deps.settingsResolver.getResolved(salesChannelId);
    await this.#observe(salesChannelId, null, settings.urlPrefix);
    const own = settings.urlPrefixByLanguage;
    const stored = (await this.deps.emFactory().execute(
      `select language_code from blog_url_prefixes
        where sales_channel_id = ? and language_code is not null and state = 'current'`,
      [salesChannelId],
    )) as Array<{ language_code: string }>;
    const withOwn = new Set(Object.keys(own).map((l) => l.toLowerCase()));
    for (const language of languages) {
      const prefix = Object.entries(own).find(([l]) => l.toLowerCase() === language.toLowerCase())?.[1];
      if (prefix !== undefined) await this.#observe(salesChannelId, language, prefix);
    }
    for (const row of stored) {
      if (!withOwn.has(row.language_code.toLowerCase())) await this.#observe(salesChannelId, row.language_code, null);
    }
  }

  /** Record the prefix every channel serves now — after a platform-wide write. */
  async syncAllChannels(): Promise<void> {
    await this.syncChannels((await this.deps.listChannels()).map((c) => c.id));
  }

  /**
   * Forget a former prefix: it stops redirecting and stops being claimed. One audited
   * Command (`blog.url_prefix.forget`). A current prefix is not forgettable — 404.
   */
  async forget(id: string): Promise<void> {
    await this.deps.commandBus.run<void>({
      action: 'blog.url_prefix.forget',
      objectType: AUDIT_OBJECT_TYPE,
      objectId: id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const rows = (await tx.execute(
          `select id::text as id, sales_channel_id::text as sales_channel_id, language_code, prefix, state, updated_at
             from blog_url_prefixes where id = ? and state = 'former'`,
          [id],
        )) as PrefixRow[];
        const row = rows[0];
        if (!row) {
          throw new HttpError(404, ERROR_CODES.BLOG_URL_PREFIX_NOT_FOUND, 'No former blog URL prefix with that id.');
        }
        await tx.execute('delete from blog_url_prefixes where id = ?', [id]);
        return { result: undefined, before: toRow(row), after: null };
      },
    });
  }

  /**
   * The first segments the blog serves in a channel — its current prefix and every
   * former one, but not the storefront's own `blog` — for CMS's reserved-segment
   * registry (research R5).
   */
  async claimedSegments(salesChannelId: string): Promise<string[]> {
    const settings = await this.deps.settingsResolver.getResolved(salesChannelId);
    const rows = (await this.deps.emFactory().execute(
      'select prefix from blog_url_prefixes where sales_channel_id = ?',
      [salesChannelId],
    )) as Array<{ prefix: string }>;
    const segments = new Set([settings.urlPrefix, ...Object.values(settings.urlPrefixByLanguage), ...rows.map((r) => r.prefix)]);
    segments.delete(BUILT_IN_PREFIX);
    return [...segments];
  }

  async #validate(input: SettingWriteValidationInput): Promise<void> {
    // The channels whose prefix this write sets: the targeted ones, or — for a
    // platform-wide write — every channel without a value of its own.
    const affected =
      input.targetedChannelIds.length > 0
        ? input.projection.filter((p) => input.targetedChannelIds.includes(p.salesChannelId))
        : input.projection.filter((p) => p.value === input.proposedValue);
    const channels = await this.deps.listChannels();
    const reserved = new Set([...BLOG_RESERVED_URL_PREFIXES, ...(await this.#storefrontReservedSegments())]);
    const languagePrefixes = new Set(
      channels.flatMap((channel) => [
        ...channelUrlLanguages(channel).map((l) => l.prefix),
        ...channelUrlLanguageAliases(channel).map((a) => a.alias),
      ]),
    );

    // The prefixes a channel's value names: the one default, or one per language.
    const prefixesOf = (value: unknown, channelCode: string): string[] => {
      if (input.code === BLOG_SETTING_CODES.URL_PREFIX) return [value as string];
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalid('Blog URL prefixes per language must be a JSON object of language code → prefix.');
      }
      const channel = channels.find((c) => c.code === channelCode);
      return Object.entries(value).map(([language, prefix]) => {
        if (channel && !channel.languages.some((l) => l.toLowerCase() === language.toLowerCase())) {
          throw invalid(`"${language}" is not a language of sales channel "${channelCode}".`);
        }
        return prefix as string;
      });
    };

    // A rule about the value itself reads the proposed value: a platform-wide write
    // can reach no channel's projection at all.
    if (input.code === BLOG_SETTING_CODES.URL_PREFIX) {
      assertPrefixShapeAndScope(input.proposedValue, reserved, languagePrefixes);
    }
    for (const channel of affected) {
      for (const value of prefixesOf(channel.value, channel.salesChannelCode)) {
        assertPrefixShapeAndScope(value, reserved, languagePrefixes);
        if (value === BUILT_IN_PREFIX) continue;
        if ((await this.deps.cmsFirstSegments(channel.salesChannelId)).includes(value)) {
          throw new HttpError(
            409,
            ERROR_CODES.BLOG_URL_PREFIX_CONFLICT,
            `URL prefix "${value}" is the address of a CMS page in sales channel "${channel.salesChannelCode}".`,
            [{ path: 'value', issue: `cms page segment in ${channel.salesChannelCode}` }],
          );
        }
      }
    }

    // Before the write changes it: what each affected channel serves now, so the
    // change subscriber can retire it to `former`.
    await this.syncChannels(affected.map((p) => p.salesChannelId));
  }

  async #storefrontReservedSegments(): Promise<string[]> {
    try {
      return await this.deps.settings.get(STOREFRONT_RESERVED_SEGMENTS_SETTING, null, z.array(z.string()));
    } catch {
      return [];
    }
  }

  /**
   * Record that `(channel, language)` serves `prefix` now. The stored current prefix,
   * when it differs, becomes former (the built-in `blog` is dropped instead), and a
   * former row equal to the new prefix is current again. Serialised per channel.
   */
  async #observe(salesChannelId: string, languageCode: string | null, prefix: string | null): Promise<void> {
    await this.deps.emFactory().transactional(async (tx) => {
      await tx.execute(`select pg_advisory_xact_lock(hashtextextended('blog.url-prefix:' || ?, 0))`, [salesChannelId]);
      const current = (await tx.execute(
        `select id::text as id, prefix from blog_url_prefixes
          where sales_channel_id = ? and language_code is not distinct from ? and state = 'current'`,
        [salesChannelId, languageCode],
      )) as Array<{ id: string; prefix: string }>;
      if (current[0]?.prefix === prefix) return;
      if (prefix === null) {
        // The language has no prefix of its own any more: its last one is former.
        if (!current[0]) return;
        await tx.execute(`update blog_url_prefixes set state = 'former', updated_at = now() where id = ?`, [
          current[0].id,
        ]);
        return;
      }
      await tx.execute(
        `delete from blog_url_prefixes
          where sales_channel_id = ? and language_code is not distinct from ? and prefix = ? and state = 'former'`,
        [salesChannelId, languageCode, prefix],
      );
      if (current[0]) {
        if (current[0].prefix === BUILT_IN_PREFIX) {
          await tx.execute('delete from blog_url_prefixes where id = ?', [current[0].id]);
        } else {
          await tx.execute(`update blog_url_prefixes set state = 'former', updated_at = now() where id = ?`, [
            current[0].id,
          ]);
        }
      }
      await tx.execute(
        `insert into blog_url_prefixes (id, sales_channel_id, language_code, prefix, state)
         values (?, ?, ?, ?, 'current')`,
        [randomUUID(), salesChannelId, languageCode, prefix],
      );
    });
  }
}

function assertPrefixShapeAndScope(
  value: unknown,
  reserved: ReadonlySet<string>,
  languagePrefixes: ReadonlySet<string>,
): asserts value is string {
  if (typeof value !== 'string' || !PREFIX_SHAPE.test(value)) {
    throw new HttpError(
      400,
      ERROR_CODES.BLOG_URL_PREFIX_INVALID,
      'Blog URL prefix must match ^[a-z0-9-]+$ (1–64 characters).',
      [{ path: 'value', issue: 'invalid prefix' }],
    );
  }
  if (value === BUILT_IN_PREFIX) return;
  if (reserved.has(value)) {
    throw new HttpError(
      409,
      ERROR_CODES.BLOG_URL_PREFIX_RESERVED,
      `URL prefix "${value}" is reserved by the storefront and cannot be assigned to the blog.`,
      [{ path: 'value', issue: 'reserved segment' }],
    );
  }
  if (languagePrefixes.has(value)) {
    throw new HttpError(
      409,
      ERROR_CODES.BLOG_URL_PREFIX_CONFLICT,
      `URL prefix "${value}" is a language prefix of a sales channel.`,
      [{ path: 'value', issue: 'language prefix' }],
    );
  }
}

function toRow(row: PrefixRow): BlogUrlPrefixRow {
  return {
    id: row.id,
    salesChannelId: row.sales_channel_id,
    languageCode: row.language_code,
    prefix: row.prefix,
    state: row.state,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

function invalid(message: string): HttpError {
  return new HttpError(400, ERROR_CODES.BLOG_URL_PREFIX_INVALID, message, [{ path: 'value', issue: 'invalid prefix' }]);
}
