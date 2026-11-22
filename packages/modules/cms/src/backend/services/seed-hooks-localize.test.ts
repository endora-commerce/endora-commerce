import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEEDED_HOOKS, localizeSeededHook, seededHookKey } from './seed-hooks.js';

/**
 * Issue #1809 — the seeded hooks were named in English in a Polish admin.
 *
 * A seeded hook's name and description are platform prose until an operator
 * edits them, and operator content from then on
 * (`specs/conventions/module-i18n.md`, the four kinds). So the response
 * translates a seeded value the operator left alone, in the language the
 * request resolved, and passes an edited one through untouched.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

const fromBundle =
  (language: 'en' | 'pl') =>
  async (key: string): Promise<string> =>
    bundle(language)[key] ?? `cms.${key}`;

const searchBottom = {
  code: 'search.bottom',
  name: 'Search Page Bottom',
  description: null,
  isSystem: true,
};

describe('localizeSeededHook', () => {
  it('names an unedited seeded hook in the reader’s language', async () => {
    const out = await localizeSeededHook(searchBottom, 'pl', fromBundle('pl'));
    expect(out.name).toBe('Strona wyszukiwania — dół');
  });

  it('translates an unedited seeded description too', async () => {
    const headerTop = { code: 'header.top', name: 'Header Top', description: SEEDED_HOOKS[0]!.description!, isSystem: true };
    const out = await localizeSeededHook(headerTop, 'pl', fromBundle('pl'));
    expect(out.name).toBe('Nagłówek — góra');
    expect(out.description).toBe(bundle('pl')[seededHookKey('header.top', 'description')]);
  });

  it('leaves a name the operator changed as they wrote it', async () => {
    const edited = { ...searchBottom, name: 'Pod wynikami' };
    expect((await localizeSeededHook(edited, 'pl', fromBundle('pl'))).name).toBe('Pod wynikami');
  });

  it('leaves an operator-created hook alone, even one reusing a seeded name', async () => {
    const custom = { ...searchBottom, code: 'custom.bottom', isSystem: false };
    expect(await localizeSeededHook(custom, 'pl', fromBundle('pl'))).toEqual(custom);
  });

  it('answers English without asking the bundle, and the stored text when the bundle has no entry', async () => {
    const never = async (): Promise<string> => {
      throw new Error('not asked');
    };
    expect((await localizeSeededHook(searchBottom, 'en', never)).name).toBe('Search Page Bottom');
    const missing = async (key: string): Promise<string> => `cms.${key}`;
    expect((await localizeSeededHook(searchBottom, 'pl', missing)).name).toBe('Search Page Bottom');
  });

  it('answers the stored text when the translation fails', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('i18n is down');
    };
    expect((await localizeSeededHook(searchBottom, 'pl', failing)).name).toBe('Search Page Bottom');
  });
});

describe('the seeded hooks in the cms bundles', () => {
  it.each(SEEDED_HOOKS.map((hook) => [hook.code, hook] as const))('%s is named in both languages', (code, hook) => {
    expect(bundle('en')[seededHookKey(code, 'name')]).toBe(hook.name);
    expect(bundle('pl')[seededHookKey(code, 'name')]).toEqual(expect.any(String));
    expect(bundle('pl')[seededHookKey(code, 'name')]).not.toBe(hook.name);
    if (hook.description) {
      expect(bundle('en')[seededHookKey(code, 'description')]).toBe(hook.description);
      expect(bundle('pl')[seededHookKey(code, 'description')]).toEqual(expect.any(String));
    }
  });
});
