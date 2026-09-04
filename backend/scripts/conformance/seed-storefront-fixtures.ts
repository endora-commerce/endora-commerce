/**
 * The subjects `conformance:storefront` measures its dynamic route types
 * against (`specs/098-storefront-ssr-seo-a11y-suite/` Phase 4, T401/T402;
 * `contracts/accessibility-floor.md` §4.3 and §4.5's fifth refusal).
 *
 * Five of the storefront's nine indexable route types take a slug. This script
 * runs after `seed:dev`, against the same throwaway database, and answers one
 * question per kind: **what is there for this route type to be about?** It
 * discovers what the catalogue seed already produced and creates what nothing
 * else does — a published blog post and a published page-builder CMS page —
 * then writes the answers to a manifest the job reads.
 *
 * ## Why the manifest is keyed by content kind and not by route
 *
 * *"A product page takes a product slug"* is a fact about the storefront's
 * route tree and is declared there (`storefront/test/conformance/plan.ts`'s
 * `SUBJECT_KIND_BY_ROUTE`). *"Here is a product"* is a fact about the seeded
 * platform and is this file's. Each half is declared where it is owned and
 * neither holds a copy of the other, so a new route type is one line in the
 * storefront and a new kind of content is one function here.
 *
 * ## Why it writes SQL
 *
 * It is a seed, in `backend/scripts/`, outside every module boundary — the same
 * position `src/seeds/dev-catalog-seed.ts` holds and for the same reason: a
 * fixture composed of a dozen modules' rows is a composition root's job. Plain
 * SQL rather than the entity classes because nothing here needs the unit of
 * work, and because a script that imports eleven module packages to insert
 * three rows is a script that breaks whenever any of them moves.
 *
 * **It is not a domain write in Constitution XIII's sense** and carries no
 * Command: there is no operator, no tenant and no audit reader. The database it
 * refuses to run against is the enforcement — `mustBeNonProduction()` on the
 * first line, exactly as the development seed does it.
 *
 * ## What it refuses
 *
 * A kind it can neither find nor create is **left out of the manifest**, and
 * the job refuses over the absence (`plan.ts`'s `no-subject`). This script does
 * not decide that: reporting "there is no product" is its whole job, and
 * deciding what that means about the run is the job's.
 *
 * Usage:
 *   pnpm --filter backend exec tsx scripts/conformance/seed-storefront-fixtures.ts \
 *     --out storefront/test/conformance/fixtures.json
 */
/* eslint-disable no-console -- a seed script: stdout is the interface. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { closeOrm, initOrm } from '../../src/db/index.js';
import { mustBeNonProduction } from '../../src/seeds/dev-seed-guard.js';

const PREFIX = '[conformance-fixtures]';

/** Kinds the storefront's dynamic route types are about. */
type SubjectKind = 'product' | 'category' | 'blogPost' | 'cmsPage' | 'contentPage';

interface Subject {
  kind: SubjectKind;
  segments: string[];
  name: string;
  price?: { amount: number; currency: string } | null;
}

interface FixtureManifest {
  channel: { code: string; currency: string; language: string };
  subjects: Partial<Record<SubjectKind, Subject>>;
}

/** The slugs this script creates. Stable, so a re-run is idempotent. */
const BLOG_POST_SLUG = 'conformance-fixture-post';
const BLOG_CATEGORY_SLUG = 'conformance-fixture-category';
const CMS_PAGE_SLUG = 'conformance-fixture-page';

/** The one sentence both created fixtures use as their description. */
const SUMMARY = 'A fixture the storefront conformance job measures this route type against.';

interface ChannelRow {
  id: string;
  code: string;
  default_language: string;
  default_currency: string;
}

type Execute = (sql: string, params?: unknown[]) => Promise<unknown>;

async function rows<T>(execute: Execute, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await execute(sql, params)) as T[];
}

/**
 * The default sales channel. Exactly one exists platform-wide — the invariant
 * `install` establishes and a partial unique index holds — so a run that finds
 * none is a database the dev seed never touched, and saying so is more useful
 * than inventing one.
 */
async function defaultChannel(execute: Execute): Promise<ChannelRow> {
  const found = await rows<ChannelRow>(
    execute,
    `select id, code, default_language, default_currency
       from sales_channels
      where active = true
      order by system_default desc, code asc
      limit 1`,
  );
  const channel = found[0];
  if (channel === undefined) {
    throw new Error(
      'no active sales channel. This database has never been seeded, so there is nothing for ' +
        'any storefront route to be about — run `seed:dev` first.',
    );
  }
  return channel;
}

/**
 * The shop's own identity, so the home page has an `Organization` to emit.
 *
 * `seed:dev` leaves `shop.name` and its siblings at their empty default, and
 * `OrganizationJsonLd` deliberately renders **nothing** for a shop with no name
 * — an `Organization` with an empty `name` is worse than none. So a run against
 * the bare development seed reported the home page as declaring `Organization`
 * and emitting none, which is a finding about the fixture and not about the
 * page. A conformance fixture has to be a shop somebody could plausibly run.
 */
