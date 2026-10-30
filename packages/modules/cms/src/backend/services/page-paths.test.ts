import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  addressesOf,
  anyNested,
  channelLanguages,
  channelPaths,
  duplicatePath,
  languageSlug,
  loadChannelPageNodes,
  pageStorefrontLinks,
  type ChannelPageNode,
} from './page-paths.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19D (T282): the per-channel
 * reading of the public-path rule the resolver and the write refusal share.
 */
const A = 'channel-a';
const B = 'channel-b';

function node(
  id: string,
  slug: string,
  options: {
    parent?: string;
    nested?: boolean;
    channel?: string;
    languages?: string[];
    slugs?: Record<string, string>;
  } = {},
): ChannelPageNode {
  return {
    id,
    slug,
    languages: options.languages ?? ['en-US'],
    translations: Object.fromEntries(Object.entries(options.slugs ?? {}).map(([language, own]) => [language, { slug: own }])),
    parentPageId: options.parent ?? null,
    parentPathInUrl: options.nested ?? false,
    salesChannelId: options.channel ?? A,
    status: 'published',
    active: true,
    updatedAt: '2026-10-27T00:00:00.000Z',
  };
}

describe('channelPaths', () => {
  it('reads one channel only — a parent bound elsewhere does not prefix (Principle XII)', () => {
    const nodes = [node('zone', 'zone', { channel: B }), node('leaf', 'leaf', { parent: 'zone', nested: true })];
    expect(channelPaths(nodes, A).get('leaf')).toBe('leaf');
    expect(channelPaths(nodes, A).has('zone')).toBe(false);
  });
});

describe('duplicatePath', () => {
  const tree = [node('zone', 'zone'), node('leaf', 'leaf', { parent: 'zone', nested: true })];

  it('finds a flat slug equal to a nested path, when one of the pair is written', () => {
    const nodes = [...tree, node('flat', 'zone/leaf')];
    expect(duplicatePath(nodes, new Set(['flat']))).toEqual({ salesChannelId: A, path: 'zone/leaf' });
    expect(duplicatePath(nodes, new Set(['leaf']))).toEqual({ salesChannelId: A, path: 'zone/leaf' });
  });

  it('ignores a duplicate the written pages are not part of', () => {
    const nodes = [...tree, node('flat', 'zone/leaf'), node('other', 'other')];
    expect(duplicatePath(nodes, new Set(['other']))).toBeNull();
  });

  it('compares within a channel, never across channels', () => {
    const nodes = [...tree, node('flat', 'zone/leaf', { channel: B })];
    expect(duplicatePath(nodes, new Set(['flat']))).toBeNull();
  });
});

describe('addressesOf and anyNested', () => {
  it('names the flat slug and the path of a nested page, in every channel', () => {
    const nodes = [
      node('zone', 'zone'),
      node('leaf', 'leaf', { parent: 'zone', nested: true }),
      node('leaf', 'leaf', { parent: 'zone', nested: true, channel: B }),
    ];
    expect([...addressesOf(nodes, new Set(['leaf']))].sort()).toEqual(['leaf', 'zone/leaf']);
    expect(anyNested(nodes, new Set(['leaf']))).toBe(true);
    expect(anyNested(nodes, new Set(['zone']))).toBe(false);
  });
});

/**
 * R24 (issue #521): a page's slug per language. A language's tree is the
 * channel's pages at their slug in that language — the override, else the
 * page's own — and an address is unique within one channel and one language.
 */
