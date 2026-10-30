// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T058, US5, FR-023, research R-13 —
 * accordion panels hold blocks.
 *
 * - Collapsed panels are in the server HTML, `hidden` until expanded (US5
 *   acceptance 2).
 * - `allowMultiple: false` closes the others when one opens.
 * - Each trigger names and controls its panel through `useId()` ids.
 * - A panel stored as HTML before the reshape still renders, as today.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.Accordion']?.defaultProps ?? {}) as Record<string, unknown>;

function rich(id: string, text: string) {
  return { type: 'cms.RichContent', props: { id, content: null, html: `<p>${text}</p>` } };
}

function accordionNode(id: string, props: Record<string, unknown> = {}) {
  return {
    type: 'cms.Accordion',
    props: {
      ...defaults,
      id,
      items: [
        { title: 'Delivery', panel: [rich(`${id}-r0`, 'Answer about delivery')] },
        { title: 'Returns', panel: [rich(`${id}-r1`, 'Answer about returns')] },
        { title: 'Invoices', panel: [rich(`${id}-r2`, 'Answer about invoices')] },
      ],
      ...props,
    },
  };
}

function page(...content: unknown[]) {
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content: content as Data['content'] }} />
    </CmsRenderProvider>
  );
}

function serverDom(...content: unknown[]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(page(...content));
  return host;
}

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

function clientDom(...content: unknown[]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(page(...content)));
  return host;
}

function triggers(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.cmsc-pb-accordion__trigger')];
}

function panels(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cmsc-pb-accordion__panel')];
}

const openState = (host: HTMLElement) => panels(host).map((panel) => !panel.hasAttribute('hidden'));

