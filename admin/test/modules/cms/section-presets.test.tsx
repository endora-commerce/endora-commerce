import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentData, Data } from '@puckeditor/core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  SECTION_PRESETS,
  presetBlockNames,
  type SectionPresetId,
} from '@endora-commerce/cms-components/editor/section-presets';
import { SECTION_PRESET_COPY } from '@endora-commerce/cms-components/editor/section-preset-copy';
import {
  editorDescriptor,
  mountPageBuilderEditor,
  outlineButtons,
  selectOutlineItem,
  shippedBundles,
  stubEditorApi,
} from './page-builder-editor-harness';

/**
 * Feature 163, T092 — **section presets** (`specs/163-page-builder-marketing-pages/`
 * FR-042, research R-22): six ready-made sections in the editor's block drawer,
 * inserted into the page, not over it. Their names and descriptions in the
 * drawer are admin chrome, in the admin's language; the placeholder copy they
 * insert is content, in the content language being edited (issue #1684,
 * research R-22 as amended).
 *
 * Mounted in the real `PageBuilderEditor` (see the harness). The insertion
 * point is after the selected block's top-level section, or the end of the page
 * when nothing is selected: a preset is a section, so it goes to the top level.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

const PL = shippedBundles('pl') as Record<string, Record<string, string>>;
const EN = shippedBundles('en') as Record<string, Record<string, string>>;

function page(): Data {
  return {
    root: { props: {} },
    content: [
      { type: 'cms.Heading', props: { id: 'pb163-first', level: 'h2', text: 'First' } },
      { type: 'cms.Heading', props: { id: 'pb163-second', level: 'h2', text: 'Second' } },
    ],
  } as unknown as Data;
}

/**
 * Puck's stylesheet shows the left side bar from a `min-width` media query,
 * which jsdom does not evaluate, so the drawer is `display: none` here; the
 * role queries inside it therefore include hidden elements.
 */
function presetsPanel(bundles: Record<string, Record<string, string>> = PL): HTMLElement {
  // Puck mounts the side bar twice (desktop and mobile layouts); the first is the desktop one.
  const [panel] = screen.getAllByRole('group', { name: bundles['cms']?.['presets.panel.title'] ?? 'missing', hidden: true });
  if (!panel) throw new Error('no presets panel');
  return panel;
}

function plainText(value: unknown): string {
  return JSON.stringify(value).match(/"text":"([^"]*)"/g)?.map((m) => m.slice(8, -1)).join('') ?? '';
}

