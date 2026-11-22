/**
 * The whole of an admin entry point, in one element
 * (`specs/110-instance-repository/contracts/instance-tree.md` §2.4, R1.4).
 *
 * ## Why the shell composes this and not each project
 *
 * Mounting {@link App} takes four wrappers in a fixed order — strict mode, the
 * router, the session provider, the app — and **three of the four are the
 * shell's own requirements rather than the project's**. The router flag is the
 * sharpest: every module screen is `lazy()` inside `ModuleRoute`, and React
 * Router 7's default `startTransition` update leaves `useLocation()` on the
 * previous module while `history` has already moved, so the URL changes and the
 * outlet does not. A project that mounts a router without
 * `useTransitions={false}` gets an admin whose sidebar navigates
 * nowhere, with no error anywhere — and until this component existed, every
 * instance's `main.tsx` had to carry that flag from memory.
 *
 * The router is a **data router** (`createBrowserRouter`, issue #1605), not a
 * component `<BrowserRouter>`: only a data router offers a blocker, and the
 * blocker is what lets the unsaved-changes guard ask before the browser's Back
 * / Forward leaves a dirty screen. The whole app is the element of one splat
 * route, so the shell's own `<Routes>` stay descendant routes and match, link
 * and resolve relative paths exactly as they did.
 *
 * R1.4 is the second reason and it is a bound rather than a preference: the
 * wiring `endora new instance` writes is capped, and a client's entry point is
 * one of the files inside the cap. Four wrappers a package can supply are four
 * lines of a budget that exists to stop a second composition root growing in a
 * client's tree.
 *
 * ## What a project keeps
 *
 * The one fact the shell cannot derive — the generated contribution registry —
 * and whatever that project wants around it. {@link App} and {@link AuthProvider}
 * stay exported for a project composing its own tree; this is the default, not
 * the only door.
 */
import { StrictMode, useLayoutEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { App } from './App.js';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import type { AdminRegistryEntry } from './lib/module-registry/index.js';

export interface AdminRootProps {
  /**
   * The generated registry of the module packages this project installed.
   *
   * Required, and forwarded verbatim to {@link App}, whose own prop carries the
   * argument for why it is a prop at all: Vite is a static build, so the module
   * set has to enter the bundle from the project being built, and a package
   * cannot name a file in the project that consumes it.
   */
  readonly contributions: readonly AdminRegistryEntry[];
  /**
   * The path this admin is served under — `/admin` — when it is not the root.
   *
   * Defaults to the bundle's own base ({@link routerBasename} over Vite's
   * `import.meta.env.BASE_URL`), so a project that builds with
   * `base: '/admin/'` gets a router under `/admin` with nothing else to set:
   * one value, the bundler's, moves the asset URLs and the routes together.
   */
  readonly basename?: string | undefined;
}

/**
 * The router's basename for a bundler `base`.
 *
 * `'/admin/'` is `'/admin'`; the root — `'/'`, the empty string, and Vite's
 * relative `'./'` — is no basename at all, which is the router this shell has
 * always mounted.
 */
export function routerBasename(base: string | undefined): string | undefined {
  if (base === undefined || !base.startsWith('/')) return undefined;
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * The base the bundle was built with. Vite replaces the expression at build
 * time in the consuming project, exactly as it does `VITE_API_BASE_URL`
 * (`@endora-commerce/admin-kit`'s api client); outside a Vite build it is
 * absent and the router sits at the root.
 */
function bundleBase(): string | undefined {
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
}

type AdminRouter = ReturnType<typeof createBrowserRouter>;

export function AdminRoot({ contributions, basename }: AdminRootProps): ReactNode {
  const under = basename ?? routerBasename(bundleBase());
  // A data router listens to `history` from the moment it is created, so it is created in an
  // effect and disposed in its cleanup — never in render, where a discarded render would leave
  // a second router listening. A layout effect, so the first paint already has the router.
  const [router, setRouter] = useState<AdminRouter | null>(null);
  useLayoutEffect(() => {
    const created = createBrowserRouter(
      [
        {
          path: '*',
          element: (
            <AuthProvider>
              <App contributions={contributions} />
            </AuthProvider>
          ),
        },
      ],
      under === undefined ? {} : { basename: under },
    );
    setRouter(created);
    return (): void => {
      created.dispose();
    };
  }, [contributions, under]);
  if (router === null) return null;
  return (
    <StrictMode>
      {/*
        `useTransitions={false}`. Module screens are `lazy()` inside
        `ModuleRoute`, and RR 7's default transition leaves `useLocation()` on
        the previous module while `history` has already moved: the URL changes
        and the outlet does not. Home works because it is eager, which is what
        makes the defect look like a module problem. react-router 7.15.0
        renamed the flag from `unstable_useTransitions` and ignores the old
        spelling at runtime, which is why the peer floor is past the rename;
        `admin/test/components/AdminRoot.transitions.test.tsx` holds it.
      */}
      <RouterProvider router={router} useTransitions={false} />
    </StrictMode>
  );
}
