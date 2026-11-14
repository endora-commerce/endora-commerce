import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #624 (#86), the category family — a slug another category holds under
 * the same parent (on create and on update), a delete of a category that still
 * has subcategories, and a move beneath one of its own descendants were all
 * `409 VALIDATION_FAILED` with an English literal. `VALIDATION_FAILED` is the
 * one code whose message the error envelope never replaces, so an operator
 * working in Polish read English. Each now has its own code, a sentence in
 * English and Polish, and the values it names in `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

const ADMIN = { b2b_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/catalog/categories';

const SENTENCES = {
  slugTaken: {
    en: (slug: string) => `A category with the slug ${slug} already exists under this parent. Choose a different slug.`,
    pl: (slug: string) => `Kategoria o slugu ${slug} już istnieje w tej kategorii nadrzędnej. Wybierz inny slug.`,
  },
  hasChildren: {
    en: (count: number) =>
      `Subcategories of this category: ${count}. Move or delete them before you delete the category.`,
    pl: (count: number) =>
      `Podkategorie tej kategorii: ${count}. Przenieś je lub usuń, zanim usuniesz kategorię.`,
  },
  moveCycle: {
    en: 'A category cannot be moved beneath one of its own subcategories. Choose a different parent.',
    pl: 'Nie można przenieść kategorii do jednej z jej własnych podkategorii. Wybierz inną kategorię nadrzędną.',
  },
} as const;

describe('catalog category refusals carry their own code and sentence (issue #624)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  /** Only the categories this file creates are removed — never a table-wide wipe. */
  const created: string[] = [];
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore = (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      // One row at a time, newest first: a child is always created after its
      // parent, and `parent_category_id` is `on delete restrict`.
      for (const id of [...created].reverse()) {
        await h.em().getConnection().execute(`delete from "categories" where "id" = ?`, [id]);
      }
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url: `${BASE}${url}`, cookies: ADMIN, ...(payload ? { payload } : {}) });

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectSentence(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  async function createCategory(slug: string, parentCategoryId?: string): Promise<string> {
    const response = await call('POST', '', {
      name: { 'en-US': slug },
      slug,
      ...(parentCategoryId ? { parentCategoryId } : {}),
    });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    created.push(id);
    return id;
  }

  describe.each(LANGUAGES)('for an operator working in %s', (language) => {
    beforeEach(async () => {
      await setAdminLanguage(language);
    });

    it('CATEGORY_SLUG_TAKEN when a sibling holds the slug, on create and on update', async () => {
      const parent = await createCategory(`i624-parent-${unique()}`);
      const slug = `i624-${unique()}`;
      await createCategory(slug, parent);
      const sentence = { en: SENTENCES.slugTaken.en(slug), pl: SENTENCES.slugTaken.pl(slug) };

      const onCreate = refusal(
        await call('POST', '', { name: { 'en-US': slug }, slug, parentCategoryId: parent }),
        409,
        'CATEGORY_SLUG_TAKEN',
      );
      expect(onCreate.details).toEqual({ slug, parentCategoryId: parent });
      expectSentence(onCreate, language, sentence);

      const other = await createCategory(`i624-${unique()}`, parent);
      const onUpdate = refusal(await call('PATCH', `/${other}`, { slug }), 409, 'CATEGORY_SLUG_TAKEN');
      expect(onUpdate.details).toEqual({ slug, parentCategoryId: parent });
      expectSentence(onUpdate, language, sentence);
    });

    it('CATEGORY_HAS_CHILDREN when the category still has subcategories', async () => {
      const parent = await createCategory(`i624-parent-${unique()}`);
      await createCategory(`i624-${unique()}`, parent);
      await createCategory(`i624-${unique()}`, parent);
      const error = refusal(await call('DELETE', `/${parent}`), 409, 'CATEGORY_HAS_CHILDREN');
      expect(error.details).toEqual({ categoryId: parent, childCount: 2 });
      expectSentence(error, language, { en: SENTENCES.hasChildren.en(2), pl: SENTENCES.hasChildren.pl(2) });
    });

    it('CATEGORY_MOVE_CYCLE when a category is moved beneath its own descendant', async () => {
      const top = await createCategory(`i624-top-${unique()}`);
      const middle = await createCategory(`i624-${unique()}`, top);
      const bottom = await createCategory(`i624-${unique()}`, middle);
      const error = refusal(await call('PATCH', `/${top}`, { parentCategoryId: bottom }), 409, 'CATEGORY_MOVE_CYCLE');
      expect(error.details).toEqual({ categoryId: top, parentCategoryId: bottom });
      expectSentence(error, language, SENTENCES.moveCycle);
    });
  });

  it('routes the three codes to catalog, the module that raises them', () => {
    for (const code of ['CATEGORY_SLUG_TAKEN', 'CATEGORY_HAS_CHILDREN', 'CATEGORY_MOVE_CYCLE']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('catalog');
    }
  });
});
