import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  AuthProvider,
  ModulePresenceProvider,
  type AdminMe,
} from '@endora-commerce/admin-kit/lib';
import { AdminContributionsProvider } from '@endora-commerce/admin-kit/zones';
import { AdminRegistryProvider } from '../../../packages/admin-shell/src/lib/module-registry/index.js';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import type {
  AdminModulePresenceResponse,
  AdminZoneContribution,
  ModulePresence,
} from '@endora-commerce/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';

/**
 * Mount a subject under the **real** session and module-presence providers,
 * over a session and a projection the caller chose.
 *
 * ## Why this exists
 *
 * Feature 091's P3 published `useAuth`, `useModulePresence`,
 * `useSurfaceVisibility` and `usePageSizePreference` into
 * `@endora-commerce/admin-kit/lib`. That is what a packaged module needs — a
 * screen with no way to name `useAuth` renders every control live to a
 * read-only operator, who fills the form in and gets a 403 on save — and it
 * moves the `useSurfaceVisibility` → `useAuth` seam **inside** the package,
 * where `vi.mock('../../../packages/admin-shell/src/lib/auth', …)` cannot reach it. 36 admin test files and 179
 * tests were resting on that seam.
 *
 * Replacing the modules is not available any more, and it was never the better
 * test: a permission gate asserted against a stub of the predicate asserts that
 * the stub was consulted. So the repair is to drive the real providers, which
 * is what `backend/scripts/ledgers/admin-surface.ts` recorded as this group's
 * retiring condition from the day it opened.
 *
 * ## The seam is a prop, not a mock
 *
 * `ModulePresenceProvider` has taken `initial` since feature 073; P3 gave
 * `AuthProvider` the same. Neither needs a transport stub, so nothing here
 * mocks a module. That is deliberate and was measured rather than assumed: a
 * kit file importing `apiClient` from its **own** `./lib` barrel — the seam P2
 * established for the three published pickers — is a cycle, and under a
 * `vi.mock` factory calling `importActual` it resolves to the *real* module, so
 * the stub is bypassed and the request goes out to whatever is listening on the
 * API origin. The session cluster therefore imports `./api-client.js` directly
 * and is driven by data instead.
 *
 * ## The failure mode to watch for
 *
 * A subject that never mounts renders nothing and asserts nothing, which looks
 * exactly like a pass. `adminSession` therefore returns a session whose
 * `status` is `authenticated` from the first render (no boot fetch, no loading
 * frame), and `modulePresence` lists every module the caller names — a
 * projection that omits a module answers `isPresent` `false`, which is the
 * gate's *hidden* branch. Name the modules the subject consults.
 */

/** A signed-in admin, over the codes the caller names. */
export function adminSession(options: {
  /**
   * The permission codes the operator holds. `['*']` is the wildcard
   * `hasPermission` already understands, and is the right value for a test
   * whose subject is not a permission gate.
   */
  readonly permissions: readonly string[];
  readonly id?: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly preferredLanguage?: 'en' | 'pl' | null;
  readonly roleName?: string;
}): AdminMe {
  const permissions = [...options.permissions];
  return {
    adminUser: {
      id: options.id ?? '00000000-0000-4000-8000-00000000ad01',
      email: options.email ?? 'admin@test.com',
      firstName: options.firstName ?? 'Ada',
      lastName: options.lastName ?? 'Min',
      adminRoleId: '00000000-0000-4000-8000-00000000ad02',
      twoFactorEnabled: false,
      status: 'active',
      preferredLanguage: options.preferredLanguage ?? 'en',
    },
    role: {
      id: '00000000-0000-4000-8000-00000000ad02',
      code: 'test_role',
      name: options.roleName ?? 'Admin',
      permissions,
    },
    permissions,
  };
}

/** One module's row in the projection, present unless the caller says otherwise. */
function presenceRow(id: string, present: boolean): ModulePresence {
  return {
    id,
    present,
    platformState: present ? 'installed' : 'disabled',
    activated: present,
    deactivatable: true,
    nonDeactivatableReason: null,
  };
}

/**
 * The projection `GET /api/v1/admin/module-presence` would have answered.
 *
 * A module named in neither list is **absent**, because that is what the real
 * provider answers for an id it has not heard of. Listing the ids a subject
 * consults is therefore part of the assertion, not boilerplate.
 */
export function modulePresence(options: {
  readonly present?: readonly string[];
  readonly absent?: readonly string[];
  readonly degraded?: boolean;
}): AdminModulePresenceResponse {
  const absent = new Set(options.absent ?? []);
  const rows = [
    ...(options.present ?? []).filter((id) => !absent.has(id)).map((id) => presenceRow(id, true)),
    ...[...absent].map((id) => presenceRow(id, false)),
  ];
  return { modules: rows, degraded: options.degraded ?? false };
}

/**
 * Every module id the admin's own surface declarations name, read from those
 * declarations rather than listed here.
 *
 * The tests that need it are the ones whose subject is *not* presence — an
 * `AppShell` layout or palette case that used to stub `isPresent: () => true`.
 * The real provider cannot answer "everything": it answers `false` for an id it
 * has not heard of, which is the correct fail-closed rule (feature 073) and
 * means a projection has to enumerate. A list written into a test file is the
 * thing that goes stale silently — `AppShell.module-presence.test.tsx` carried
 * one of 42 ids — so this reads `AppShell.tsx`'s `NAV` and the generated
 * contribution registry instead, and **refuses** an empty result rather than
 * returning one: a projection of nothing hides every surface, which is a green
 * test with no subject on screen.
 */
