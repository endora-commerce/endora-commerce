// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider, type CmsPageNavigationText } from './render-context.js';
import { PAGE_NAVIGATION_MAX_ITEMS } from './PageNavigation.js';

/**
 * `specs/169-page-builder-contact-form/` T051, US5, FR-010–FR-013 —
 * `cms.PageNavigation`: a `<nav>` with an accessible name holding a list of
 * plain same-page anchor links, so it works with JavaScript off. The active
 * link is the client island's business (`page-navigation-spy.test.tsx`); the
 * server HTML carries none.
 */

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.PageNavigation'] as ComponentConfig;
const defaults = (block?.defaultProps ?? {}) as Record<string, unknown>;

const ITEMS = [
  { label: 'About', anchor: 'about' },
  { label: 'Offer', anchor: 'offer' },
  { label: 'Contact', anchor: 'contact' },
];

function page(props: Record<string, unknown>): Data {
  return {
    root: { props: {} },
    content: [{ type: 'cms.PageNavigation', props: { ...defaults, id: 'pb169-nav', ...props } }],
  } as unknown as Data;
}

function html(props: Record<string, unknown>, text?: CmsPageNavigationText): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} {...(text ? { pageNavigationText: text } : {})}>
      <Render config={config} data={page(props)} />
    </CmsRenderProvider>,
  );
}

function dom(props: Record<string, unknown>, text?: CmsPageNavigationText): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(props, text);
  return host;
}

function nav(props: Record<string, unknown>, text?: CmsPageNavigationText): HTMLElement {
  const element = dom(props, text).querySelector<HTMLElement>('nav');
  if (!element) throw new Error('no <nav> rendered');
  return element;
}

const links = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLAnchorElement>('ul.cmsc-pb-page-nav__list > li > a.cmsc-pb-page-nav__link')];

describe('cms.PageNavigation on the server (T051)', () => {
  it('is registered for the cms context with its responsive fields', () => {
    expect(block).toBeDefined();
    const registered = block as ComponentConfig & { contexts?: string[]; responsiveFields?: string[] };
    expect(registered.contexts).toEqual(['cms']);
    expect(registered.responsiveFields).toEqual(['align', 'margin', 'padding', 'border']);
  });

  it('inserts with two placeholder links and the pill look', () => {
    expect(defaults['look']).toBe('pill');
    expect(defaults['items']).toEqual([
      { label: 'Section 1', anchor: '' },
      { label: 'Section 2', anchor: '' },
    ]);
  });

  it('renders a labelled nav of plain anchor links, without JavaScript', () => {
    const element = nav({ items: ITEMS });
    expect(element.getAttribute('aria-label')).toBe('On this page');
    expect(links(element).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['About', '#about'],
      ['Offer', '#offer'],
      ['Contact', '#contact'],
    ]);
  });

  it('names the nav with its own label, else the render context\'s, else English', () => {
    expect(nav({ items: ITEMS, label: 'Sections' }).getAttribute('aria-label')).toBe('Sections');
    expect(nav({ items: ITEMS }, { label: 'Na tej stronie' }).getAttribute('aria-label')).toBe('Na tej stronie');
    expect(nav({ items: ITEMS, label: '   ' }, { label: 'Na tej stronie' }).getAttribute('aria-label')).toBe('Na tej stronie');
    expect(nav({ items: ITEMS, label: 'x'.repeat(121) }).getAttribute('aria-label')).toBe('On this page');
  });

  it('skips an item with no label or an anchor outside the grammar, not the block', () => {
    const element = nav({
      items: [
        { label: 'About', anchor: 'about' },
        { label: '', anchor: 'offer' },
        { label: '  ', anchor: 'offer' },
        { label: 'Bad', anchor: 'Not An Anchor' },
        { label: 'Hash', anchor: '#contact' },
        { label: 'Empty', anchor: '' },
        { label: 'x'.repeat(81), anchor: 'long' },
        null,
        { label: 'Contact', anchor: 'contact' },
      ],
    });
    expect(links(element).map((a) => a.getAttribute('href'))).toEqual(['#about', '#contact']);
  });

  it(`renders at most ${20} links`, () => {
    expect(PAGE_NAVIGATION_MAX_ITEMS).toBe(20);
    const many = Array.from({ length: 25 }, (_, index) => ({ label: `Item ${index}`, anchor: `item-${index}` }));
    expect(links(nav({ items: many }))).toHaveLength(20);
  });

  it('with no valid item renders nothing on the storefront and a note in the editor', () => {
    const host = dom({ items: [{ label: 'Section 1', anchor: '' }] });
    expect(host.querySelector('nav')).toBeNull();
    expect(host.textContent).toBe('');
    expect(dom({ items: [] }).textContent).toBe('');

    const editing = renderToString(
      block.render({ ...defaults, id: 'pb169-nav', puck: { isEditing: true, dragRef: null } } as never),
    );
    expect(editing).not.toContain('<nav');
    expect(editing).toContain('Pick a section for each link');
  });

  it('carries a class per look, pill by default and for an unknown value', () => {
    expect(nav({ items: ITEMS }).className).toContain('cmsc-pb-page-nav--pill');
    expect(nav({ items: ITEMS, look: 'underline' }).className).toContain('cmsc-pb-page-nav--underline');
    expect(nav({ items: ITEMS, look: 'underline' }).className).not.toContain('--pill');
    expect(nav({ items: ITEMS, look: 'boxed' }).className).toContain('cmsc-pb-page-nav--pill');
  });

  it('marks a sticky bar, on the nav and on its box', () => {
    expect(nav({ items: ITEMS }).className).not.toContain('--sticky');
    const host = dom({ items: ITEMS, sticky: true });
    expect(host.querySelector('nav')!.className).toContain('cmsc-pb-page-nav--sticky');
    // The block's own "Hide on" wrapper is the box's parent: the stylesheet makes that wrapper stick.
    expect(host.querySelector('.cmsc-pb-hide-on > .cmsc-pb-page-nav-box--sticky')).not.toBeNull();
  });

  it('aligns per breakpoint: the phone\'s class, then one per larger breakpoint that differs', () => {
    expect(nav({ items: ITEMS }).className).toContain('cmsc-pb-page-nav--align-start');
    expect(nav({ items: ITEMS, align: 'center' }).className).toContain('cmsc-pb-page-nav--align-center');
    expect(nav({ items: ITEMS, align: 'stretch' }).className).toContain('cmsc-pb-page-nav--align-start');
    const responsive = nav({ items: ITEMS, align: { base: 'start', tablet: 'start', desktop: 'end' } }).className.split(' ');
    expect(responsive).toContain('cmsc-pb-page-nav--align-start');
    expect(responsive).toContain('cmsc-pb-page-nav--align-lg-end');
    expect(responsive.some((name) => name.startsWith('cmsc-pb-page-nav--align-md-'))).toBe(false);
  });

  it('puts no active link in the server HTML', () => {
    const markup = html({ items: ITEMS, sticky: true });
    expect(markup).not.toContain('aria-current');
    expect(markup).not.toContain('cmsc-pb-page-nav__link--active');
  });
});

