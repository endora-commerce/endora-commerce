import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * `NavigationFeedback` — the client-side navigation feedback that replaces the
 * route-level `loading.tsx` skeleton.
 *
 * Two things are assertable from the rendered markup and both are the point of
 * the component:
 *
 * 1. **It renders nothing visible on the server.** A bar or a skeleton in the
 *    first flush would be a page announcing a wait that is not happening, and
 *    it would differ from the client's first render (`level === null`), which
 *    is a hydration mismatch.
 * 2. **The live region is in that first flush, and it is empty.** A live region
 *    that arrives already carrying its text is not reliably announced; the one
 *    that works is mounted empty and later filled. Asserting it here is what
 *    stops a later refactor from moving it behind the same condition as the bar.
 *
 * The timings, the click classifier's effect and the announcement itself are
 * behaviour of effects, which do not run under `renderToString` — the classifier
 * is exported as a pure function and unit-tested below instead, matching the
 * storefront's SSR-only test convention.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/catalog',
}));

const { NavigationFeedback, isRouterHandledClick } = await import(
  '../components/NavigationFeedback'
);

const idleClick = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const here = { origin: 'https://shop.example', pathname: '/catalog', search: '' };
const anchor = (over: Partial<{ target: string; hasDownload: boolean; href: string }> = {}) => ({
  target: '',
  hasDownload: false,
  href: 'https://shop.example/p/anchor-bolt',
  ...over,
});

describe('NavigationFeedback — server render', () => {
  it('shows no progress bar in the first flush', () => {
    const html = renderToString(
      <NavigationFeedback label="Loading the next page." slowLabel="Still loading." />,
    );
    expect(html).not.toContain('b2b-progress');
  });

  it('ships the live region empty, so the first announcement is announced', () => {
    const html = renderToString(
      <NavigationFeedback label="Loading the next page." slowLabel="Still loading." />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('Loading the next page.');
    expect(html).not.toContain('Still loading.');
  });

  it('keeps the region out of the visual flow', () => {
    const html = renderToString(
      <NavigationFeedback label="Loading the next page." slowLabel="Still loading." />,
    );
    expect(html).toContain('sr-only');
  });
});

describe('isRouterHandledClick', () => {
  it('claims a same-origin link to another path', () => {
    expect(isRouterHandledClick(idleClick, anchor(), here)).toBe(true);
  });

  it('claims a query-only change on the same path', () => {
    expect(
      isRouterHandledClick(
        idleClick,
        anchor({ href: 'https://shop.example/catalog?page=2' }),
        here,
      ),
    ).toBe(true);
  });

  it.each([
    ['a modified click that opens a tab', { ...idleClick, metaKey: true }, anchor()],
    ['a middle click', { ...idleClick, button: 1 }, anchor()],
    ['a click something else already handled', { ...idleClick, defaultPrevented: true }, anchor()],
  ])('disclaims %s', (_name, event, target) => {
    expect(isRouterHandledClick(event, target, here)).toBe(false);
  });

  it.each([
    ['a cross-origin link', anchor({ href: 'https://other.example/p/anchor-bolt' })],
    ['a download', anchor({ hasDownload: true })],
    ['a link opening a new window', anchor({ target: '_blank' })],
    ['a hash on the current page', anchor({ href: 'https://shop.example/catalog#specs' })],
    ['a link to the page we are on', anchor({ href: 'https://shop.example/catalog' })],
  ])('disclaims %s', (_name, target) => {
    expect(isRouterHandledClick(idleClick, target, here)).toBe(false);
  });
});
