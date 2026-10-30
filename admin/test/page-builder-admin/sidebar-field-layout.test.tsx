import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ComponentType, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import type { Data } from '@puckeditor/core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  editorDescriptor,
  fieldsPanel,
  mountPageBuilderEditor,
  selectOutlineItem,
  stubEditorApi,
} from '../modules/cms/page-builder-editor-harness';

/**
 * Feature 163, T115–T116 — the component options panel (Puck's right side bar,
 * about 20rem) is readable and never scrolls sideways
 * (`specs/163-page-builder-marketing-pages/tasks.md` Phase R2).
 *
 * - **No horizontal overflow** for the colour field (its palette row is what
 *   scrolled) and the section background, in a 320px column. jsdom does not lay
 *   out, so `scrollWidth <= clientWidth` holds trivially here; it is asserted
 *   for the day the suite runs in a browser, and what keeps the controls inside
 *   the column in a real one is asserted alongside it: every control carries
 *   `w-full min-w-0 max-w-full`, the colour row lets its text box shrink and
 *   keeps the swatch and the button whole, and the section draws no
 *   three-column grid. The stale Puck class (`_Input-input_bsxfo_26`) that left
 *   every control at its intrinsic width is gone.
 * - `cms.Section`'s settings are fields of their own (T117): the responsive
 *   ones on the editor's Responsive tab, edited per breakpoint through its
 *   scope switcher, the others on the main tab.
 * - **Labels resolve in Polish** through the `core` bundle (FR-039).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { PageBuilderColorPaletteProvider, pageBuilderFieldTextBundleKey } = await import('@endora-commerce/page-builder-admin');
const {
  PAGE_BUILDER_FIELD_TEXT,
  createColorField,
  createSectionAnchorField,
  createSectionBackgroundField,
  createSectionRevealField,
  PB_FIELD_INPUT_CLASS,
} = await import(
  '@endora-commerce/page-builder-core'
);

afterEach(() => cleanup());

function coreBundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

/** Renders `field` the way Puck does, holding its value, in a 320px column (the side bar's 20rem). */
function renderField(
  field: { render: unknown },
  { language = 'pl', initial }: { language?: 'en' | 'pl'; initial?: unknown } = {},
): HTMLElement {
  const Render = field.render as ComponentType<Record<string, unknown>>;
  function Host(): ReactElement {
    const [value, setValue] = useState<unknown>(initial);
    return <Render field={field} name="f" id="f" value={value} onChange={setValue} />;
  }
  const bundle = { core: coreBundle(language) } as Bundle;
  render(
    <StrictMode>
      <TranslationProvider language={language} initialBundle={bundle}>
        <PageBuilderColorPaletteProvider initialEntries={[]}>
          <div data-testid="sidebar" style={{ width: '320px', overflowX: 'auto' }}>
            <Host />
          </div>
        </PageBuilderColorPaletteProvider>
      </TranslationProvider>
    </StrictMode>,
  );
  return screen.getByTestId('sidebar');
}

function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Every text box, number box and select stays inside its column. */
function expectControlsContained(sidebar: HTMLElement): void {
  const controls = sidebar.querySelectorAll('select, input:not([type="checkbox"]):not([type="color"]):not([type="radio"])');
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(classesOf(control), control.outerHTML.slice(0, 120)).toEqual(expect.arrayContaining(['w-full', 'min-w-0', 'max-w-full']));
  }
  expect(sidebar.innerHTML).not.toContain('_Input-input_bsxfo_26');
  expect(sidebar.scrollWidth).toBeLessThanOrEqual(sidebar.clientWidth);
}