describe('cms.PageNavigation fields (T051, contracts/blocks.md §3)', () => {
  const fields = block.fields as Fields & Record<string, { type: string; label?: string; options?: Array<{ value: unknown }>; arrayFields?: Record<string, { type: string }> }>;

  it('orders content, layout, style, spacing (after the registry\'s editor name and "Hide on")', () => {
    // The registry puts the per-breakpoint fields (alignment and spacing, the Responsive tab) after the others.
    expect(Object.keys(fields)).toEqual(['editorName', 'hideOn', 'items', 'label', 'look', 'sticky', 'align', 'margin', 'padding', 'border']);
  });

  it('offers the two looks, three alignments and a switch for sticky', () => {
    expect(fields['look']!.options!.map((option) => option.value)).toEqual(['pill', 'underline']);
    expect(fields['align']!.options!.map((option) => option.value)).toEqual(['start', 'center', 'end']);
    expect(fields['sticky']!.type).toBe('custom');
    expect(fields['items']!.arrayFields!['label']!.type).toBe('text');
    expect(fields['items']!.arrayFields!['anchor']!.type).toBe('custom');
  });

  it('resolveFields hands back the same field objects on every call', async () => {
    const params = { fields: block.fields, parent: { type: 'root', props: { id: 'root' } } } as never;
    const first = (await block.resolveFields!({ props: { ...defaults, id: 'a' } } as never, params)) as Record<string, unknown>;
    const second = (await block.resolveFields!({ props: { ...defaults, id: 'a', look: 'underline' } } as never, params)) as Record<string, unknown>;
    for (const key of Object.keys(first)) expect(second[key], key).toBe(first[key]);
  });
});

describe('cms.PageNavigation in the editor (T051, US5 scenario 6)', () => {
  it('warns about an anchor no element on the canvas carries, and drops the warning once one does', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        block.render({
          ...defaults,
          id: 'pb169-nav-edit',
          items: [{ label: 'About', anchor: 'about' }],
          puck: { isEditing: true, dragRef: null },
        } as never),
      );
    });
    expect(host.querySelector('nav')).not.toBeNull();
    expect(host.textContent).toContain('#about');

    const target = document.createElement('section');
    await act(async () => {
      target.id = 'about';
      document.body.appendChild(target);
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(host.textContent).not.toContain('#about');

    act(() => root.unmount());
    host.remove();
    target.remove();
  });
});