describe('section presets in the block drawer (T092)', () => {
  it('lists six presets, named in the admin\'s language', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page(), { language: 'pl' });
    const buttons = within(presetsPanel()).getAllByRole('button', { hidden: true });
    expect(buttons).toHaveLength(6);
    expect(buttons.map((button) => button.querySelector('[data-preset-label]')?.textContent)).toEqual([
      PL['cms']?.['presets.hero.label'],
      PL['cms']?.['presets.mediaText.label'],
      PL['cms']?.['presets.ctaCard.label'],
      PL['cms']?.['presets.downloads.label'],
      PL['cms']?.['presets.featureGrid.label'],
      PL['cms']?.['presets.statement.label'],
    ]);
  });

  it('inserts "Downloads" as a Section holding a Carousel of three download tiles after the selected section, keeping the page', async () => {
    stubEditorApi(vi.mocked(apiClient));
    const editor = await mountPageBuilderEditor(page(), { language: 'pl', activeLanguage: 'pl' });
    await selectOutlineItem(0);

    const downloads = within(presetsPanel()).getByRole('button', {
      name: new RegExp(PL['cms']?.['presets.downloads.label'] ?? 'missing'),
      hidden: true,
    });
    await act(async () => {
      fireEvent.click(downloads);
    });

    await waitFor(() => expect(editor.latest()?.content).toHaveLength(3));
    const content = editor.latest()?.content as ComponentData[];
    expect(content.map((item) => item.props.id)).toEqual(['pb163-first', expect.any(String), 'pb163-second']);

    // T113: a preset is a `cms.Section` holding its block (plan § Owner ruling 2026-10-23).
    expect(content[1]!.type).toBe('cms.Section');
    const carousel = (content[1]!.props['content'] as ComponentData[])[0]!;
    expect(carousel.type).toBe('cms.ContentSlider');
    const slides = carousel.props['slides'] as ComponentData[];
    expect(slides.map((slide) => slide.type)).toEqual(['cms.DownloadTile', 'cms.DownloadTile', 'cms.DownloadTile']);
    expect(new Set(slides.map((slide) => slide.props.id)).size).toBe(3);

    // The copy is the Polish content copy, not the English.
    expect(plainText((carousel.props['header'] as { heading: unknown }).heading)).toBe(
      SECTION_PRESET_COPY.pl.downloads.heading,
    );
    expect(slides[0]?.props['title']).toBe('Broszura');
    expect(slides[0]?.props['linkLabel']).toBe('Pobierz');

    // The insertion is announced.
    expect(within(presetsPanel()).getByRole('status', { hidden: true }).textContent).toContain(
      PL['cms']?.['presets.downloads.label'],
    );
  });

  it('inserts into a top-level Section group, after the selected grouped Section (T158)', async () => {
    stubEditorApi(vi.mocked(apiClient));
    const grouped: Data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.SectionGroup',
          props: {
            id: 'pb163-group',
            content: [
              { type: 'cms.Section', props: { id: 'pb163-s1', editorName: 'Grouped first', content: [] } },
              { type: 'cms.Section', props: { id: 'pb163-s2', editorName: 'Grouped second', content: [] } },
            ],
          },
        },
        { type: 'cms.Heading', props: { id: 'pb163-after', level: 'h2', text: 'After' } },
      ],
    } as unknown as Data;
    const editor = await mountPageBuilderEditor(grouped);
    const first = outlineButtons().findIndex((button) => button.textContent?.includes('Grouped first'));
    expect(first).toBeGreaterThanOrEqual(0);
    await selectOutlineItem(first);
    await act(async () => {
      fireEvent.click(within(presetsPanel(EN)).getByRole('button', { name: /Statement/, hidden: true }));
    });
    await waitFor(() => expect((editor.latest()?.content[0]?.props['content'] as ComponentData[] | undefined)?.length).toBe(3));
    const content = editor.latest()?.content as ComponentData[];
    expect(content.map((item) => item.props.id)).toEqual(['pb163-group', 'pb163-after']);
    const sections = content[0]!.props['content'] as ComponentData[];
    expect(sections.map((item) => item.type)).toEqual(['cms.Section', 'cms.Section', 'cms.Section']);
    expect(sections[0]!.props.id).toBe('pb163-s1');
    expect(sections[2]!.props.id).toBe('pb163-s2');
    expect((sections[1]!.props['content'] as ComponentData[])[0]?.type).toBe('cms.Statement');
  });

  it('inserts at the end of the page when nothing is selected', async () => {
    stubEditorApi(vi.mocked(apiClient));
    const editor = await mountPageBuilderEditor(page());
    await act(async () => {
      fireEvent.click(within(presetsPanel(EN)).getByRole('button', { name: /Statement/, hidden: true }));
    });
    await waitFor(() => expect(editor.latest()?.content).toHaveLength(3));
    const content = editor.latest()?.content as ComponentData[];
    expect(content[2]?.type).toBe('cms.Section');
    const statement = (content[2]?.props['content'] as ComponentData[])[0];
    expect(statement?.type).toBe('cms.Statement');
    expect(plainText(statement?.props['heading'])).toBe(SECTION_PRESET_COPY.en.statement.heading);
  });
});

describe('every preset tree names declared blocks (T092)', () => {
  const declared = new Set(
    (editorDescriptor()['components'] as Array<{ name: string }>).map((component) => component.name),
  );
  const copy = SECTION_PRESET_COPY.en;

  it.each(SECTION_PRESETS.map((preset) => [preset.id, preset] as const))('%s', (_id, preset) => {
    const tree = preset.build(copy);
    for (const name of presetBlockNames(tree)) expect(declared, name).toContain(name);
    // Its drawer chrome exists, in both languages.
    for (const bundle of [EN, PL]) {
      expect(bundle['cms']?.[preset.labelKey]).toBeDefined();
      expect(bundle['cms']?.[preset.descriptionKey]).toBeDefined();
    }
  });

  it('the source\'s tree literals are declared names, which is what `check:block-names` reads', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/cms-components/src/editor/section-presets.ts'),
      'utf8',
    );
    const literals = [...source.matchAll(/type: '([a-z_]+\.[A-Za-z]+)',\s*props:/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThanOrEqual(7);
    for (const name of literals) expect(declared, name).toContain(name);
  });

  it('each preset is one top-level cms.Section holding its block (T113)', () => {
    for (const preset of SECTION_PRESETS) {
      const tree = preset.build(copy);
      expect(tree.type, preset.id).toBe('cms.Section');
      const content = tree.props['content'] as ComponentData[];
      expect(content, preset.id).toHaveLength(1);
      expect(content[0]?.type, preset.id).not.toBe('cms.Section');
    }
  });

  // T117: the Section's settings are its own top-level props.
  it('sets the Section\'s settings as its top-level props, never as a `section` object', () => {
    for (const preset of SECTION_PRESETS) {
      expect(preset.build(copy).props, preset.id).not.toHaveProperty('section');
    }
    const hero = SECTION_PRESETS.find((preset) => preset.id === 'hero')!.build(copy);
    expect(hero.props).toMatchObject({ spaceTop: 'none', spaceBottom: 'none' });
  });

  it('builds a fresh tree with new ids each time', () => {
    const hero = SECTION_PRESETS.find((preset) => preset.id === 'hero')!;
    const [first, second] = [hero.build(copy), hero.build(copy)];
    expect(first.props.id).not.toBe(second.props.id);
    const inner = (tree: ComponentData) => (tree.props['content'] as ComponentData[])[0]!.props.id;
    expect(inner(first)).not.toBe(inner(second));
  });
});

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the presets list sat in a bordered,
 * tinted box above the drawer's blocks, so each preset button was a frame inside
 * a frame. The list is unboxed now and set off from the blocks below it by one
 * rule; the preset buttons stay bordered, like the drawer's own block items
 * (Similarity: same function, same look).
 */
