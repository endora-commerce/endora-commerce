import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import {
  ERROR_CODES,
  blogPath,
  type BlogUrlKeyEntityKind,
  type BlogUrlKeysResponse,
  type ChannelUrlFacts,
  type PutBlogUrlKeysRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 171 (US4, `specs/171-blog-i18n-authors/` research R6, R7) — per-language URL
 * keys of posts and categories.
 *
 * The **effective key** of an entity in a language is its key row for the language,
 * else its base `slug`. A key resolves only in its own language. A replaced key, and
 * the base slug of a language that has its own key, redirect to the entity's current
 * URL there — while `seo` is present, as for products (163 Q-C). Posts and categories
 * share one URL space, so a key is unique per (channel, language) across both kinds,
 * counting current keys, base slugs where no key exists, and redirects.
 */

/** The SQL of one entity kind: its table, its channel bridge and its language table. */
const KIND = {
  post: {
    table: 'blog_posts',
    channels: 'blog_post_sales_channels',
    channelFk: 'blog_post_id',
    languages: 'blog_post_languages',
    languageFk: 'blog_post_id',
    auditObjectType: 'blog_post',
  },
  category: {
    table: 'blog_categories',
    channels: 'blog_category_sales_channels',
    channelFk: 'blog_category_id',
    languages: 'blog_category_languages',
    languageFk: 'blog_category_id',
    auditObjectType: 'blog_category',
  },
} as const;

/** `(?, ?, …)` for `n` values. */
function placeholders(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

/**
 * The entities of the given channels, both kinds, with their base slug, as a
 * `with members as (…)` clause, and the parameters it binds.
 */
function membersOf(channelIds: readonly string[]): { sql: string; params: string[] } {
  const ids = placeholders(channelIds.length);
  return {
    sql: `with members as (
      select 'post' as kind, p.id::text as id, p.slug
        from blog_posts p
        join blog_post_sales_channels s on s.blog_post_id = p.id and s.deleted_at is null
       where p.deleted_at is null and s.sales_channel_id in ${ids}
      union
      select 'category' as kind, c.id::text as id, c.slug
        from blog_categories c
        join blog_category_sales_channels s on s.blog_category_id = c.id and s.deleted_at is null
       where c.deleted_at is null and s.sales_channel_id in ${ids})`,
    params: [...channelIds, ...channelIds],
  };
}

export type BlogEntityRef = { kind: BlogUrlKeyEntityKind; id: string };

/** The effective key of each entity in a language: its key row, else its slug. */
export async function effectiveKeys(
  em: EntityManager,
  kind: BlogUrlKeyEntityKind,
  entities: ReadonlyArray<{ id: string; slug: string }>,
  languageCode: string,
): Promise<Map<string, string>> {
  const out = new Map(entities.map((e) => [e.id, e.slug]));
  if (entities.length === 0) return out;
  const rows = (await em.execute(
    `select entity_id::text as id, key from blog_url_keys
      where entity_kind = ? and entity_id in ${placeholders(entities.length)} and lower(language_code) = lower(?)`,
    [kind, ...entities.map((e) => e.id), languageCode],
  )) as Array<{ id: string; key: string }>;
  for (const row of rows) out.set(row.id, row.key);
  return out;
}

/**
 * Which entity a key names at (channel, language), per data-model §5:
 * 1. a key row of the language; 2. a base slug of an entity without a key in the
 * language; 3. a redirect of the language; 4. a base slug of an entity that has a key
 * in the language. 3 and 4 answer only when `redirects` is on. The entity must be
 * served there — `isServed` is the caller's (published, in the channel, in the
 * language).
 */
export async function resolveBlogKey(
  em: EntityManager,
  input: {
    channelId: string;
    languageCode: string;
    key: string;
    redirects: boolean;
    isServed: (ref: BlogEntityRef) => Promise<boolean>;
  },
): Promise<{ found: BlogEntityRef } | { redirect: BlogEntityRef } | null> {
  const { languageCode, key } = input;
  const { sql: members, params: channel } = membersOf([input.channelId]);

  const byKey = (await em.execute(
    `${members}
     select m.kind, m.id from members m
       join blog_url_keys k on k.entity_kind = m.kind and k.entity_id::text = m.id
      where lower(k.language_code) = lower(?) and k.key = ?`,
    [...channel, languageCode, key],
  )) as BlogEntityRef[];
  for (const ref of byKey) if (await input.isServed(ref)) return { found: ref };

  const bySlug = (await em.execute(
    `${members}
     select m.kind, m.id,
            exists (select 1 from blog_url_keys k
                     where k.entity_kind = m.kind and k.entity_id::text = m.id
                       and lower(k.language_code) = lower(?)) as keyed
       from members m where m.slug = ?`,
    [...channel, languageCode, key],
  )) as Array<BlogEntityRef & { keyed: boolean }>;
  for (const ref of bySlug) {
    if (!ref.keyed && (await input.isServed(ref))) return { found: { kind: ref.kind, id: ref.id } };
  }
  if (!input.redirects) return null;

  const byRedirect = (await em.execute(
    `${members}
     select m.kind, m.id from members m
       join blog_url_redirects r on r.entity_kind = m.kind and r.entity_id::text = m.id
      where lower(r.language_code) = lower(?) and r.key = ?`,
    [...channel, languageCode, key],
  )) as BlogEntityRef[];
  for (const ref of byRedirect) if (await input.isServed(ref)) return { redirect: ref };
  for (const ref of bySlug) {
    if (ref.keyed && (await input.isServed(ref))) return { redirect: { kind: ref.kind, id: ref.id } };
  }
  return null;
}

/** Drop every key and redirect of an entity — with the entity. */
export async function forgetEntityUrls(em: EntityManager, ref: BlogEntityRef): Promise<void> {
  await em.execute('delete from blog_url_keys where entity_kind = ? and entity_id = ?', [ref.kind, ref.id]);
  await em.execute('delete from blog_url_redirects where entity_kind = ? and entity_id = ?', [ref.kind, ref.id]);
}

/**
 * A base slug that changed keeps answering: in every language the entity has no key
 * in, the former slug becomes a redirect (OR-8).
 */
export async function redirectFormerSlug(em: EntityManager, ref: BlogEntityRef, formerSlug: string): Promise<void> {
  const k = KIND[ref.kind];
  await em.execute(
    `insert into blog_url_redirects (id, entity_kind, entity_id, language_code, key)
     select gen_random_uuid(), ?, ?, l.language, ?
       from ${k.languages} l
      where l.${k.languageFk} = ?
        and not exists (select 1 from blog_url_keys uk
                         where uk.entity_kind = ? and uk.entity_id = ? and lower(uk.language_code) = lower(l.language))
     on conflict do nothing`,
    [ref.kind, ref.id, formerSlug, ref.id, ref.kind, ref.id],
  );
}

type EntityRow = { id: string; slug: string; version: number };

export interface BlogUrlKeyServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  seoPresent: () => boolean;
  /** A channel's URL facts, for the effective paths the admin read shows. */
  channelById: (salesChannelId: string) => Promise<(ChannelUrlFacts & { id: string }) | null>;
  /** The blog prefix of a channel in a language. */
  prefixFor: (salesChannelId: string, languageCode: string) => Promise<string>;
  /** Drop every cached storefront answer after a write. */
  invalidate: () => Promise<void>;
}

/** The admin surface of the keys: read, write (one Command), forget a redirect (one Command). */
export class BlogUrlKeyService {
  constructor(private readonly deps: BlogUrlKeyServiceDeps) {}

  async read(kind: BlogUrlKeyEntityKind, id: string): Promise<BlogUrlKeysResponse> {
    const em = this.deps.emFactory();
    const entity = await this.#entity(em, kind, id);
    const keys = await this.#keys(em, kind, id);
    const channelIds = await this.#channelIds(em, kind, id);
    const languages = await this.#languages(em, kind, id);
    const effective: BlogUrlKeysResponse['effective'] = [];
    for (const channelId of channelIds) {
      const channel = await this.deps.channelById(channelId);
      if (!channel) continue;
      for (const languageCode of languages) {
        if (!channel.languages.some((l) => l.toLowerCase() === languageCode.toLowerCase())) continue;
        const key = keys.find((k) => k.languageCode.toLowerCase() === languageCode.toLowerCase())?.key ?? entity.slug;
        const prefix = await this.deps.prefixFor(channelId, languageCode);
        effective.push({
          salesChannelId: channelId,
          languageCode,
          key,
          path: blogPath({ view: 'entry', key, languageCode, channel, prefix }),
        });
      }
    }
    const out: BlogUrlKeysResponse = { slug: entity.slug, keys, effective, version: entity.version };
    if (this.deps.seoPresent()) {
      out.redirects = (await em.execute(
        `select id::text as id, language_code as "languageCode", key from blog_url_redirects
          where entity_kind = ? and entity_id = ? order by language_code, key`,
        [kind, id],
      )) as Array<{ id: string; languageCode: string; key: string }>;
    }
    return out;
  }

  async update(kind: BlogUrlKeyEntityKind, id: string, input: PutBlogUrlKeysRequest): Promise<BlogUrlKeysResponse> {
    await this.deps.commandBus.run<void>({
      action: 'blog.url_keys.update',
      objectType: KIND[kind].auditObjectType,
      objectId: id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const entity = await this.#entity(tx, kind, id, true);
        if (entity.version !== input.version) {
          throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, `The blog ${kind} was updated concurrently.`);
        }
        const before = await this.#keys(tx, kind, id);
        const channelIds = await this.#channelIds(tx, kind, id);
        const confirmed = new Set((input.confirmTakeover ?? []).map((t) => `${t.languageCode.toLowerCase()}|${t.key}`));
        for (const change of input.keys) {
          await this.#apply(tx, { kind, id }, entity.slug, channelIds, change, confirmed);
        }
        await tx.execute(`update ${KIND[kind].table} set version = version + 1, updated_at = now() where id = ?`, [id]);
        return { result: undefined, before: { keys: before }, after: { keys: await this.#keys(tx, kind, id) } };
      },
    });
    await this.deps.invalidate();
    return this.read(kind, id);
  }

  async deleteRedirect(kind: BlogUrlKeyEntityKind, id: string, redirectId: string): Promise<void> {
    await this.deps.commandBus.run<void>({
      action: 'blog.url_redirect.delete',
      objectType: KIND[kind].auditObjectType,
      objectId: id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const rows = (await tx.execute(
          `select language_code, key from blog_url_redirects where id = ? and entity_kind = ? and entity_id = ?`,
          [redirectId, kind, id],
        )) as Array<{ language_code: string; key: string }>;
        if (!rows[0]) {
          throw new HttpError(404, ERROR_CODES.BLOG_URL_REDIRECT_NOT_FOUND, 'No such redirect of this blog entry.');
        }
        await tx.execute('delete from blog_url_redirects where id = ?', [redirectId]);
        return { result: undefined, before: { redirect: rows[0] }, after: null };
      },
    });
    await this.deps.invalidate();
  }

  async #apply(
    tx: EntityManager,
    self: BlogEntityRef,
    slug: string,
    channelIds: string[],
    change: { languageCode: string; key: string | null },
    confirmed: ReadonlySet<string>,
  ): Promise<void> {
    const language = change.languageCode;
    const current = (await tx.execute(
      `select id::text as id, key from blog_url_keys
        where entity_kind = ? and entity_id = ? and lower(language_code) = lower(?)`,
      [self.kind, self.id, language],
    )) as Array<{ id: string; key: string }>;
    const previous = current[0]?.key ?? slug;
    // The base slug as a key is no key: the language is then served at the slug.
    const next = change.key === null || change.key === slug ? null : change.key;

    if (next === null) {
      if (!current[0]) return;
      await tx.execute('delete from blog_url_keys where id = ?', [current[0].id]);
      await this.#redirect(tx, self, language, current[0].key);
      await tx.execute(
        `delete from blog_url_redirects where entity_kind = ? and entity_id = ? and lower(language_code) = lower(?) and key = ?`,
        [self.kind, self.id, language, slug],
      );
      return;
    }
    if (previous === next) return;

    await this.#assertFree(tx, self, channelIds, language, next, confirmed);
    await this.#redirect(tx, self, language, previous);
    // Claiming back a key of its own: it is current again, not a redirect as well.
    await tx.execute(
      `delete from blog_url_redirects where entity_kind = ? and entity_id = ? and lower(language_code) = lower(?) and key = ?`,
      [self.kind, self.id, language, next],
    );
    if (current[0]) {
      await tx.execute('update blog_url_keys set key = ?, updated_at = now() where id = ?', [next, current[0].id]);
    } else {
      await tx.execute(
        `insert into blog_url_keys (id, entity_kind, entity_id, language_code, key) values (?, ?, ?, ?, ?)`,
        [randomUUID(), self.kind, self.id, language, next],
      );
    }
  }

  async #assertFree(
    tx: EntityManager,
    self: BlogEntityRef,
    channelIds: string[],
    language: string,
    key: string,
    confirmed: ReadonlySet<string>,
  ): Promise<void> {
    for (const channelId of [...channelIds].sort()) {
      await tx.execute(`select pg_advisory_xact_lock(hashtextextended(?, 0))`, [
        `blog.url-key:${channelId}:${language.toLowerCase()}:${key}`,
      ]);
    }
    if (channelIds.length === 0) return;
    const { sql: members, params: scope } = membersOf(channelIds);
    const taken = (await tx.execute(
      `${members}
       select distinct m.kind, m.id from members m
        where not (m.kind = ? and m.id = ?)
          and (exists (select 1 from blog_url_keys k
                        where k.entity_kind = m.kind and k.entity_id::text = m.id
                          and lower(k.language_code) = lower(?) and k.key = ?)
               or (m.slug = ? and not exists (select 1 from blog_url_keys k
                        where k.entity_kind = m.kind and k.entity_id::text = m.id
                          and lower(k.language_code) = lower(?))))`,
      [...scope, self.kind, self.id, language, key, key, language],
    )) as BlogEntityRef[];
    if (taken.length > 0) {
      throw new HttpError(409, ERROR_CODES.BLOG_URL_KEY_TAKEN, `The URL key "${key}" is taken in ${language}.`, {
        conflicts: taken.map((t) => ({ languageCode: language, key, heldBy: t })),
      });
    }
    const redirects = (await tx.execute(
      `${members}
       select distinct r.id::text as "redirectId", m.kind, m.id from members m
         join blog_url_redirects r on r.entity_kind = m.kind and r.entity_id::text = m.id
        where not (m.kind = ? and m.id = ?)
          and lower(r.language_code) = lower(?) and r.key = ?`,
      [...scope, self.kind, self.id, language, key],
    )) as Array<BlogEntityRef & { redirectId: string }>;
    if (redirects.length === 0) return;
    if (!confirmed.has(`${language.toLowerCase()}|${key}`)) {
      throw new HttpError(
        409,
        ERROR_CODES.BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
        `The URL key "${key}" redirects to another blog entry in ${language}; confirm to take it over.`,
        { takeovers: redirects.map((r) => ({ languageCode: language, key, losing: { kind: r.kind, id: r.id } })) },
      );
    }
    await tx.execute(`delete from blog_url_redirects where id in ${placeholders(redirects.length)}`, redirects.map((r) => r.redirectId));
  }

  async #redirect(tx: EntityManager, self: BlogEntityRef, language: string, key: string): Promise<void> {
    await tx.execute(
      `insert into blog_url_redirects (id, entity_kind, entity_id, language_code, key)
       values (?, ?, ?, ?, ?) on conflict do nothing`,
      [randomUUID(), self.kind, self.id, language, key],
    );
  }

  async #entity(em: EntityManager, kind: BlogUrlKeyEntityKind, id: string, lock = false): Promise<EntityRow> {
    const rows = (await em.execute(
      `select id::text as id, slug, version from ${KIND[kind].table}
        where id = ? and deleted_at is null${lock ? ' for update' : ''}`,
      [id],
    )) as EntityRow[];
    if (!rows[0]) {
      throw new HttpError(
        404,
        kind === 'post' ? ERROR_CODES.BLOG_POST_NOT_FOUND : ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
        `Blog ${kind} not found.`,
      );
    }
    return rows[0];
  }

  async #keys(em: EntityManager, kind: BlogUrlKeyEntityKind, id: string): Promise<BlogUrlKeysResponse['keys']> {
    return (await em.execute(
      `select language_code as "languageCode", key from blog_url_keys
        where entity_kind = ? and entity_id = ? order by language_code`,
      [kind, id],
    )) as BlogUrlKeysResponse['keys'];
  }

  async #channelIds(em: EntityManager, kind: BlogUrlKeyEntityKind, id: string): Promise<string[]> {
    const k = KIND[kind];
    const rows = (await em.execute(
      `select sales_channel_id::text as id from ${k.channels} where ${k.channelFk} = ? and deleted_at is null`,
      [id],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  async #languages(em: EntityManager, kind: BlogUrlKeyEntityKind, id: string): Promise<string[]> {
    const k = KIND[kind];
    const rows = (await em.execute(`select language from ${k.languages} where ${k.languageFk} = ? order by language`, [
      id,
    ])) as Array<{ language: string }>;
    return rows.map((r) => r.language);
  }
}