describe('per-language paths (R24)', () => {
  const PL = 'pl-PL';
  const EN = 'en-US';
  const both = [EN, PL];

  it('reads a language slug only from a language the page declares', () => {
    expect(languageSlug(node('p', 'about', { languages: both, slugs: { [PL]: 'o-nas' } }), PL)).toBe('o-nas');
    expect(languageSlug(node('p', 'about', { languages: both, slugs: { [PL]: 'o-nas' } }), EN)).toBe('about');
    expect(languageSlug(node('p', 'about', { languages: [EN], slugs: { [PL]: 'o-nas' } }), PL)).toBe('about');
  });

  it('lists the languages a channel serves pages in, once each', () => {
    const nodes = [node('a', 'a', { languages: both }), node('b', 'b', { languages: [PL] }), node('c', 'c', { channel: B, languages: ['de-DE'] })];
    expect(channelLanguages(nodes, A)).toEqual([EN, PL]);
  });

  it('builds a nested path from every level’s slug in the language', () => {
    const nodes = [
      node('zone', 'services', { languages: both, slugs: { [PL]: 'uslugi' } }),
      node('leaf', 'consulting', { parent: 'zone', nested: true, languages: both, slugs: { [PL]: 'doradztwo' } }),
    ];
    expect(channelPaths(nodes, A, PL).get('leaf')).toBe('uslugi/doradztwo');
    expect(channelPaths(nodes, A, EN).get('leaf')).toBe('services/consulting');
    expect(channelPaths(nodes, A).get('leaf')).toBe('services/consulting');
  });

  it('refuses two pages at one address in one language', () => {
    const nodes = [
      node('a', 'contact', { languages: both, slugs: { [PL]: 'kontakt' } }),
      node('b', 'kontakt-old', { languages: both, slugs: { [PL]: 'kontakt' } }),
    ];
    expect(duplicatePath(nodes, new Set(['b']))).toEqual({ salesChannelId: A, path: 'kontakt', language: PL });
  });

  it('refuses a language slug equal to another page’s inherited slug in that language', () => {
    const nodes = [node('a', 'kontakt', { languages: both }), node('b', 'contact', { languages: both, slugs: { [PL]: 'kontakt' } })];
    expect(duplicatePath(nodes, new Set(['b']))).toMatchObject({ path: 'kontakt', language: PL });
  });

  it('allows one slug in two languages of two pages', () => {
    const nodes = [
      node('a', 'gift', { languages: both, slugs: { [PL]: 'prezent' } }),
      node('b', 'geschenk', { languages: both, slugs: { [EN]: 'present', [PL]: 'gift' } }),
    ];
    expect(duplicatePath(nodes, new Set(['a', 'b']))).toBeNull();
  });

  it('names every language address of a page, nested and flat', () => {
    const nodes = [
      node('zone', 'services', { languages: both, slugs: { [PL]: 'uslugi' } }),
      node('leaf', 'consulting', { parent: 'zone', nested: true, languages: both, slugs: { [PL]: 'doradztwo' } }),
    ];
    expect([...addressesOf(nodes, new Set(['leaf']))].sort()).toEqual([
      'consulting',
      'doradztwo',
      'services/consulting',
      'uslugi/doradztwo',
    ]);
    expect([...addressesOf(nodes, new Set(['zone']))].sort()).toEqual(['services', 'uslugi']);
  });

  it('counts a nested page as nested in every language', () => {
    const nodes = [
      node('zone', 'services', { languages: both, slugs: { [PL]: 'uslugi' } }),
      node('leaf', 'consulting', { parent: 'zone', nested: true, languages: both, slugs: { [PL]: 'doradztwo' } }),
    ];
    expect(anyNested(nodes, new Set(['leaf']))).toBe(true);
    expect(anyNested(nodes, new Set(['zone']))).toBe(false);
  });
});

describe('loadChannelPageNodes', () => {
  it('reads nothing for no channel, and maps the joined rows', async () => {
    const calls: unknown[][] = [];
    const em = {
      execute: async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return [
          {
            id: 'p1',
            parent_page_id: null,
            parent_path_in_url: null,
            sales_channel_id: A,
            slug: 'zone',
            languages: ['en-US', 'pl-PL'],
            translations: { 'pl-PL': { slug: 'strefa' } },
            status: 'published',
            active: true,
            updated_at: '2026-10-27T00:00:00.000Z',
          },
        ];
      },
    } as unknown as EntityManager;
    expect(await loadChannelPageNodes(em, [])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await loadChannelPageNodes(em, [A])).toEqual([
      expect.objectContaining({
        id: 'p1',
        parentPathInUrl: false,
        salesChannelId: A,
        slug: 'zone',
        languages: ['en-US', 'pl-PL'],
        translations: { 'pl-PL': { slug: 'strefa' } },
      }),
    ]);
    expect(calls).toEqual([[A]]);
  });
});

/**
 * `specs/168-megamenu-navigation-bar/` plan R-8 — a menu's link to a page, in
 * the served language: the page's localised name and its address in that
 * language's tree of the channel.
 */
describe('pageStorefrontLinks', () => {
  const named = (id: string, name: string, translations: Record<string, { name?: string; slug?: string }> = {}) => ({
    id,
    name,
    slug: id,
    description: null,
    languages: ['pl-PL', 'en-US'],
    translations,
  });

  it('answers the localised name and the path in the language of each page of the channel', () => {
    const nodes = [
      node('services', 'uslugi', { languages: ['pl-PL', 'en-US'], slugs: { 'en-US': 'services' } }),
      node('audit', 'audyt', { parent: 'services', nested: true, languages: ['pl-PL', 'en-US'] }),
    ];
    const pages = [named('services', 'Usługi', { 'en-US': { name: 'Services', slug: 'services' } }), named('audit', 'Audyt')];
    expect(
      pageStorefrontLinks(nodes, pages, ['services', 'audit'], { salesChannelId: A, language: 'en-US' }),
    ).toEqual([
      // The logical path: the storefront puts the language prefix on it, as on
      // every other menu link (feature 167).
      { id: 'services', name: 'Services', url: '/services' },
      { id: 'audit', name: 'Audyt', url: '/services/audyt' },
    ]);
    expect(
      pageStorefrontLinks(nodes, pages, ['audit'], { salesChannelId: A, language: 'pl-PL' }),
    ).toEqual([{ id: 'audit', name: 'Audyt', url: '/uslugi/audyt' }]);
  });

  it('leaves out a page that is not in the channel', () => {
    const nodes = [node('elsewhere', 'gdzie-indziej', { channel: B })];
    expect(
      pageStorefrontLinks(nodes, [named('elsewhere', 'Gdzie indziej')], ['elsewhere'], { salesChannelId: A, language: 'pl-PL' }),
    ).toEqual([]);
  });
});
