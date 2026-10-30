// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/169-page-builder-contact-form/` T052, US5, FR-011, FR-013 — the scroll
 * spy of `cms.PageNavigation`, a progressive enhancement over plain links:
 *
 * - with an `IntersectionObserver`, the section in view marks exactly one link
 *   active (`aria-current="true"` and the active class); the topmost
 *   intersecting section wins; when every section has left, the last stays;
 * - without one (an old browser), nothing throws and the links stay plain;
 * - the active link is brought into view inside a list that scrolls sideways,
 *   with `block: 'nearest'` and only while the bar is on screen, so the page
 *   itself never moves;
 * - a sticky bar writes its height to `--cmsc-page-nav-h` on the document
 *   element and removes it when it goes.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

type Callback = (entries: Array<Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>>) => void;

const observers: Array<{ callback: Callback; observed: Element[]; disconnected: boolean }> = [];

class FakeIntersectionObserver {
  private readonly record: { callback: Callback; observed: Element[]; disconnected: boolean };
  constructor(callback: Callback) {
    this.record = { callback, observed: [], disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element): void {
    this.record.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.record.disconnected = true;
  }
  takeRecords(): [] {
    return [];
  }
}

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.PageNavigation']?.defaultProps ?? {}) as Record<string, unknown>;

let root: Root | null = null;
let host: HTMLElement | null = null;
let sections: HTMLElement[] = [];

beforeEach(() => {
  observers.length = 0;
  sections = ['about', 'offer', 'contact'].map((id) => {
    const section = document.createElement('section');
    section.id = id;
    document.body.appendChild(section);
    return section;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const section of sections) section.remove();
  document.documentElement.style.removeProperty('--cmsc-page-nav-h');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(props: Record<string, unknown> = {}): void {
  const data = {
    root: { props: {} },
    content: [
      {
        type: 'cms.PageNavigation',
        props: {
          ...defaults,
          id: 'pb169-spy',
          items: [
            { label: 'About', anchor: 'about' },
            { label: 'Offer', anchor: 'offer' },
            { label: 'Contact', anchor: 'contact' },
          ],
          ...props,
        },
      },
    ],
  } as unknown as Data;
  host = document.createElement('div');
  document.body.prepend(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }}>
        <Render config={config} data={data} />
      </CmsRenderProvider>,
    );
  });
}

const links = (): HTMLAnchorElement[] => [...host!.querySelectorAll<HTMLAnchorElement>('a.cmsc-pb-page-nav__link')];
const active = (): string[] =>
  links()
    .filter((link) => link.getAttribute('aria-current') === 'true')
    .map((link) => link.getAttribute('href') ?? '');

function intersect(changes: Array<[number, boolean]>): void {
  const observer = observers.at(-1)!;
  act(() => observer.callback(changes.map(([index, isIntersecting]) => ({ target: sections[index]!, isIntersecting }))));
}

describe('page navigation scroll spy (T052)', () => {
  it('observes the linked sections and marks the one in view, exactly one at a time', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mount();
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed).toEqual(sections);
    expect(active()).toEqual([]);

    intersect([[1, true]]);
    expect(active()).toEqual(['#offer']);
    const offer = links()[1]!;
    expect(offer.className).toContain('cmsc-pb-page-nav__link--active');
    expect(links().filter((link) => link.className.includes('--active'))).toHaveLength(1);
  });

  it('picks the topmost intersecting section and keeps the last when all have left', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mount();
    intersect([
      [2, true],
      [1, true],
    ]);
    expect(active()).toEqual(['#offer']);
    intersect([[1, false]]);
    expect(active()).toEqual(['#contact']);
    intersect([[2, false]]);
    expect(active()).toEqual(['#contact']);
  });

  it('marks a followed link at once', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mount();
    act(() => links()[2]!.click());
    expect(active()).toEqual(['#contact']);
  });

  it('without an IntersectionObserver keeps plain links and throws nothing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() => mount()).not.toThrow();
    expect(links()).toHaveLength(3);
    expect(active()).toEqual([]);
  });

  it('stops observing when it goes', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mount();
    act(() => root!.unmount());
    root = null;
    expect(observers[0]!.disconnected).toBe(true);
  });

  it('brings the active link into view inside a list that scrolls sideways, only while the bar is on screen', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const windowScroll = vi.fn();
    vi.stubGlobal('scrollTo', windowScroll);
    mount();
    const list = host!.querySelector<HTMLElement>('.cmsc-pb-page-nav__list')!;
    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 300 });

    intersect([[2, true]]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(links()[2]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

    // The bar scrolled off the screen (not sticky): moving the page to show it would fight the reader.
    const navigation = host!.querySelector<HTMLElement>('nav')!;
    vi.spyOn(navigation, 'getBoundingClientRect').mockReturnValue({ top: -200, bottom: -150 } as DOMRect);
    intersect([
      [2, false],
      [0, true],
    ]);
    expect(active()).toEqual(['#about']);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(windowScroll).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('does not touch a list that fits', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    mount();
    intersect([[1, true]]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('a sticky bar writes its height on the document element while mounted', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 56, height: 56 } as DOMRect);
    mount({ sticky: true });
    expect(document.documentElement.style.getPropertyValue('--cmsc-page-nav-h')).toBe('56px');
    act(() => root!.unmount());
    root = null;
    expect(document.documentElement.style.getPropertyValue('--cmsc-page-nav-h')).toBe('');
  });

  it('a bar that is not sticky writes nothing', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    mount();
    expect(document.documentElement.style.getPropertyValue('--cmsc-page-nav-h')).toBe('');
  });
});