describe('cms.Accordion (T058)', () => {
  it('default props render items whose panels hold blocks, not HTML', () => {
    const items = defaults['items'] as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Array.isArray(item['panel'])).toBe(true);
      expect(item).not.toHaveProperty('content');
    }
    expect(panels(serverDom({ type: 'cms.Accordion', props: { ...defaults, id: 'acc-default' } }))).toHaveLength(items.length);
  });

  it('puts collapsed panels in the server HTML, hidden', () => {
    const host = serverDom(accordionNode('acc-ssr'));
    expect(openState(host)).toEqual([false, false, false]);
    expect(panels(host).map((panel) => panel.textContent)).toEqual([
      expect.stringContaining('Answer about delivery'),
      expect.stringContaining('Answer about returns'),
      expect.stringContaining('Answer about invoices'),
    ]);
    expect(triggers(host).map((trigger) => trigger.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false']);
  });

  it('names and controls each panel through distinct ids, also across two accordions', () => {
    const host = serverDom(accordionNode('acc-a'), accordionNode('acc-b'));
    const ids = [...triggers(host), ...panels(host)].map((element) => element.id);
    expect(ids.every((id) => id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(12);
    for (const trigger of triggers(host)) {
      const panel = host.querySelector(`[id="${trigger.getAttribute('aria-controls')}"]`);
      expect(panel?.classList.contains('cmsc-pb-accordion__panel')).toBe(true);
      expect(panel?.getAttribute('role')).toBe('region');
      expect(panel?.getAttribute('aria-labelledby')).toBe(trigger.id);
    }
  });

  it('closes the others when one opens, unless several may be open', () => {
    const single = clientDom(accordionNode('acc-single', { allowMultiple: false }));
    act(() => triggers(single)[0]!.click());
    expect(openState(single)).toEqual([true, false, false]);
    act(() => triggers(single)[1]!.click());
    expect(openState(single)).toEqual([false, true, false]);
    expect(triggers(single)[0]!.getAttribute('aria-expanded')).toBe('false');
    act(() => triggers(single)[1]!.click());
    expect(openState(single)).toEqual([false, false, false]);
    act(() => root!.unmount());
    root = null;

    const multiple = clientDom(accordionNode('acc-multiple', { allowMultiple: true }));
    act(() => triggers(multiple)[0]!.click());
    act(() => triggers(multiple)[2]!.click());
    expect(openState(multiple)).toEqual([true, false, true]);
  });

  it('opens the default item, stored as a list or as the number the field writes', () => {
    expect(openState(serverDom(accordionNode('acc-list', { defaultOpen: [1] })))).toEqual([false, true, false]);
    expect(openState(serverDom(accordionNode('acc-number', { defaultOpen: 2 })))).toEqual([false, false, true]);
    // One open at a time keeps only the first of several defaults.
    expect(openState(serverDom(accordionNode('acc-two', { defaultOpen: [0, 2], allowMultiple: false })))).toEqual([true, false, false]);
    expect(openState(serverDom(accordionNode('acc-two-multi', { defaultOpen: [0, 2], allowMultiple: true })))).toEqual([true, false, true]);
  });

  it('puts the icon at the start or the end', () => {
    const start = triggers(serverDom(accordionNode('acc-start', { iconPosition: 'start' })))[0]!;
    expect(start.firstElementChild?.classList.contains('cmsc-pb-accordion__icon')).toBe(true);
    const end = triggers(serverDom(accordionNode('acc-end', { iconPosition: 'end' })))[0]!;
    expect(end.lastElementChild?.classList.contains('cmsc-pb-accordion__icon')).toBe(true);
  });

  it('still renders a panel stored as HTML before the reshape, sanitised, as today', () => {
    const host = serverDom({
      type: 'cms.Accordion',
      props: {
        ...defaults,
        id: 'acc-stored',
        items: [{ title: 'Stored', content: '<ul><li>Kept</li></ul><img src=x onerror=alert(1)>' }],
      },
    });
    const [panel] = panels(host);
    expect(panel!.innerHTML).toContain('<ul><li>Kept</li></ul>');
    expect(panel!.innerHTML).not.toContain('onerror');
  });
});

/**
 * T134 (R5, owner gap list (a)12): an accordion's item titles can be headings
 * of a chosen level (the WAI-ARIA accordion pattern: the trigger button inside
 * the heading), with a size from the type scale. Unset, the trigger renders as
 * today — no heading, today's 15 px semibold title. `h1` is not offered: the
 * page's one H1 stays the page title's.
 */
describe('cms.Accordion title level and size (T134)', () => {
  type FieldMap = Record<string, { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;

  it('unset, each trigger is a bare button with today\'s title', () => {
    const host = serverDom(accordionNode('acc-plain'));
    const trigger = host.querySelector('.cmsc-pb-accordion__trigger')!;
    expect(trigger.parentElement?.classList.contains('cmsc-pb-accordion__item')).toBe(true);
    expect(host.querySelector('.cmsc-pb-accordion__heading')).toBeNull();
    expect(host.querySelector('.cmsc-pb-accordion__title')?.className).toBe('cmsc-pb-accordion__title');
  });

  it('a heading level wraps each trigger in that heading; the button keeps its name, state and panel', () => {
    const host = serverDom(accordionNode('acc-h2', { titleLevel: 'h2' }));
    const headings = Array.from(host.querySelectorAll('h2.cmsc-pb-accordion__heading'));
    expect(headings.map((heading) => heading.textContent)).toEqual(['Delivery+', 'Returns+', 'Invoices+']);
    const button = headings[0]!.querySelector('button.cmsc-pb-accordion__trigger')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector(`[id="${button.getAttribute('aria-controls')}"]`)?.textContent).toContain('Answer about delivery');
  });

  it('a size token sets the title\'s type scale class, a Custom size its px', () => {
    const token = serverDom(accordionNode('acc-size', { titleSize: 'h4' })).querySelector('.cmsc-pb-accordion__title')!;
    expect(token.classList).toContain('cmsc-t--h4');
    expect(token.classList).toContain('cmsc-pb-accordion__title--sized');
    const custom = serverDom(accordionNode('acc-px', { titleSize: 'custom', titleSizePx: 21 })).querySelector('.cmsc-pb-accordion__title') as HTMLElement;
    expect(custom.classList).toContain('cmsc-pb-accordion__title--sized');
    expect(custom.getAttribute('style')).toContain('21px');
  });

  it('offers the level (no h1), the size with Default, and the Custom px only when chosen', async () => {
    const accordion = config.components['cms.Accordion']!;
    const fields = accordion.fields as FieldMap;
    expect(fields['titleLevel']?.options?.map((option) => option.value)).toEqual(['none', 'h2', 'h3', 'h4', 'h5', 'h6']);
    expect(fields['titleSize']?.options?.[0]?.value).toBe('default');
    expect(fields['titleSize']?.options?.map((option) => option.value)).toContain('custom');
    expect(fields['titleSize']?.metadata).toBeDefined();
    const resolve = (props: Record<string, unknown>) =>
      accordion.resolveFields!(
        { props: { ...defaults, id: 'acc', ...props } } as never,
        { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      ) as FieldMap;
    expect(Object.keys(await resolve({}))).not.toContain('titleSizePx');
    expect(Object.keys(await resolve({ titleSize: { base: 'h5', desktop: 'custom' } }))).toContain('titleSizePx');
    expect(defaults['titleLevel']).toBeUndefined();
    expect(defaults['titleSize']).toBeUndefined();
  });
});

/**
 * T175 (R11): the accordion's look — the icon (today's plus/minus, or a
 * chevron that turns), the dividers between plain items (none, between, all),
 * plain or boxed items, and the title's padding (a spacing token or Custom px,
 * per breakpoint). Each is unset by default, and unset writes today's markup
 * byte for byte. Open and close animate in the stylesheet once the accordion
 * is interactive (never under reduced motion, instant where unsupported), and
 * every panel stays in the server HTML.
 */
describe('cms.Accordion look (T175)', () => {
  type FieldMap = Record<string, { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-accordion')!;

  it('unset, the accordion is today\'s markup: no look class, no padding variables, the plus/minus glyph', () => {
    const today = renderToString(page(accordionNode('acc-look')));
    for (const props of [{ icon: 'plus' }, { icon: 'nope' }, { dividers: 'nope' }, { itemStyle: 'nope' }]) {
      expect(renderToString(page(accordionNode('acc-look', props))), JSON.stringify(props)).toBe(today);
    }
    const root = rootOf(serverDom(accordionNode('acc-look')));
    expect(root.className).toBe('cmsc-pb-accordion cmsc-pb-accordion--default cmsc-pb-accordion--icon-end');
    expect(root.getAttribute('style')).toBeNull();
    expect(root.querySelector('.cmsc-pb-accordion__icon')?.textContent).toBe('+');
  });

  it('a chevron icon is a drawn glyph that turns with the state, hidden from assistive technology', () => {
    const host = serverDom(accordionNode('acc-chevron', { icon: 'chevron', defaultOpen: 0 }));
    expect(rootOf(host).classList).toContain('cmsc-pb-accordion--chevron');
    const icons = [...host.querySelectorAll('.cmsc-pb-accordion__icon')];
    expect(icons.map((icon) => icon.textContent)).toEqual(['', '', '']);
    expect(icons.every((icon) => icon.classList.contains('cmsc-pb-accordion__icon--chevron') && icon.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(builtCss()).toContain(".cmsc-pb-accordion__trigger[aria-expanded=true]>.cmsc-pb-accordion__icon--chevron");
  });

  it('dividers and the item style are classes; dividers apply to plain items only', () => {
    expect(rootOf(serverDom(accordionNode('acc-between', { dividers: 'between' }))).classList).toContain('cmsc-pb-accordion--dividers-between');
    expect(rootOf(serverDom(accordionNode('acc-all', { dividers: 'all' }))).classList).toContain('cmsc-pb-accordion--dividers-all');
    expect(rootOf(serverDom(accordionNode('acc-none', { dividers: 'none' }))).classList).toContain('cmsc-pb-accordion--dividers-none');
    const boxed = rootOf(serverDom(accordionNode('acc-boxed', { itemStyle: 'boxed', dividers: 'all' })));
    expect(boxed.classList).toContain('cmsc-pb-accordion--boxed');
    expect(boxed.className).not.toContain('dividers');
    // The bordered style of today is boxed: dividers do not apply to it unless its items are made plain.
    expect(rootOf(serverDom(accordionNode('acc-bordered', { variant: 'bordered', dividers: 'all' }))).className).not.toContain('dividers');
    const plain = rootOf(serverDom(accordionNode('acc-plain-bordered', { variant: 'bordered', itemStyle: 'plain', dividers: 'between' })));
    expect(plain.classList).toContain('cmsc-pb-accordion--plain');
    expect(plain.classList).toContain('cmsc-pb-accordion--dividers-between');
  });

  it('the title padding writes a spacing token or Custom px per breakpoint', () => {
    const token = rootOf(serverDom(accordionNode('acc-pad', { titlePadding: 'm' })));
    expect(token.classList).toContain('cmsc-pb-accordion--title-pad');
    expect(token.getAttribute('style')).toContain('--cmsc-acc-pad:var(--cmsb-space-m, 24px)');
    expect(token.getAttribute('style')).toContain('--cmsc-acc-pad-lg:var(--cmsb-space-m, 40px)');
    const custom = rootOf(serverDom(accordionNode('acc-pad-px', { titlePadding: { base: 'custom', desktop: 'xs' }, titlePaddingPx: 6 })));
    expect(custom.getAttribute('style')).toContain('--cmsc-acc-pad:6px');
    expect(custom.getAttribute('style')).toContain('--cmsc-acc-pad-lg:var(--cmsb-space-xs, 12px)');
    const css = builtCss();
    expect(css).toContain('.cmsc-pb-accordion--title-pad>.cmsc-pb-accordion__item>.cmsc-pb-accordion__trigger');
    expect(css).toContain('padding-top:var(--cmsc-acc-pad');
  });

  it('every panel stays in the server HTML, hidden while closed, whatever the look', () => {
    const host = serverDom(accordionNode('acc-all-looks', { icon: 'chevron', dividers: 'all', titlePadding: 's' }));
    expect(openState(host)).toEqual([false, false, false]);
    expect(host.textContent).toContain('Answer about delivery');
    expect(host.textContent).toContain('Answer about invoices');
  });

  it('animates open and close only once interactive, only without reduced motion and where the browser can', () => {
    // On the server no animation marker: a panel open by default does not animate in on page load.
    expect(rootOf(serverDom(accordionNode('acc-ssr'))).hasAttribute('data-animate')).toBe(false);
    const client = rootOf(clientDom(accordionNode('acc-client')));
    expect(client.getAttribute('data-animate')).toBe('');
    const css = builtCss();
    const motion = css.indexOf('@media(prefers-reduced-motion:no-preference)');
    expect(motion).toBeGreaterThan(-1);
    expect(css).toContain('@supports(interpolate-size:allow-keywords)');
    expect(css).toContain('.cmsc-pb-accordion[data-animate]>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel');
    expect(css).toContain('@starting-style');
  });

  it('offers the four options, none in the defaults, the padding on the Responsive tab with its Custom px only when chosen', async () => {
    const accordion = config.components['cms.Accordion']!;
    const fields = accordion.fields as FieldMap;
    expect(fields['icon']?.options?.map((option) => option.value)).toEqual(['plus', 'chevron']);
    expect(fields['dividers']?.options?.map((option) => option.value)).toEqual(['none', 'between', 'all']);
    // Feature 169 (T009): a third item style, `filled`, joins plain and boxed.
    expect(fields['itemStyle']?.options?.map((option) => option.value)).toEqual(['plain', 'boxed', 'filled']);
    expect(fields['titlePadding']?.options?.map((option) => option.value)).toContain('custom');
    expect(fields['titlePadding']?.metadata).toBeDefined();
    for (const key of ['icon', 'dividers', 'itemStyle', 'titlePadding', 'titlePaddingPx']) expect(defaults[key], key).toBeUndefined();
    const resolveWith = (props: Record<string, unknown>) =>
      accordion.resolveFields!(
        { props: { ...defaults, id: 'acc', ...props } } as never,
        { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      ) as FieldMap;
    expect(Object.keys(await resolveWith({}))).not.toContain('titlePaddingPx');
    expect(Object.keys(await resolveWith({ titlePadding: { base: 's', desktop: 'custom' } }))).toContain('titlePaddingPx');
    // Dividers are offered for plain items only.
    expect(Object.keys(await resolveWith({ itemStyle: 'boxed' }))).not.toContain('dividers');
    expect(Object.keys(await resolveWith({ variant: 'bordered' }))).not.toContain('dividers');
    expect(Object.keys(await resolveWith({ variant: 'bordered', itemStyle: 'plain' }))).toContain('dividers');
  });
});

describe('cms.Accordion title colour, divider position and icon size (T179)', () => {
  type FieldMap = Record<string, { type?: string; label?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-accordion')!;

  it('unset, an unknown value, a colour outside the grammar or the item position render today\'s accordion', () => {
    const today = renderToString(page(accordionNode('acc-r12')));
    for (const props of [
      { titleColor: '' },
      { titleColor: 'red;background:url(x)' },
      { titleColor: 'token:nope' },
      { dividerPosition: 'item' },
      { dividerPosition: 'nope' },
      { iconSize: 'nope' },
      { iconSize: 'custom' },
      { iconSize: 'custom', iconSizePx: -4 },
    ]) {
      expect(renderToString(page(accordionNode('acc-r12', props))), JSON.stringify(props)).toBe(today);
    }
  });

  it('a title colour (hex or brand token) is set on the root and read by every trigger', () => {
    const hex = rootOf(serverDom(accordionNode('acc-color', { titleColor: '#475569' })));
    expect(hex.classList).toContain('cmsc-pb-accordion--title-color');
    expect(hex.getAttribute('style')).toContain('--cmsc-acc-title:#475569');
    const token = rootOf(serverDom(accordionNode('acc-token', { titleColor: 'token:secondary' })));
    expect(token.getAttribute('style')).toMatch(/--cmsc-acc-title:var\(--cmsb-color-secondary, #[0-9a-f]{6}\)/);
    expect(builtCss()).toContain(
      '.cmsc-pb-accordion--title-color>.cmsc-pb-accordion__item>.cmsc-pb-accordion__trigger,.cmsc-pb-accordion--title-color>.cmsc-pb-accordion__item>.cmsc-pb-accordion__heading>.cmsc-pb-accordion__trigger{color:var(--cmsc-acc-title)}',
    );
  });

  it('the divider under the title moves the line of items that have one; boxed items and items without lines are left alone', () => {
    const cls = (props: Record<string, unknown>) => rootOf(serverDom(accordionNode('acc-div', { dividerPosition: 'title', ...props }))).className;
    expect(cls({})).toContain('cmsc-pb-accordion--divider-title');
    expect(cls({ itemStyle: 'plain' })).toContain('cmsc-pb-accordion--divider-title');
    expect(cls({ dividers: 'all' })).toContain('cmsc-pb-accordion--divider-title');
    expect(cls({ dividers: 'between' })).toContain('cmsc-pb-accordion--divider-title');
    expect(cls({ variant: 'flush', itemStyle: 'plain' })).toContain('cmsc-pb-accordion--divider-title');
    expect(cls({ dividers: 'none' })).not.toContain('divider-title');
    expect(cls({ variant: 'flush' })).not.toContain('divider-title');
    expect(cls({ itemStyle: 'boxed' })).not.toContain('divider-title');
    expect(cls({ variant: 'bordered' })).not.toContain('divider-title');
    const css = builtCss();
    expect(css).toContain('.cmsc-pb-accordion--divider-title>.cmsc-pb-accordion__item{border-bottom:none}');
    expect(css).toContain(
      '.cmsc-pb-accordion--divider-title>.cmsc-pb-accordion__item>.cmsc-pb-accordion__trigger,.cmsc-pb-accordion--divider-title>.cmsc-pb-accordion__item>.cmsc-pb-accordion__heading>.cmsc-pb-accordion__trigger{border-bottom:1pxsolidvar(--cmsb-n-200,#e2e8f0)}',
    );
    // The line moves after every rule that draws it under the item, so it wins at equal specificity.
    expect(css.indexOf('.cmsc-pb-accordion--divider-title>.cmsc-pb-accordion__item{border-bottom:none}')).toBeGreaterThan(
      css.indexOf('.cmsc-pb-accordion--dividers-all>.cmsc-pb-accordion__item{'),
    );
  });

  it('the icon size is a token (s 16, m 20, l 24 px) or a Custom px', () => {
    const size = (props: Record<string, unknown>) => rootOf(serverDom(accordionNode('acc-icon', props)));
    for (const [token, px] of [['s', 16], ['m', 20], ['l', 24]] as const) {
      const root = size({ iconSize: token });
      expect(root.classList).toContain('cmsc-pb-accordion--icon-size');
      expect(root.getAttribute('style')).toContain(`--cmsc-acc-icon:${px}px`);
    }
    expect(size({ iconSize: 'custom', iconSizePx: 22 }).getAttribute('style')).toContain('--cmsc-acc-icon:22px');
    expect(builtCss()).toContain(
      '.cmsc-pb-accordion--icon-size>.cmsc-pb-accordion__item>.cmsc-pb-accordion__trigger>.cmsc-pb-accordion__icon,.cmsc-pb-accordion--icon-size>.cmsc-pb-accordion__item>.cmsc-pb-accordion__heading>.cmsc-pb-accordion__trigger>.cmsc-pb-accordion__icon{font-size:var(--cmsc-acc-icon)',
    );
  });

  it('offers the three after their neighbours, the Custom px and the divider position only when they apply, none in the defaults', async () => {
    const accordion = config.components['cms.Accordion']!;
    const fields = accordion.fields as FieldMap;
    const keys = Object.keys(fields);
    // The responsive title size and padding sit on the Responsive tab, so the colour follows the title level.
    expect(keys.indexOf('titleColor')).toBe(keys.indexOf('titleLevel') + 1);
    expect(keys.indexOf('iconSize')).toBe(keys.indexOf('icon') + 1);
    expect(keys.indexOf('iconSizePx')).toBe(keys.indexOf('iconSize') + 1);
    expect(keys.indexOf('dividerPosition')).toBe(keys.indexOf('dividers') + 1);
    expect(fields['titleColor']?.label).toBe('Title color');
    expect(fields['dividerPosition']?.options?.map((option) => option.value)).toEqual(['item', 'title']);
    expect(fields['iconSize']?.options?.map((option) => option.value)).toEqual(['s', 'm', 'l', 'custom']);
    for (const key of ['titleColor', 'dividerPosition', 'iconSize', 'iconSizePx']) expect(defaults[key], key).toBeUndefined();
    const resolveWith = (props: Record<string, unknown>) =>
      accordion.resolveFields!(
        { props: { ...defaults, id: 'acc', ...props } } as never,
        { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      ) as FieldMap;
    expect(Object.keys(await resolveWith({}))).not.toContain('iconSizePx');
    expect(Object.keys(await resolveWith({ iconSize: 'custom' }))).toContain('iconSizePx');
    expect(Object.keys(await resolveWith({}))).toContain('dividerPosition');
    expect(Object.keys(await resolveWith({ itemStyle: 'boxed' }))).not.toContain('dividerPosition');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T182, T183 (R13) — the space
 * between a title's line and its open panel (`panelGap`), the space between
 * items (`itemGap`), each a spacing token or Custom px per breakpoint
 * (Responsive tab), and the titles' weight (`titleWeight`, Default or
 * 300–800, the shared text-weight helper). Unset, each writes nothing; a tier
 * left unset reads today's spacing (no space above a panel — 12 px under a
 * title line —, no space between plain items, 8 px between boxed ones).
 */
describe('cms.Accordion spacing and title weight (T182, T183)', () => {
  type FieldMap = Record<string, { type?: string; label?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-accordion')!;

  it('unset, Default or an unknown weight render today\'s accordion', () => {
    const today = renderToString(page(accordionNode('acc-r13')));
    for (const props of [{ titleWeight: 'default' }, { titleWeight: 'bold' }, { titleWeight: 250 }, { panelGap: undefined }, { itemGap: null }]) {
      expect(renderToString(page(accordionNode('acc-r13', props))), JSON.stringify(props)).toBe(today);
    }
  });

  it('a panel gap writes its value per breakpoint on the root: a token, Custom px, or today\'s where a tier is unset', () => {
    const token = rootOf(serverDom(accordionNode('acc-pg', { panelGap: 'l' })));
    expect(token.classList).toContain('cmsc-pb-accordion--panel-gap');
    expect(token.getAttribute('style')).toMatch(/--cmsc-acc-panel-gap:var\(--cmsb-space-l, \d+px\)/);
    expect(token.getAttribute('style')).toMatch(/--cmsc-acc-panel-gap-lg:var\(--cmsb-space-l, \d+px\)/);
    const custom = rootOf(serverDom(accordionNode('acc-pg', { panelGap: 'custom', panelGapPx: 24 })));
    expect(custom.getAttribute('style')).toContain('--cmsc-acc-panel-gap:24px;--cmsc-acc-panel-gap-md:24px;--cmsc-acc-panel-gap-lg:24px');
    // Only desktop set: below it, today's (no space; 12 px under a title line).
    const desktop = rootOf(serverDom(accordionNode('acc-pg', { panelGap: { desktop: 'custom' }, panelGapPx: { desktop: 24 } })));
    expect(desktop.getAttribute('style')).toContain('--cmsc-acc-panel-gap:0px;--cmsc-acc-panel-gap-md:0px;--cmsc-acc-panel-gap-lg:24px');
    const underTitle = rootOf(serverDom(accordionNode('acc-pg', { dividerPosition: 'title', panelGap: { desktop: 'custom' }, panelGapPx: { desktop: 24 } })));
    expect(underTitle.getAttribute('style')).toContain('--cmsc-acc-panel-gap:12px;--cmsc-acc-panel-gap-md:12px;--cmsc-acc-panel-gap-lg:24px');
  });

  it('an item gap writes its value per breakpoint on the root; boxed items keep their 8 px where a tier is unset', () => {
    const plain = rootOf(serverDom(accordionNode('acc-ig', { itemGap: 'custom', itemGapPx: 24 })));
    expect(plain.classList).toContain('cmsc-pb-accordion--item-gap');
    expect(plain.getAttribute('style')).toContain('--cmsc-acc-item-gap:24px;--cmsc-acc-item-gap-md:24px;--cmsc-acc-item-gap-lg:24px');
    const boxed = rootOf(serverDom(accordionNode('acc-ig', { itemStyle: 'boxed', itemGap: { desktop: 'custom' }, itemGapPx: { desktop: 16 } })));
    expect(boxed.getAttribute('style')).toContain('--cmsc-acc-item-gap:8px;--cmsc-acc-item-gap-md:8px;--cmsc-acc-item-gap-lg:16px');
  });

  it('the stylesheet reads the gaps from each breakpoint up, after the rules they replace', () => {
    const css = builtCss();
    const panel = '.cmsc-pb-accordion--panel-gap>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-top:var(--cmsc-acc-panel-gap)}';
    expect(css).toContain(panel);
    expect(css).toContain('.cmsc-pb-accordion--panel-gap>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-top:var(--cmsc-acc-panel-gap-md,var(--cmsc-acc-panel-gap))}');
    expect(css).toContain('.cmsc-pb-accordion--panel-gap>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-top:var(--cmsc-acc-panel-gap-lg,var(--cmsc-acc-panel-gap-md,var(--cmsc-acc-panel-gap)))}');
    // After the title line's 12 px, which it replaces at equal specificity.
    expect(css.indexOf(panel)).toBeGreaterThan(css.indexOf('.cmsc-pb-accordion--divider-title>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-top:12px}'));
    const item = '.cmsc-pb-accordion--item-gap>.cmsc-pb-accordion__item:not(:last-child){margin-bottom:var(--cmsc-acc-item-gap)}';
    expect(css).toContain(item);
    expect(css).toContain('.cmsc-pb-accordion--item-gap>.cmsc-pb-accordion__item:not(:last-child){margin-bottom:var(--cmsc-acc-item-gap-lg,var(--cmsc-acc-item-gap-md,var(--cmsc-acc-item-gap)))}');
    // The panel's top space opens and closes with it.
    expect(css).toMatch(/\.cmsc-pb-accordion--panel-gap\[data-animate\]>\.cmsc-pb-accordion__item>\.cmsc-pb-accordion__panel\[hidden\][^{]*\{padding-top:0\}/);
  });

  it('a title weight (300–800, numbers or their strings) is set on every title; the size keeps its own classes', () => {
    const host = serverDom(accordionNode('acc-w', { titleWeight: 700 }));
    const titles = [...host.querySelectorAll<HTMLElement>('.cmsc-pb-accordion__title')];
    expect(titles).toHaveLength(3);
    for (const title of titles) expect(title.style.fontWeight).toBe('700');
    const sized = serverDom(accordionNode('acc-w', { titleWeight: '300', titleSize: 'h4' })).querySelector<HTMLElement>('.cmsc-pb-accordion__title')!;
    expect(sized.style.fontWeight).toBe('300');
    expect(sized.className).toContain('cmsc-pb-accordion__title--sized');
  });

  it('offers the gaps on the Responsive tab, their Custom px only with Custom, the weight with the title size (on the Responsive tab since T185); none in the defaults', async () => {
    const accordion = config.components['cms.Accordion']! as unknown as { fields: FieldMap; responsiveFields?: string[]; resolveFields?: (...args: unknown[]) => unknown };
    const fields = accordion.fields;
    const keys = Object.keys(fields);
    // T185 moved the weight to the Responsive tab: it is listed with the responsive fields, after the title size.
    expect(keys.indexOf('titleWeight')).toBe(keys.indexOf('titleSizePx') + 1);
    expect(fields['titleWeight']?.label).toBe('Title weight');
    expect(fields['titleWeight']?.options?.map((option) => option.value)).toEqual(['default', 300, 400, 500, 600, 700, 800]);
    for (const key of ['panelGap', 'panelGapPx', 'itemGap', 'itemGapPx']) {
      expect(fields[key]?.metadata, key).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
      expect(accordion.responsiveFields ?? [], key).toContain(key);
    }
    expect(fields['panelGap']?.label).toBe('Space above the open panel');
    expect(fields['itemGap']?.label).toBe('Space between items');
    for (const key of ['panelGap', 'panelGapPx', 'itemGap', 'itemGapPx', 'titleWeight']) expect(defaults[key], key).toBeUndefined();
    const resolveWith = (props: Record<string, unknown>) =>
      accordion.resolveFields!(
        { props: { ...defaults, id: 'acc', ...props } } as never,
        { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      ) as FieldMap;
    expect(Object.keys(await resolveWith({}))).not.toContain('panelGapPx');
    expect(Object.keys(await resolveWith({}))).not.toContain('itemGapPx');
    expect(Object.keys(await resolveWith({ panelGap: { desktop: 'custom' } }))).toContain('panelGapPx');
    expect(Object.keys(await resolveWith({ itemGap: 'custom' }))).toContain('itemGapPx');
  });
});

/**
 * T185 (R14): the titles' weight per breakpoint (Responsive tab). A single
 * weight — plain, or one stored with only its base, or the same at every
 * tier — stays T183's inline `font-weight`, byte for byte; weights that differ
 * across breakpoints go on the root as `--cmsc-acc-title-weight(-md|-lg)`,
 * each tier without one of its own reading the tier below and, below the
 * first chosen tier, today's weight.
 *
 * T186: the open panel's bottom space (`panelPaddingBottom`, today's 12 px)
 * and the gap after an open item (`openItemGap`, used instead of the item
 * gap while the item above is open), each a token or Custom px per
 * breakpoint. Unset, nothing changes.
 */
describe('cms.Accordion title weight per breakpoint, panel bottom space and open-item gap (T185, T186)', () => {
  type FieldMap = Record<string, { type?: string; label?: string; options?: Array<{ value: unknown }>; metadata?: unknown }>;
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-accordion')!;
  const TITLE = ['>.cmsc-pb-accordion__item>.cmsc-pb-accordion__trigger>.cmsc-pb-accordion__title', '>.cmsc-pb-accordion__item>.cmsc-pb-accordion__heading>.cmsc-pb-accordion__trigger>.cmsc-pb-accordion__title'];

  it('a single weight renders exactly as T183\'s, whether plain, stored with only its base or the same at every tier', () => {
    const single = renderToString(page(accordionNode('acc-r14', { titleWeight: 700 })));
    for (const titleWeight of [{ base: 700 }, { base: 700, tablet: 700, desktop: 700 }, { base: '700', desktop: 700 }]) {
      expect(renderToString(page(accordionNode('acc-r14', { titleWeight }))), JSON.stringify(titleWeight)).toBe(single);
    }
    const today = renderToString(page(accordionNode('acc-r14')));
    for (const titleWeight of [{ base: 'default' }, { desktop: 'default' }, { base: 'bold', desktop: 250 }]) {
      expect(renderToString(page(accordionNode('acc-r14', { titleWeight }))), JSON.stringify(titleWeight)).toBe(today);
    }
  });

  it('weights that differ across breakpoints are written per tier on the root, not on the titles', () => {
    const host = serverDom(accordionNode('acc-rw', { titleWeight: { base: 600, desktop: 700 } }));
    const root = rootOf(host);
    expect(root.classList).toContain('cmsc-pb-accordion--title-weight');
    expect(root.getAttribute('style')).toContain('--cmsc-acc-title-weight:600;--cmsc-acc-title-weight-md:600;--cmsc-acc-title-weight-lg:700');
    for (const title of host.querySelectorAll<HTMLElement>('.cmsc-pb-accordion__title')) expect(title.style.fontWeight).toBe('');
  });

  it('below the first chosen tier, and on a tier left on Default, a title keeps today\'s weight (the trigger\'s 600, or its size token\'s)', () => {
    const plain = rootOf(serverDom(accordionNode('acc-rw', { titleWeight: { desktop: 700 } })));
    expect(plain.getAttribute('style')).toContain('--cmsc-acc-title-weight:600;--cmsc-acc-title-weight-md:600;--cmsc-acc-title-weight-lg:700');
    const sized = rootOf(serverDom(accordionNode('acc-rw', { titleSize: 'h4', titleWeight: { tablet: 500, desktop: 'default' } })));
    expect(sized.getAttribute('style')).toContain(
      '--cmsc-acc-title-weight:var(--cmsb-t-h4-w, 700);--cmsc-acc-title-weight-md:500;--cmsc-acc-title-weight-lg:var(--cmsb-t-h4-w, 700)',
    );
  });

  it('the panel\'s bottom space writes its value per breakpoint, today\'s 12 px where a tier is unset', () => {
    const custom = rootOf(serverDom(accordionNode('acc-pb', { panelPaddingBottom: 'custom', panelPaddingBottomPx: 4 })));
    expect(custom.classList).toContain('cmsc-pb-accordion--panel-bottom');
    expect(custom.getAttribute('style')).toContain('--cmsc-acc-panel-bottom:4px;--cmsc-acc-panel-bottom-md:4px;--cmsc-acc-panel-bottom-lg:4px');
    const desktop = rootOf(serverDom(accordionNode('acc-pb', { panelPaddingBottom: { desktop: 'none' } })));
    expect(desktop.getAttribute('style')).toMatch(/--cmsc-acc-panel-bottom:12px;--cmsc-acc-panel-bottom-md:12px;--cmsc-acc-panel-bottom-lg:(0px|var\(--cmsb-space-none, 0px\))/);
  });

  it('the open-item gap writes its value per breakpoint; a tier left unset reads the item gap there (or today\'s 0 / 8 px boxed)', () => {
    const plain = rootOf(serverDom(accordionNode('acc-og', { openItemGap: 'custom', openItemGapPx: 8 })));
    expect(plain.classList).toContain('cmsc-pb-accordion--open-gap');
    expect(plain.getAttribute('style')).toContain('--cmsc-acc-open-gap:8px;--cmsc-acc-open-gap-md:8px;--cmsc-acc-open-gap-lg:8px');
    const withItemGap = rootOf(serverDom(accordionNode('acc-og', {
      itemGap: 'custom', itemGapPx: { base: 20, desktop: 24 }, openItemGap: { desktop: 'custom' }, openItemGapPx: { desktop: 4 },
    })));
    expect(withItemGap.getAttribute('style')).toContain('--cmsc-acc-open-gap:20px;--cmsc-acc-open-gap-md:20px;--cmsc-acc-open-gap-lg:4px');
    const boxed = rootOf(serverDom(accordionNode('acc-og', { itemStyle: 'boxed', openItemGap: { tablet: 'custom' }, openItemGapPx: { tablet: 16 } })));
    expect(boxed.getAttribute('style')).toContain('--cmsc-acc-open-gap:8px;--cmsc-acc-open-gap-md:16px;--cmsc-acc-open-gap-lg:16px');
  });

  it('unset, both spaces render today\'s accordion', () => {
    const today = renderToString(page(accordionNode('acc-r14')));
    for (const props of [{ panelPaddingBottom: undefined }, { openItemGap: null }, { panelPaddingBottom: '' }, { panelPaddingBottomPx: 4, openItemGapPx: 4 }]) {
      expect(renderToString(page(accordionNode('acc-r14', props))), JSON.stringify(props)).toBe(today);
    }
  });

  it('the stylesheet reads the weight, the bottom space and the open-item gap from each breakpoint up, and animates the gap with the panel', () => {
    const css = builtCss();
    const weight = (value: string) => `${TITLE.map((path) => `.cmsc-pb-accordion--title-weight${path}`).join(',')}{font-weight:${value}}`;
    expect(css).toContain(weight('var(--cmsc-acc-title-weight)'));
    expect(css).toContain(weight('var(--cmsc-acc-title-weight-md,var(--cmsc-acc-title-weight))'));
    expect(css).toContain(weight('var(--cmsc-acc-title-weight-lg,var(--cmsc-acc-title-weight-md,var(--cmsc-acc-title-weight)))'));
    const bottom = '.cmsc-pb-accordion--panel-bottom>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-bottom:var(--cmsc-acc-panel-bottom)}';
    expect(css).toContain(bottom);
    expect(css.indexOf(bottom)).toBeGreaterThan(css.indexOf('.cmsc-pb-accordion__panel{padding:0012px}'));
    expect(css).toContain('.cmsc-pb-accordion--panel-bottom>.cmsc-pb-accordion__item>.cmsc-pb-accordion__panel{padding-bottom:var(--cmsc-acc-panel-bottom-lg,var(--cmsc-acc-panel-bottom-md,var(--cmsc-acc-panel-bottom)))}');
    const open = '.cmsc-pb-accordion--open-gap>.cmsc-pb-accordion__item:not(:last-child):has(>.cmsc-pb-accordion__panel:not([hidden])){margin-bottom:var(--cmsc-acc-open-gap)}';
    expect(css).toContain(open);
    // After the item gap, which it replaces while the item is open.
    expect(css.indexOf(open)).toBeGreaterThan(css.indexOf('.cmsc-pb-accordion--item-gap>.cmsc-pb-accordion__item:not(:last-child){margin-bottom:var(--cmsc-acc-item-gap)}'));
    expect(css).toContain('.cmsc-pb-accordion--open-gap>.cmsc-pb-accordion__item:not(:last-child):has(>.cmsc-pb-accordion__panel:not([hidden])){margin-bottom:var(--cmsc-acc-open-gap-lg,var(--cmsc-acc-open-gap-md,var(--cmsc-acc-open-gap)))}');
    // The gap follows the panel as it opens and closes.
    expect(css).toMatch(/\.cmsc-pb-accordion--open-gap\[data-animate\]>\.cmsc-pb-accordion__item\{transition:margin-bottom\.25s(ease)?\}/);
  });

  it('offers the weight and both spaces on the Responsive tab, the Custom px only with Custom; none in the defaults', async () => {
    const accordion = config.components['cms.Accordion']! as unknown as { fields: FieldMap; responsiveFields?: string[]; resolveFields?: (...args: unknown[]) => unknown };
    const fields = accordion.fields;
    for (const key of ['titleWeight', 'panelPaddingBottom', 'panelPaddingBottomPx', 'openItemGap', 'openItemGapPx']) {
      expect(fields[key]?.metadata, key).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
      expect(accordion.responsiveFields ?? [], key).toContain(key);
      expect(defaults[key], key).toBeUndefined();
    }
    expect(fields['panelPaddingBottom']?.label).toBe('Space below the open panel');
    expect(fields['openItemGap']?.label).toBe('Space after an open item');
    const resolveWith = (props: Record<string, unknown>) =>
      accordion.resolveFields!(
        { props: { ...defaults, id: 'acc', ...props } } as never,
        { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      ) as FieldMap;
    const unset = Object.keys(await resolveWith({}));
    expect(unset).not.toContain('panelPaddingBottomPx');
    expect(unset).not.toContain('openItemGapPx');
    expect(Object.keys(await resolveWith({ panelPaddingBottom: { desktop: 'custom' } }))).toContain('panelPaddingBottomPx');
    expect(Object.keys(await resolveWith({ openItemGap: 'custom' }))).toContain('openItemGapPx');
  });
});

describe('cms.Accordion filled item style (feature 169, T009, T010)', () => {
  type FieldMap = Record<string, { type?: string; options?: Array<{ value: unknown; label?: string }> }>;
  const SHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-accordion')!;
  const accordion = config.components['cms.Accordion']!;
  const fields = accordion.fields as FieldMap;
  const resolveWith = async (props: Record<string, unknown>) =>
    (await accordion.resolveFields!(
      { props: { ...defaults, id: 'acc', ...props } } as never,
      { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
    )) as FieldMap;

  it('filled: the root class, and no dividers class even with dividers stored', () => {
    const root = rootOf(serverDom(accordionNode('acc-filled', { itemStyle: 'filled', dividers: 'all', dividerPosition: 'title' })));
    expect(root.classList).toContain('cmsc-pb-accordion--filled');
    expect(root.className).not.toContain('dividers');
    expect(root.className).not.toContain('divider-title');
  });

  it('unset, plain and boxed keep today’s markup', () => {
    const root = rootOf(serverDom(accordionNode('acc-unset')));
    expect(root.className).toBe('cmsc-pb-accordion cmsc-pb-accordion--default cmsc-pb-accordion--icon-end');
    expect(rootOf(serverDom(accordionNode('acc-p', { itemStyle: 'plain' }))).className).toBe(
      'cmsc-pb-accordion cmsc-pb-accordion--default cmsc-pb-accordion--icon-end cmsc-pb-accordion--plain',
    );
    expect(rootOf(serverDom(accordionNode('acc-b', { itemStyle: 'boxed' }))).className).toBe(
      'cmsc-pb-accordion cmsc-pb-accordion--default cmsc-pb-accordion--icon-end cmsc-pb-accordion--boxed',
    );
  });

  it('the field offers Filled; the dividers and their position are hidden for it, the field objects stay the cached ones', async () => {
    expect(fields['itemStyle']?.options?.find((option) => option.value === 'filled')?.label).toBe('Filled');
    const shown = await resolveWith({ itemStyle: 'filled' });
    expect(Object.keys(shown)).not.toContain('dividers');
    expect(Object.keys(shown)).not.toContain('dividerPosition');
    expect(shown['itemStyle']).toBe(fields['itemStyle']);
    expect(Object.keys(await resolveWith({ itemStyle: 'plain' }))).toContain('dividers');
  });

  it('a filled item gap keeps 8 px where a tier is unset, as boxed', () => {
    const filled = rootOf(serverDom(accordionNode('acc-fg', { itemStyle: 'filled', itemGap: { desktop: 'custom' }, itemGapPx: { desktop: 16 } })));
    expect(filled.getAttribute('style')).toContain('--cmsc-acc-item-gap:8px;--cmsc-acc-item-gap-md:8px;--cmsc-acc-item-gap-lg:16px');
  });

  it('the stylesheet fills the title bar with the scheme’s surface tint, today’s neutral outside a scheme', () => {
    const trigger =
      /\.cmsc-pb-accordion--filled > \.cmsc-pb-accordion__item > \.cmsc-pb-accordion__trigger, \.cmsc-pb-accordion--filled > \.cmsc-pb-accordion__item > \.cmsc-pb-accordion__heading > \.cmsc-pb-accordion__trigger \{([^}]*)\}/.exec(
        SHEET,
      )?.[1] ?? '';
    expect(trigger).toContain('background: var(--cmsc-surface-tint, var(--cmsb-n-100, #f1f5f9));');
    expect(trigger).toContain('border-radius: 8px;');
    expect(trigger).toContain('padding-left: 16px;');
    const item = /\.cmsc-pb-accordion--filled > \.cmsc-pb-accordion__item \{([^}]*)\}/.exec(SHEET)?.[1] ?? '';
    expect(item).toContain('border: none;');
    expect(item).toContain('margin-bottom: 8px;');
    // After the boxed rules it sits beside.
    expect(SHEET.indexOf('.cmsc-pb-accordion--filled > .cmsc-pb-accordion__item {')).toBeGreaterThan(SHEET.indexOf('.cmsc-pb-accordion--boxed > .cmsc-pb-accordion__item {'));
  });
});