describe('section presets — no frame around the list (DS-03)', () => {
  it('draws no box around the presets, only a rule below them', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page(), { language: 'pl' });
    const panel = presetsPanel();
    expect(panel.className).not.toMatch(/(^|\s)border(\s|$)|\brounded|\bbg-/);
    expect(panel.className).toMatch(/\bborder-b\b/);
    for (const button of within(panel).getAllByRole('button', { hidden: true })) {
      expect(button.className).toMatch(/(^|\s)border(\s|$)/);
    }
  });
});

/**
 * Issue #1684 — the placeholder copy a preset inserts is operator content
 * seeded into the document, printed on the storefront as stored, so it follows
 * the **content language being edited** (`PageBuilderContentLocaleProvider`),
 * not the admin language, and is English for a language with no row.
 */
describe('section presets insert their copy in the content language (#1684)', () => {
  /** Every string a language's copy row holds for one preset. */
  function copyStrings(language: 'en' | 'pl', id: SectionPresetId): string[] {
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(SECTION_PRESET_COPY[language][id]);
    return strings;
  }

  async function insertPreset(id: SectionPresetId, activeLanguage: string): Promise<string> {
    stubEditorApi(vi.mocked(apiClient));
    const editor = await mountPageBuilderEditor(page(), { language: 'en', activeLanguage });
    const label = EN['cms']?.[SECTION_PRESETS.find((preset) => preset.id === id)!.labelKey] ?? 'missing';
    const button = within(presetsPanel(EN))
      .getAllByRole('button', { hidden: true })
      .find((candidate) => candidate.querySelector('[data-preset-label]')?.textContent === label);
    if (!button) throw new Error(`no "${label}" preset`);
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(editor.latest()?.content).toHaveLength(3));
    return JSON.stringify(editor.latest()?.content[2]);
  }

  /** One string per preset, written out, so the table cannot answer for itself. */
  const POLISH_HEADLINE: Record<SectionPresetId, string> = {
    hero: 'Jasny nagłówek tej strony',
    mediaText: 'Opowiedz historię swojej oferty',
    ctaCard: 'Gotowy na kolejny krok?',
    downloads: 'Pliki do pobrania',
    featureGrid: 'Dlaczego warto z nami współpracować',
    statement: 'Krótka deklaracja tego, co Cię wyróżnia.',
  };

  it.each(SECTION_PRESETS.map((preset) => preset.id))(
    '%s: a Polish page in an English admin gets the Polish copy',
    async (id) => {
      const tree = await insertPreset(id, 'pl');
      expect(tree).toContain(POLISH_HEADLINE[id]);
      for (const text of copyStrings('pl', id)) expect(tree).toContain(JSON.stringify(text));
      const polish = new Set(copyStrings('pl', id));
      for (const text of copyStrings('en', id).filter((value) => !polish.has(value))) {
        expect(tree).not.toContain(JSON.stringify(text));
      }
    },
    30_000,
  );

  it.each(SECTION_PRESETS.map((preset) => preset.id))(
    '%s: a content language with no row gets the English copy',
    async (id) => {
      const tree = await insertPreset(id, 'de-DE');
      for (const text of copyStrings('en', id)) expect(tree).toContain(JSON.stringify(text));
      expect(tree).not.toContain(POLISH_HEADLINE[id]);
    },
    30_000,
  );
});

describe('the cms bundle keeps only the presets drawer chrome (#1684)', () => {
  it.each([['en', EN], ['pl', PL]] as const)('%s', (_language, bundle) => {
    const keys = Object.keys(bundle['cms'] ?? {}).filter((key) => key.startsWith('presets.'));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^presets\.(panel\.[a-z]+|[a-zA-Z]+\.(label|description))$/);
  });
});
