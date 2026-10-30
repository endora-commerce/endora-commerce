// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/169-page-builder-contact-form/` T053, US5 — a published
 * `cms.PageNavigation` hydrates without a mismatch: the server HTML carries no
 * active link, and the client island only marks one after it has mounted.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.PageNavigation']?.defaultProps ?? {}) as Record<string, unknown>;

function tree(data: Data) {
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} pageNavigationText={{ label: 'Na tej stronie' }}>
      <Render config={config} data={data} />
    </CmsRenderProvider>
  );
}

describe('a published page navigation hydrates (T053)', () => {
  it.each([false, true])('sticky %s: no hydration mismatch', async (sticky) => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    const data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.PageNavigation',
          props: {
            ...defaults,
            id: 'pb169-hydrate',
            sticky,
            items: [
              { label: 'About', anchor: 'about' },
              { label: 'Offer', anchor: 'offer' },
            ],
          },
        },
      ],
    } as unknown as Data;
    const html = renderToString(tree(data));
    expect(html).toContain('aria-label="Na tej stronie"');
    host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      await act(async () => {
        root = hydrateRoot(host!, tree(data), {
          onRecoverableError: (error) => {
            errors.push(String(error));
          },
        });
      });
    } finally {
      consoleError.mockRestore();
    }
    expect(errors.filter((message) => /hydrat|didn't match/i.test(message))).toEqual([]);
    expect(host.querySelectorAll('a.cmsc-pb-page-nav__link')).toHaveLength(2);
  });
});