export function everyDeclaredModule(): readonly string[] {
  const ids = new Set<string>();
  for (const file of ['../packages/admin-shell/src/components/AppShell.tsx', 'src/modules.generated.ts']) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const match of source.matchAll(/\bmodule(?:Id)?: '([a-z][a-z0-9_]*)'/g)) {
      ids.add(match[1] as string);
    }
  }
  if (ids.size === 0) {
    throw new Error(
      '[render-with-session] no module id found in the admin surface declarations; ' +
        'everyDeclaredModule() would hide every surface it was asked about.',
    );
  }
  return [...ids].sort();
}

/**
 * Every permission code the admin's own surface declarations name.
 *
 * The companion of {@link everyDeclaredModule}, for the same reason and with
 * the same refusal: a test whose subject is the *layout* used to stub
 * `hasPermission: () => true`, and the real predicate answers a **set**. It is
 * read from `AppShell.tsx`'s `requiredPermission` fields, both spellings — the
 * single code and the any-of array — so a nav entry added with a new code is
 * covered without an edit here.
 *
 * `prompt_actions:use` is included: it is declared on the assistant entry, and a
 * test that wants it denied removes it from the list rather than hunting for
 * every other code.
 */
export function everyDeclaredPermission(): readonly string[] {
  const source = readFileSync(resolve(process.cwd(), '../packages/admin-shell/src/components/AppShell.tsx'), 'utf8');
  const codes = new Set<string>();
  for (const match of source.matchAll(/requiredPermission: '([a-z_][a-z_.:]*)'/g)) {
    codes.add(match[1] as string);
  }
  for (const match of source.matchAll(/requiredPermission: \[([^\]]*)\]/g)) {
    for (const inner of (match[1] as string).matchAll(/'([a-z_][a-z_.:]*)'/g)) {
      codes.add(inner[1] as string);
    }
  }
  for (const match of source.matchAll(/'(prompt_actions:[a-z_]+)'/g)) codes.add(match[1] as string);
  if (codes.size === 0) {
    throw new Error(
      '[render-with-session] no permission code found in the admin surface declarations; ' +
        'everyDeclaredPermission() would deny every gate it was asked about.',
    );
  }
  return [...codes].sort();
}

export interface SessionWrapperOptions {
  readonly session: AdminMe;
  /**
   * The projection to seed `ModulePresenceProvider` with.
   *
   * **Omit it for a subject that mounts the provider itself** — `<App/>` does,
   * inside its own auth gate, so that an anonymous visitor on the login page
   * never fetches the enabled-set. Mounting a second one here would shadow the
   * subject's, which then fetches for real. Pass `App`'s `modulePresence` prop
   * instead.
   */
  readonly presence?: AdminModulePresenceResponse;
  /**
   * The zone contributions the subject's mounts should enumerate.
   *
   * Defaults to none, which is what the shipped registry answers for every zone
   * P4a mounts. It is a **provider and not an omission** even when empty:
   * `useAdminZone` refuses a mount outside `AdminContributionsProvider` rather
   * than reporting "nobody contributed", because a host screen rendering a zone
   * with no provider above it is a wiring defect and the silent answer would
   * make it indistinguishable from an empty registry.
   *
   * A host screen's test therefore drives the real renderer, exactly as P3's
   * repair made a permission gate's test drive the real predicate: a zone
   * asserted against a stub of the enumeration asserts that the stub was
   * consulted.
   */
  readonly contributions?: readonly {
    readonly moduleId: string;
    readonly contributions: { readonly zones?: readonly AdminZoneContribution[] };
  }[];
  /**
   * The generated contribution registry the shell's surfaces should enumerate.
   *
   * Defaults to **the real one** — `admin/src/modules.generated.ts` — because
   * that is what `<App/>` is handed in a build and what every `AppShell` nav,
   * palette and breadcrumb case here is asserting about. Feature 110's T120
   * made it a value the admin project passes in rather than a module the shell
   * imports (`@endora-commerce/admin-shell` cannot name a file in the project
   * that consumes it), so a wrapper is where it now enters a test.
   *
   * It is a **provider and not an omission** even when a subject renders no
   * module surface: `useAdminRegistry` refuses a read with no provider above
   * it, on `useAdminZone`'s reasoning — an empty sidebar and a broken mount
   * must not look the same.
   */
  readonly registry?: readonly {
    readonly moduleId: string;
    readonly contributions: AdminContributions;
  }[];
}

/**
 * Wrap `ui` in the real providers without rendering it, so it can be handed to
 * `renderWithI18n` (or to any other `render`) as the subject.
 */
export function withSession(ui: ReactElement, options: SessionWrapperOptions): ReactElement {
  const zoned = (
    <AdminRegistryProvider entries={options.registry ?? MODULE_ADMIN_CONTRIBUTIONS}>
      <AdminContributionsProvider entries={options.contributions ?? []}>{ui}</AdminContributionsProvider>
    </AdminRegistryProvider>
  );
  const inner =
    options.presence === undefined ? (
      zoned
    ) : (
      <ModulePresenceProvider initial={options.presence}>{zoned}</ModulePresenceProvider>
    );
  return <AuthProvider initial={options.session}>{inner}</AuthProvider>;
}

/** `renderWithI18n`'s sibling: the same wrapper, plus the two session providers. */
export function renderWithSession(
  ui: ReactElement,
  options: SessionWrapperOptions & { readonly bundle?: Bundle },
  renderOptions?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => {
    const seeded = withSession(<>{children}</>, options);
    if (options.bundle === undefined) return seeded;
    return (
      <TranslationProvider language="en" initialBundle={options.bundle}>
        {seeded}
      </TranslationProvider>
    );
  };
  return render(ui, { wrapper, ...renderOptions });
}
