import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';

import { AdminRoot, routerBasename } from '../../../packages/admin-shell/src/AdminRoot';

/**
 * `AdminRoot` mounts the router under the base path the bundle was built for
 * (`specs/138-separate-components/` addendum, FR-026; D-284 clause 5 b).
 *
 * An admin served under `/admin` is built with Vite's `base: '/admin/'`, which
 * moves every asset URL. The router has to move with it: without a `basename`
 * the first render at `/admin/` matches no route, and every link the shell
 * renders points at `/…` — the storefront's side of the same host.
 */

vi.mock('../../../packages/admin-shell/src/lib/auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }): ReactNode => children,
}));

function LocationProbe(): ReactNode {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

vi.mock('../../../packages/admin-shell/src/App', () => ({
  App: (): ReactNode => (
    <>
      <LocationProbe />
      <Link to="/catalog/products">products</Link>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/catalog/products" element={<p>the products screen</p>} />
      </Routes>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('routerBasename — the router\'s base, from the bundle\'s', () => {
  it.each([
    ['/admin/', '/admin'],
    ['/back/office/', '/back/office'],
    ['/admin', '/admin'],
  ])('%s is %s', (base, basename) => {
    expect(routerBasename(base)).toBe(basename);
  });

  it.each(['/', '', './', undefined])('%j is no basename at all', (base) => {
    expect(routerBasename(base)).toBeUndefined();
  });
});

describe('AdminRoot under a base path', () => {
  it('matches its routes below the base, and links stay inside it', async () => {
    window.history.replaceState(null, '', '/admin/');
    render(<AdminRoot contributions={[]} basename="/admin" />);
    // The route table is the shell's own: `/` is the admin's home, at `/admin/`.
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(screen.getByText('products').getAttribute('href')).toBe('/admin/catalog/products');

    await act(async () => {
      fireEvent.click(screen.getByText('products'));
    });
    expect(window.location.pathname).toBe('/admin/catalog/products');
    expect(screen.getByText('the products screen')).toBeTruthy();
  });

  it('a deep link under the base renders its screen on a first load', () => {
    window.history.replaceState(null, '', '/admin/catalog/products');
    render(<AdminRoot contributions={[]} basename="/admin" />);
    expect(screen.getByText('the products screen')).toBeTruthy();
  });

  it('with no base path nothing changes: the router is at the root', () => {
    window.history.replaceState(null, '', '/catalog/products');
    render(<AdminRoot contributions={[]} />);
    expect(screen.getByText('the products screen')).toBeTruthy();
    expect(screen.getByText('products').getAttribute('href')).toBe('/catalog/products');
  });
});