async function shopIdentity(execute: Execute): Promise<void> {
  const values: ReadonlyArray<readonly [string, string]> = [
    ['shop.name', 'Endora Conformance Shop'],
    ['shop.address', 'ul. Testowa 1, 00-001 Warszawa'],
    ['shop.contact_email', 'contact@conformance.invalid'],
    ['shop.support_email', 'support@conformance.invalid'],
    ['shop.phone', '+48 22 000 00 00'],
  ];
  for (const [code, value] of values) {
    await execute(`update settings set global_value = ? where code = ?`, [
      JSON.stringify(value),
      code,
    ]);
  }
}

/** A product the storefront will serve: active, public, in this channel. */
async function product(execute: Execute, channel: ChannelRow): Promise<Subject | null> {
  const found = await rows<{ slug: string; name: Record<string, string> }>(
    execute,
    `select p.slug, p.name
       from products p
       join sales_channel_products scp on scp.product_id = p.id
      where p.deleted_at is null
        and p.status = 'active'
        and p.visibility = 'public'
        and scp.sales_channel_id = ?
      order by p.slug asc
      limit 1`,
    [channel.id],
  );
  const row = found[0];
  if (row === undefined) return null;
  return {
    kind: 'product',
    segments: [row.slug],
    name: localized(row.name, channel.default_language),
  };
}

/**
 * A category that actually has a product on it.
 *
 * "Any category" would be the wrong subject: FR-032 asserts that a category
 * page carries at least one catalogue item, and an empty category answers that
 * with an empty page which is correct behaviour and an assertion about nothing.
 */
async function category(execute: Execute, channel: ChannelRow): Promise<Subject | null> {
  const found = await rows<{ slug: string; name: Record<string, string> }>(
    execute,
    `select c.slug, c.name, count(pc.product_id) as product_count
       from categories c
       join product_categories pc on pc.category_id = c.id
       join products p on p.id = pc.product_id
       join sales_channel_products scp on scp.product_id = p.id
      where c.deleted_at is null
        and c.is_active = true
        and p.deleted_at is null
        and p.status = 'active'
        and p.visibility = 'public'
        and scp.sales_channel_id = ?
      group by c.id, c.slug, c.name
      order by product_count desc, c.slug asc
      limit 1`,
    [channel.id],
  );
  const row = found[0];
  if (row === undefined) return null;
  return {
    kind: 'category',
    segments: [row.slug],
    name: localized(row.name, channel.default_language),
  };
}

/**
 * A published blog post, created here because nothing else creates one.
 *
 * The blog is enabled by default (`BLOG_DEFAULT_ENABLED`), so the only thing
 * missing from a seeded platform is a post. Idempotent: the slug is fixed and
 * every insert is `on conflict do nothing`, so a second run of this script over
 * the same database changes nothing and answers the same.
 */
async function blogPost(execute: Execute, channel: ChannelRow): Promise<Subject | null> {
  const name = 'Conformance fixture post';
  const language = channel.default_language;
  const existing = await rows<{ id: string }>(
    execute,
    `select id from blog_posts where slug = ? and deleted_at is null limit 1`,
    [BLOG_POST_SLUG],
  );
  let id = existing[0]?.id;
  if (id === undefined) {
    id = randomUUID();
    await execute(
      `insert into blog_posts
         (id, name, slug, active, status, published_at, description, meta_description,
          content, version, created_at, updated_at)
       values (?, ?, ?, true, 'published', now(), ?, ?, ?, 1, now(), now())`,
      [
        id,
        JSON.stringify({ [language]: name }),
        BLOG_POST_SLUG,
        SUMMARY,
        // The page emits `<meta name="description">` from this and from nothing
        // else, so a post without one is a page with no description — a finding
        // about a fixture nobody would publish rather than about the route.
        JSON.stringify({ [language]: SUMMARY }),
        JSON.stringify({ languages: { [language]: { content: [], root: {} } } }),
      ],
    );
  }

  // The scope rows are written on **every** run, not only when the post is
  // created, and that is the whole of this function's idempotence. `seed:dev`
  // truncates `sales_channels`, which cascades these join rows away while
  // leaving `blog_posts` — a different module's table — untouched. A script
  // that took "the post exists" for "the post is reachable" therefore wrote a
  // post nothing serves, and the run reported the blog route type as a page
  // with no `<h1>` rather than as a fixture that was never linked. Measured.
  let categoryId = (
    await rows<{ id: string }>(
      execute,
      `select id from blog_categories where slug = ? and deleted_at is null limit 1`,
      [BLOG_CATEGORY_SLUG],
    )
  )[0]?.id;
  if (categoryId === undefined) {
    categoryId = randomUUID();
    await execute(
      `insert into blog_categories (id, name, slug, enabled, position, created_at, updated_at)
       values (?, ?, ?, true, 0, now(), now())`,
      [categoryId, JSON.stringify({ [language]: 'Conformance' }), BLOG_CATEGORY_SLUG],
    );
  }
  await execute(
    `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
     values (?, ?, ?) on conflict do nothing`,
    [categoryId, channel.id, BLOG_CATEGORY_SLUG],
  );
  await execute(
    `insert into blog_post_languages (blog_post_id, language) values (?, ?)
     on conflict do nothing`,
    [id, language],
  );
  await execute(
    `insert into blog_post_sales_channels (blog_post_id, sales_channel_id, slug)
     values (?, ?, ?) on conflict do nothing`,
    [id, channel.id, BLOG_POST_SLUG],
  );
  await execute(
    `insert into blog_post_categories (blog_post_id, blog_category_id) values (?, ?)
     on conflict do nothing`,
    [id, categoryId],
  );
  return { kind: 'blogPost', segments: [BLOG_POST_SLUG], name };
}

