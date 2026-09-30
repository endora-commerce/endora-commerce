import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';

import { AdminRoot } from '../../../packages/admin-shell/src/AdminRoot';

/**
 * `AdminRoot` mounts the router with React Router's transitions switched off.
 *
 * Every module screen is `lazy()` inside `ModuleRoute`. With the router's
 * default `startTransition` update, navigating to a module that is still
 * loading keeps the *previous* UI committed — `useLocation()` stays on the old
 * path while `history` has already moved, so the URL changes and the outlet
 * does not. This test reproduces that shape with a lazy screen that never
 * resolves: with transitions off the navigation commits at once and the
 * Suspense fallback shows; with them on, nothing on screen moves.
 *
 * It is a behavioural test on purpose. react-router 7.15.0 renamed
 * `unstable_useTransitions` to `useTransitions` and ignores the old prop at
 * runtime, so a source-level check of "the flag is present" stayed green while
 * the published shell regained the defect.
 */

vi.mock('../../../packages/admin-shell/src/lib/auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }): ReactNode => children,
}));

const NeverLoads = lazy(() => new Promise<never>(() => {}));

function LocationProbe(): ReactNode {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

vi.mock('../../../packages/admin-shell/src/App', () => ({
  App: (): ReactNode => (
    <>
      <LocationProbe />
      <Link to="/lazy-module">open module</Link>
      <Suspense fallback={<p>module loading</p>}>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/lazy-module" element={<NeverLoads />} />
        </Routes>
      </Suspense>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('AdminRoot router', () => {
  it('commits a navigation to a still-loading lazy module instead of holding the previous one', async () => {
    window.history.replaceState(null, '', '/');
    render(<AdminRoot contributions={[]} />);
    expect(screen.getByTestId('location').textContent).toBe('/');

    await act(async () => {
      fireEvent.click(screen.getByText('open module'));
    });

    expect(window.location.pathname).toBe('/lazy-module');
    await waitFor(
      () => {
        expect(screen.getByTestId('location').textContent).toBe('/lazy-module');
        expect(screen.getByText('module loading')).toBeTruthy();
      },
      { timeout: 1_000 },
    );
  });
});
