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
 * outlet does not. A project that mounts `<BrowserRouter>` without
 * `unstable_useTransitions={false}` gets an admin whose sidebar navigates
 * nowhere, with no error anywhere — and until this component existed, every
 * instance's `main.tsx` had to carry that flag from memory.
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
import { StrictMode, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.js';
import { AuthProvider } from './lib/auth.js';
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
}

export function AdminRoot({ contributions }: AdminRootProps): ReactNode {
  return (
    <StrictMode>
      {/*
        `unstable_useTransitions={false}` — react-router 7.14. Module screens
        are `lazy()` inside `ModuleRoute`, and RR 7's default transition leaves
        `useLocation()` on the previous module while `history` has already
        moved: the URL changes and the outlet does not. Home works because it
        is eager, which is what makes the defect look like a module problem.
      */}
      <BrowserRouter unstable_useTransitions={false}>
        <AuthProvider>
          <App contributions={contributions} />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  );
}