/**
 * A published page-builder CMS page, likewise created here.
 *
 * `cms_pages` still carries its pre-014 `path`, `title` and `body` mirrors as
 * non-null columns, so they are written alongside the fields the storefront
 * actually reads (`slug`, `name`, `content`). That is the schema, not a
 * preference; a page written without them does not insert.
 */
async function cmsPage(execute: Execute, channel: ChannelRow): Promise<Subject | null> {
  const name = 'Conformance fixture page';
  const language = channel.default_language;
  const existing = await rows<{ id: string }>(
    execute,
    `select id from cms_pages where slug = ? limit 1`,
    [CMS_PAGE_SLUG],
  );
  let id = existing[0]?.id;
  if (id === undefined) {
    id = randomUUID();
    await execute(
      `insert into cms_pages
         (id, path, status, title, body, published_at, created_at, updated_at,
          name, slug, active, description, meta_description, content, languages, version)
       values (?, ?, 'published', ?, ?, now(), now(), now(), ?, ?, true, ?, ?, ?, ?, 1)`,
      [
        id,
        CMS_PAGE_SLUG,
        JSON.stringify({ [language]: name }),
        JSON.stringify({ [language]: SUMMARY }),
        name,
        CMS_PAGE_SLUG,
        SUMMARY,
        JSON.stringify({ [language]: SUMMARY }),
        // One `cms.Heading` block at level 1. An **empty** page-builder tree
        // renders a document with no `<h1>` at all, and the run then reports the
        // CMS route type as serving no heading — true of that page and of
        // nothing an editor would publish. The block is the palette's own
        // registered name, so this fixture is a page the editor could have made.
        JSON.stringify({
          languages: {
            [language]: {
              root: { props: { title: name } },
              content: [
                {
                  type: 'cms.Heading',
                  props: { id: 'conformance-heading', level: 'h1', text: name },
                },
              ],
            },
          },
        }),
        JSON.stringify([language]),
      ],
    );
  }
  // Written on every run, for `blogPost`'s reason.
  await execute(
    `insert into cms_page_sales_channels (page_id, sales_channel_id, slug) values (?, ?, ?)
     on conflict do nothing`,
    [id, channel.id, CMS_PAGE_SLUG],
  );
  return { kind: 'cmsPage', segments: [CMS_PAGE_SLUG], name };
}

function localized(value: Record<string, string> | string, language: string): string {
  if (typeof value === 'string') return value;
  return value[language] ?? Object.values(value)[0] ?? '';
}

function outputPath(): string {
  const flag = process.argv.indexOf('--out');
  const declared = flag === -1 ? undefined : process.argv[flag + 1];
  return resolve(
    process.cwd(),
    declared ?? '../storefront/test/conformance/fixtures.json',
  );
}

async function main(): Promise<void> {
  // command-coverage-ignore: a test fixture seed. `mustBeNonProduction()` on the
  // next line is the enforcement — this entry point refuses to run against a
  // production database at all, so the writes below have no operator, no tenant
  // and no audit reader.
  mustBeNonProduction();
  const orm = await initOrm();
  const em = orm.em.fork();
  const execute: Execute = (sql, params) => em.getConnection().execute(sql, params ?? []);

  try {
    const channel = await defaultChannel(execute);
    await shopIdentity(execute);
    const subjects: Partial<Record<SubjectKind, Subject>> = {};

    for (const [kind, produce] of [
      ['product', product],
      ['category', category],
      ['blogPost', blogPost],
      ['cmsPage', cmsPage],
    ] as const) {
      const subject = await produce(execute, channel);
      if (subject === null) {
        console.warn(`${PREFIX} no subject for \`${kind}\` — the job will refuse over its absence.`);
        continue;
      }
      subjects[kind] = subject;
    }

    const manifest: FixtureManifest = {
      channel: {
        code: channel.code,
        currency: channel.default_currency,
        language: channel.default_language,
      },
      subjects,
    };

    const path = outputPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(
      `${PREFIX} channel=${channel.code} language=${channel.default_language} ` +
        `currency=${channel.default_currency} subjects=${Object.keys(subjects).length} -> ${path}`,
    );
  } finally {
    await closeOrm();
  }
}

main().catch((error: unknown) => {
  console.error(`${PREFIX} ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
