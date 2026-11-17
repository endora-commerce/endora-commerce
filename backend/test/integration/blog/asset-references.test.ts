import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { registerBlogAssetReferences } from '../../../../packages/modules/blog/src/backend/services/blog-asset-references.js';
import { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';
import type { EntityManager } from '@mikro-orm/postgresql';

/** Counts the statements a descriptor issues on the EntityManagers it is handed. */
function countingEmFactory(emFactory: () => EntityManager): { emFactory: () => EntityManager; statements: () => number } {
  let statements = 0;
  return {
    emFactory: () =>
      new Proxy(emFactory(), {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const fn = value as (...args: unknown[]) => unknown;
          if (prop === 'execute') {
            return (...args: unknown[]) => {
              statements += 1;
              return fn.apply(target, args);
            };
          }
          return fn.bind(target);
        },
      }),
    statements: () => statements,
  };
}

const ASSET_A = '33333333-3333-3333-3333-333333333333';
const ASSET_B = '44444444-4444-4444-4444-444444444444';

/**
 * Integration test for the blog asset-reference descriptors (T017 / R13).
 * Seeds an asset row, then verifies that a Category referencing it via
 * `main_image_asset_id` and a Post referencing it inside its Page Builder
 * content tree both surface as inbound references.
 */
describe('blog asset references (T017 — registry descriptors)', () => {
  let db: TestDb;
  let registry: AssetReferenceRegistry;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    // Seed two assets at the suite level (outside per-test transactions).
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values
         (?, 'image', 'a.png', 'image/png', 1024, 'local:a-key', now(), now()),
         (?, 'image', 'b.png', 'image/png', 1024, 'local:b-key', now(), now())
       on conflict (id) do nothing`,
      [ASSET_A, ASSET_B],
    );
  });

  afterAll(async () => {
    const conn = db.orm.em.getConnection();
    await conn.execute(
      'truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade',
    );
    await conn.execute(`delete from assets where id in (?, ?)`, [ASSET_A, ASSET_B]);
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    // Defensive cleanup — the per-test transaction should provide
    // isolation but raw `getConnection().execute()` writes inside the
    // helper bypass it on some MikroORM/pg-pool combinations. The blog
    // tables are not used by any other suite, so a wholesale wipe here
    // is safe.
    const conn = db.em().getConnection();
    await conn.execute('truncate blog_post_related_products, blog_post_related_posts, blog_post_tags, blog_post_categories, blog_post_languages, blog_post_sales_channels, blog_posts, blog_category_languages, blog_category_sales_channels, blog_categories, blog_tags cascade');
    registry = new AssetReferenceRegistry();
    registerBlogAssetReferences(registry, () => db.em());
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('returns no references for an unused asset', async () => {
    const refs = await registry.findReferences(ASSET_A);
    expect(refs.filter((r) => r.kind.startsWith('blog_'))).toEqual([]);
  });

  it('surfaces a Category whose main_image_asset_id matches', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_categories (id, slug, name, main_image_asset_id, version, created_at, updated_at)
       values (?, 'guides', '{"en-US":"Guides"}'::jsonb, ?, 1, now(), now())`,
      [categoryId, ASSET_A],
    );
    const refs = await registry.findReferences(ASSET_A);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_main_image');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(categoryId);
    expect(blogRefs[0]!.label).toContain('guides');
  });

  it('surfaces a Post whose main_image_asset_id matches (feature 163)', async () => {
    const conn = db.em().getConnection();
    const postId = randomUUID();
    await conn.execute(
      `insert into blog_posts (id, slug, name, main_image_asset_id, version, created_at, updated_at)
       values (?, 'launch-notes', '{"en-US":"Launch notes"}'::jsonb, ?, 1, now(), now())`,
      [postId, ASSET_A],
    );
    const refs = await registry.findReferences(ASSET_A);
    const postRefs = refs.filter((r) => r.kind === 'blog_post_main_image');
    expect(postRefs).toHaveLength(1);
    expect(postRefs[0]!.entityId).toBe(postId);
    expect(postRefs[0]!.label).toContain('launch-notes');
  });

  it('surfaces a Post whose content tree contains the asset id', async () => {
    const conn = db.em().getConnection();
    const postId = randomUUID();
    const content = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [
            { type: 'image', props: { assetId: ASSET_B } },
          ],
        },
      },
    };
    await conn.execute(
      `insert into blog_posts (id, slug, name, content, version, created_at, updated_at)
       values (?, 'welcome', '{"en-US":"Welcome"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [postId, JSON.stringify(content)],
    );
    const refs = await registry.findReferences(ASSET_B);
    const blogRefs = refs.filter((r) => r.kind === 'blog_post_content');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(postId);
    expect(blogRefs[0]!.label).toContain('welcome');
  });

  it('surfaces a Category description containing the asset id', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    const description = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [
            { type: 'image', props: { assetId: ASSET_A } },
          ],
        },
      },
    };
    await conn.execute(
      `insert into blog_categories (id, slug, name, description, version, created_at, updated_at)
       values (?, 'pictures', '{"en-US":"Pictures"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [categoryId, JSON.stringify(description)],
    );
    const refs = await registry.findReferences(ASSET_A);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_description');
    expect(blogRefs).toHaveLength(1);
    expect(blogRefs[0]!.entityId).toBe(categoryId);
  });

  it('ignores soft-deleted rows', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_categories (id, slug, name, main_image_asset_id, version, created_at, updated_at, deleted_at)
       values (?, 'tombstone', '{"en-US":"Tombstone"}'::jsonb, ?, 1, now(), now(), now())`,
      [categoryId, ASSET_A],
    );
    const refs = await registry.findReferences(ASSET_A);
    expect(refs.filter((r) => r.kind === 'blog_category_main_image')).toEqual([]);
  });

  // Issue #1359 — only a string under a key ending in `assetId` is a
  // reference: the rule every renderer reads embeds by (`walkAssetIds`). An id
  // under any other key is never rendered, so it protects nothing and makes
  // nothing visible.
  it('counts an id under a key ending in assetId, never one under another key (issue #1359)', async () => {
    const conn = db.em().getConnection();
    const underFoo = randomUUID();
    const underIcon = randomUUID();
    const underMainImage = randomUUID();
    const tree = JSON.stringify({
      schema_version: 1,
      languages: {
        'en-US': {
          root: { props: { foo: underFoo } },
          content: [
            { type: 'cms.Button', props: { label: underFoo, iconAssetId: underIcon } },
            { type: 'cms.Card', props: { items: [{ mainImageAssetId: underMainImage, caption: underFoo }] } },
          ],
        },
      },
    });
    const postId = randomUUID();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into blog_posts (id, slug, name, content, version, created_at, updated_at)
       values (?, 'i1359-post', '{"en-US":"Post"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [postId, tree],
    );
    await conn.execute(
      `insert into blog_categories (id, slug, name, description, version, created_at, updated_at)
       values (?, 'i1359-category', '{"en-US":"Category"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [categoryId, tree],
    );

    const out = await registry.findReferencesMany([underFoo, underIcon, underMainImage]);

    expect(out.get(underFoo)).toEqual([]);
    for (const id of [underIcon, underMainImage]) {
      expect(out.get(id)).toHaveLength(2);
      expect(out.get(id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'blog_post_content', entityId: postId, assetId: id }),
          expect.objectContaining({ kind: 'blog_category_description', entityId: categoryId, assetId: id }),
        ]),
      );
    }
  });

  // Feature 166, research R-6 — both descriptors answer a batch in one
  // statement each, every hit tagged with the asset it points at.
  it('attributes a two-asset batch to each asset, one statement per descriptor', async () => {
    const conn = db.em().getConnection();
    const categoryId = randomUUID();
    const postId = randomUUID();
    const describedId = randomUUID();
    const tree = (assetId: string) =>
      JSON.stringify({
        schema_version: 1,
        languages: { 'en-US': { type: 'root', children: [{ type: 'image', props: { assetId } }] } },
      });
    await conn.execute(
      `insert into blog_categories (id, slug, name, main_image_asset_id, version, created_at, updated_at)
       values (?, 'r6-main', '{"en-US":"Main"}'::jsonb, ?, 1, now(), now())`,
      [categoryId, ASSET_A],
    );
    await conn.execute(
      `insert into blog_posts (id, slug, name, content, version, created_at, updated_at)
       values (?, 'r6-post', '{"en-US":"Post"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [postId, tree(ASSET_B)],
    );
    await conn.execute(
      `insert into blog_categories (id, slug, name, description, version, created_at, updated_at)
       values (?, 'r6-described', '{"en-US":"Described"}'::jsonb, ?::jsonb, 1, now(), now())`,
      [describedId, tree(ASSET_A)],
    );
    const unused = randomUUID();
    const counted = countingEmFactory(() => db.em());
    const batched = new AssetReferenceRegistry();
    registerBlogAssetReferences(batched, counted.emFactory);

    const out = await batched.findReferencesMany([ASSET_A, ASSET_B, unused]);

    expect(counted.statements(), 'one statement per descriptor for the whole batch').toBe(2);
    expect(out.get(ASSET_A)).toHaveLength(2);
    expect(out.get(ASSET_A)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'blog_category_main_image', entityId: categoryId, assetId: ASSET_A }),
        expect.objectContaining({ kind: 'blog_category_description', entityId: describedId, assetId: ASSET_A }),
      ]),
    );
    expect(out.get(ASSET_B)).toEqual([
      expect.objectContaining({ kind: 'blog_post_content', entityId: postId, assetId: ASSET_B }),
    ]);
    expect(out.get(unused)).toEqual([]);
  });
});
