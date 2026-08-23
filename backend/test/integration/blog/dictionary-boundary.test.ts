import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../src/modules/dictionaries/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { Language } from '../../../src/modules/languages/entities/language.entity.js';
import { BlogCategoryService } from '../../../../packages/modules/blog/src/backend/services/blog-category-service.js';
import { BlogPostService } from '../../../../packages/modules/blog/src/backend/services/blog-post-service.js';

describe('Blog dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let categoryService: BlogCategoryService;
  let postService: BlogPostService;
  let channelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconcilerFor(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    validator = dictionaryValidatorFor(() => em);
    categoryService = new BlogCategoryService(() => em, undefined, validator);
    postService = new BlogPostService(() => em, undefined, validator);
    channelId = randomUUID();
    const channelCode = `bd-${channelId.slice(0, 8)}`;
    await em.getConnection().execute(
      `insert into sales_channels
         (id, code, name, default_language, default_currency, languages, currencies, active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', 'PLN', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, true, now(), now())`,
      [channelId, channelCode, JSON.stringify({ 'en-US': 'Blog Dictionary' })],
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('validates category languages and preserves unchanged inactive languages', async () => {
    await expect(
      categoryService.create(baseCategory('bad-category', ['xx-XX'])),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });

    const category = await categoryService.create(baseCategory('dict-category', ['en-US', 'pl-PL']));
    await em.nativeUpdate(Language, { code: 'pl-PL' }, { isActive: false });
    validator.invalidate();

    const updatedCategory = await categoryService.patch(category.id, {
      version: category.version,
      languages: ['en-US', 'pl-PL'],
    });
    expect(updatedCategory).toMatchObject({ languages: ['en-US', 'pl-PL'] });

    await expect(
      categoryService.patch(category.id, {
        version: updatedCategory.version,
        languages: ['en-US', 'xx-XX'],
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });

  it('validates post languages and preserves unchanged inactive languages', async () => {
    const category = await categoryService.create(baseCategory('post-category', ['en-US']));
    await expect(postService.create(basePost('bad-post', ['xx-XX'], category.id))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });

    const post = await postService.create(basePost('dict-post', ['en-US', 'pl-PL'], category.id));
    await em.nativeUpdate(Language, { code: 'pl-PL' }, { isActive: false });
    validator.invalidate();

    const updatedPost = await postService.patch(post.id, {
      version: post.version,
      languages: ['en-US', 'pl-PL'],
    });
    expect(updatedPost).toMatchObject({ languages: ['en-US', 'pl-PL'] });

    await expect(
      postService.patch(post.id, { version: updatedPost.version, languages: ['en-US', 'xx-XX'] }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });

  function baseCategory(slug: string, languages: string[]) {
    return {
      parentId: null,
      name: { 'en-US': slug },
      slug,
      salesChannelIds: [channelId],
      languages,
      enabled: true,
    };
  }

  function basePost(slug: string, languages: string[], categoryId: string) {
    return {
      name: { 'en-US': slug },
      slug,
      salesChannelIds: [channelId],
      languages,
      categoryIds: [categoryId],
      tagIds: [],
      active: true,
    };
  }
});