describe('the colour field in the side bar (T115, T116)', () => {
  it('keeps its row inside a 320px column: the text box shrinks, the swatch and the palette button do not', () => {
    const sidebar = renderField(createColorField({ label: 'Kolor tła' }));
    const row = sidebar.querySelector('[data-pb-color-row]')!;
    expect(classesOf(row)).toEqual(expect.arrayContaining(['flex', 'min-w-0', 'max-w-full']));
    const text = within(sidebar).getByRole('textbox', { name: 'Kolor tła' });
    expect(classesOf(text)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
    const palette = within(sidebar).getByRole('button', { name: 'Paleta — Kolor tła' });
    expect(classesOf(palette)).toContain('shrink-0');
    expect(palette.textContent).toBe('Paleta');
    const swatch = sidebar.querySelector('input[type="color"]')!;
    expect(classesOf(swatch)).toContain('shrink-0');
    expect(swatch.getAttribute('aria-label')).toBe('Kolor tła — próbnik koloru');
    expectControlsContained(sidebar);
  });

  it('names each of its three controls instead of wrapping them in one <label>', () => {
    const sidebar = renderField(createColorField({ label: 'Background colour' }), { language: 'en' });
    expect(sidebar.querySelector('label')).toBeNull();
    expect(within(sidebar).getByRole('textbox', { name: 'Background colour' })).toBeTruthy();
    expect(within(sidebar).getByRole('button', { name: 'Palette — Background colour' })).toBeTruthy();
  });
});

/**
 * T117 (owner ruling 2026-10-23, second review): `cms.Section`'s settings are
 * its own top-level props. The responsive ones (space above, space below,
 * content position) sit on the editor's **Responsive** tab and edit the
 * breakpoint its scope switcher selects, as `cms.Row`'s do; the others stay on
 * the main tab, each a field of its own. No field carries a Mobile / Tablet /
 * Desktop switch of its own.
 */
describe('the Section\'s fields in the side bar (T115–T117)', () => {
  it('the background stays inside a 320px column with every control shown', () => {
    const sidebar = renderField(createSectionBackgroundField({ label: 'Tło' }), {
      initial: { kind: 'image', overlay: { kind: 'gradient', strength: 40 } },
    });
    expectControlsContained(sidebar);
    expect(sidebar.querySelector('.grid-cols-3')).toBeNull();
    // Labels and hints are never faded with opacity (it dropped them under 4.5:1).
    expect(sidebar.innerHTML).not.toMatch(/\bopacity-[0-9]/);
    // One composite field: no `<label>` around its many controls.
    expect(within(sidebar).getByRole('combobox', { name: 'Tło' })).toBeTruthy();
  });

  it('the reveal and the anchor read in Polish', () => {
    const reveal = renderField(createSectionRevealField({ label: 'Animacja wejścia' }));
    const effect = within(reveal).getByRole('combobox', { name: 'Animacja wejścia' }) as HTMLSelectElement;
    expect([...effect.options].map((option) => option.textContent)).not.toContain('None');
    cleanup();
    const anchor = renderField(createSectionAnchorField({ label: 'Kotwica' }), { initial: 'kontakt' });
    expect(within(anchor).getByRole('textbox', { name: 'Kotwica' })).toBeTruthy();
  });
});

describe('the field controls\' copy ships in both bundles (FR-039)', () => {
  it('every key of the package\'s English has an English and a Polish entry in `core`', () => {
    const en = coreBundle('en');
    const pl = coreBundle('pl');
    for (const [key, english] of Object.entries(PAGE_BUILDER_FIELD_TEXT)) {
      const bundleKey = pageBuilderFieldTextBundleKey(key as keyof typeof PAGE_BUILDER_FIELD_TEXT);
      expect(en[bundleKey], bundleKey).toBe(english);
      expect(pl[bundleKey], bundleKey).toBeTruthy();
    }
  });

  it('the input class is the one shared constant', () => {
    expect(PB_FIELD_INPUT_CLASS.split(' ')).toEqual(expect.arrayContaining(['w-full', 'min-w-0', 'max-w-full']));
  });
});

describe('in the real page editor (T116, T117)', () => {
  const page = {
    root: { props: {} },
    content: [{ type: 'cms.Section', props: { id: 'pb163-r2-section', content: [] } }],
  } as unknown as Data;

  it('declares the Section\'s responsive fields in its manifest', () => {
    const section = (editorDescriptor()['components'] as Array<{ name: string; responsiveFields?: string[] }>).find(
      (component) => component.name === 'cms.Section',
    );
    // T148 (deliberately changed, standing rule 13): the overlap is a fourth responsive field.
    // R19C (T260, T261; deliberately changed, standing rule 13): the width and the background outset join them.
    // R23 (T449): the background outset was removed again.
    expect([...(section?.responsiveFields ?? [])].sort()).toEqual([
      'contentPosition',
      'overlap',
      'spaceBottom',
      'spaceTop',
      'width',
    ]);
  });

  it('shows the Section\'s settings as fields of their own, translated, the responsive ones on the Responsive tab', async () => {
    stubEditorApi(vi.mocked(apiClient) as never);
    await mountPageBuilderEditor(page, { language: 'pl' });
    await selectOutlineItem(0);
    const panel = fieldsPanel()!;
    const wrapper = (name: string): HTMLElement => {
      const element = panel.querySelector<HTMLElement>(`[data-pb-field="${name}"]`);
      if (!element) throw new Error(`no field wrapper "${name}"`);
      return element;
    };
    // Each setting is a top-level field; the old one-object field is gone.
    expect(panel.querySelector('[data-pb-field="section"]')).toBeNull();
    // R19C (T260; deliberately changed, standing rule 13): the width is per breakpoint, on the Responsive tab.
    for (const name of ['scheme', 'background', 'anchor', 'reveal']) {
      expect(wrapper(name).hidden, name).toBe(false);
    }
    for (const name of ['width', 'spaceTop', 'spaceBottom', 'contentPosition']) {
      expect(wrapper(name).hidden, name).toBe(true);
    }
    // R23 (T449): no Section background outset.
    expect(panel.querySelector('[data-pb-field="outsetPx"]')).toBeNull();
    expect(within(panel).getByRole('combobox', { name: 'Schemat kolorów', hidden: true })).toBeTruthy();
    // No field draws a Mobile / Tablet / Desktop switch of its own.
    expect(panel.querySelectorAll('[data-pb-field] [role="tab"]')).toHaveLength(0);

    await act(async () => {
      fireEvent.click(within(panel).getByRole('tab', { name: 'Responsive', hidden: true }));
    });
    for (const name of ['width', 'spaceTop', 'spaceBottom', 'contentPosition']) {
      expect(wrapper(name).hidden, name).toBe(false);
    }
    expect(wrapper('scheme').hidden).toBe(true);
    // The editor's scope switcher, and the spacing labelled in Polish.
    expect(panel.querySelector('#pb-settings-scope')).not.toBeNull();
    // A spacing field is one control, its copy in Polish, with no breakpoint switch of its own.
    const above = within(wrapper('spaceTop')).getByRole('combobox', { name: 'Odstęp nad', hidden: true }) as HTMLSelectElement;
    expect([...above.options].map((option) => option.textContent)).toEqual(['Brak', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'Własny (px)']);
    expect(classesOf(above)).toEqual(expect.arrayContaining(['w-full', 'min-w-0', 'max-w-full']));
    expect(within(wrapper('spaceTop')).queryAllByRole('tab', { hidden: true })).toEqual([]);
    expect(within(wrapper('contentPosition')).getByText('Położenie treści')).toBeTruthy();
  });

  it('draws a rule between the top-level fields again', async () => {
    stubEditorApi(vi.mocked(apiClient) as never);
    await mountPageBuilderEditor(page, { language: 'pl' });
    await selectOutlineItem(0);
    const panel = fieldsPanel()!;
    // Puck's own rule (`._PuckFields-field + ._PuckFields-field`) cannot match
    // through the tab panel's wrappers; the panel's replacement is mounted.
    const wrappers = panel.querySelectorAll('[data-pb-fields] > [data-pb-field]');
    expect(wrappers.length).toBeGreaterThan(1);
    const rule = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
    expect(rule).toContain('[data-pb-field]:not(:empty):not([hidden]) ~ [data-pb-field]:not(:empty):not([hidden])');
    expect(rule).toContain('border-top');
  });
});
