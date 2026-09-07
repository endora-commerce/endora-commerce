import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * What `App.tsx` and `AppShell.tsx` still declare is the admin application's
 * own (feature 091, SC-007; `contracts/admin-registry.md` R13a).
 *
 * ## Why this file exists
 *
 * It is the successor to `backend/scripts/check-admin-registrations.ts`, which
 * counted both registries per module and held the counts both ways, and which
 * was **deleted** by feature 091's Phase 5 T5 once the drain emptied its
 * population: with no module entry left in its baseline it had nothing to
 * ratchet in either direction, and its own `read:` line's independent source —
 * the modules a nav entry declares — was `expected=0`, which is `no-expectation`
 * and exit 2 on every run. An instrument whose only reachable answer is a
 * refusal is a done signal that says nothing.
 *
 * What went with it is the only thing in the estate that said *these four
 * routes and these three sidebar rows are the host's own*. A later reader
 * finding four `<Route>` elements in a file this feature emptied has no way to
 * tell "the admin application's own screens" from "unmigrated debt" unless
 * something says so. This is that something.
 *
 * ## Three properties, and the first is what makes it a fence
 *
 * 1. **Totals, not presence.** `expect(app).toContain('<Route path="/profile"')`
 *    cannot fail on a *fifth* host route, which is the direction the retired
 *    ratchet existed for. Both halves assert a count **and** the identities, so
 *    a module registration creeping back fails on the count, a host route added
 *    with no module to own it fails on the count, and a rename fails on the
 *    identities.
 * 2. **A reason per entry**, below, because "why is this one the host's" is a
 *    judgement a count cannot carry.
 * 3. **A file named after the claim**, not after the batch that happened to
 *    make it true. The assertion outlives every batch — the same reasoning that
 *    moved `ADMIN_HOST_OWNER` into `packages/cli/src/lib/admin-surfaces.ts`
 *    rather than leaving it in the ledger being deleted.
 */

/** One of the repository's source files, read as text, relative to `admin/`. */
function sourceOf(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/**
 * The same file with its comments removed.
 *
 * Everything below is matched as **text**, and both registries carry comments
 * naming the routes and the modules that have moved out of them — `AppShell.tsx`
 * even spells `module: null` in prose, explaining why `/platform/modules` is
 * host-owned. Matching that prose is the defect the check estate refuses by
 * reading literal AST nodes; this is the cheap version of the same rule, and it
 * is deliberately conservative: block comments go, and so do whole lines that
 * *begin* a line comment, but a `//` in mid-line is left alone so a URL inside
 * a string cannot truncate the code after it.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line))
    .join('\n');
}

/**
 * The four routes `App.tsx` declares that belong to no module, in source order,
 * each with the reason it is the admin application's own.
 */
const HOST_ROUTES = [
  // The dashboard. `admin/src/modules/home/` is claimed by no nav entry, so the
  // layout derivation leaves it host-owned rather than attributing it by name.
  'index',
  // A redirect for deep links that predate `dhl_parcel`'s screen moving into
  // its package. Its element comes from `react-router-dom` rather than from a
  // surface directory, which is what makes it the host's and not that module's.
  '/settings/dhl-parcel',
  // D-36: the screen that switches modules on and off may belong to no module,
  // or it could switch itself out of existence.
  '/platform/modules',
  // The signed-in admin's own profile.
  '/profile',
];

/**
 * The three `AppShell.tsx` destinations that belong to no module, in source
 * order — which is `NAV`'s two sections and then `PALETTE_ITEMS`.
 */
const HOST_NAV = [
  // The dashboard's sidebar row, in the `main` section.
  '/',
  // D-36 again: the modules screen, in the `system` section.
  '/platform/modules',
  // The dashboard's command-palette row. `adminNavEntries` counted a palette
  // row beside a sidebar one — both are `{ to, module }` object literals — and
  // it is a second declaration of the same host-owned destination rather than a
  // duplicate of it, so the total is three and not two.
  '/',
];

describe('SC-007 — the admin application declares its own registrations and no module’s', () => {
  it('declares exactly the four host routes, and those four', () => {
    const app = codeOf('../packages/admin-shell/src/App.tsx');
    // Every `<Route` the host declares with a **literal** destination: `index`,
    // or a `path="…"` string. Three `<Route` elements in that file are not
    // counted and each is named here rather than filtered by accident:
    //
    //  * `<Route element={<AppShell />}>` declares no destination at all — it
    //    is the layout wrapper every route below sits inside;
    //  * the element inside `registryRoutes().map(…)` writes `path={route.path}`,
    //    an expression rather than a literal, which is the whole point: a
    //    module's route arrives from `modules.generated.ts` and never from a
    //    literal in this file, so a literal *is* the discriminator;
    //  * `path="*"` is the not-found fallback rather than a destination.
    const declared = [...app.matchAll(/<Route\s+(?:(index)\b|path="([^"]*)")/g)].map(
      (match) => match[1] ?? match[2]!,
    );
    const hostRoutes = declared.filter((path) => path !== '*');
    // The total first, so the failure names the drift rather than the identity.
    expect(hostRoutes).toHaveLength(HOST_ROUTES.length);
    expect(hostRoutes).toEqual(HOST_ROUTES);
    // And the fallback is still declared — it is the one literal route excluded
    // above, so an assertion that never checked it would let it be deleted.
    expect(declared).toContain('*');
  });

  it('declares exactly the three host nav entries, and those three', () => {
    const shell = codeOf('../packages/admin-shell/src/components/AppShell.tsx');
    // `module: null` is the shell's own attribution for a destination no module
    // owns. It is read here rather than counted blind: the `to` beside each one
    // is what makes the count checkable against the reasons above, and a fourth
    // row appearing with a destination nobody has explained fails on both.
    const hostRows = [...shell.matchAll(/to:\s*'([^']*)'[^}]*?module:\s*null/gs)].map(
      (match) => match[1]!,
    );
    expect(hostRows).toHaveLength(HOST_NAV.length);
    expect(hostRows).toEqual(HOST_NAV);
  });

  it('declares no module’s route or nav entry, which is SC-007 itself', () => {
    // The other direction, and the one the retired ratchet was built for: a
    // batch that moves a module's screens into its package and leaves the
    // `<Route>` standing declares that screen twice, with `react-router`
    // silently taking the first match (D-23 calls that the worst available
    // failure). Every module registration now arrives through the generated
    // registry, so a *literal* module path in either file is that regression.
    const app = codeOf('../packages/admin-shell/src/App.tsx');
    const shell = codeOf('../packages/admin-shell/src/components/AppShell.tsx');
    const literalRoutes = [...app.matchAll(/<Route\s+(?:index\b|path="([^"]*)")/g)]
      .map((match) => match[1])
      .filter((path): path is string => path !== undefined && path !== '*');
    expect(literalRoutes.filter((path) => !HOST_ROUTES.includes(path))).toEqual([]);
    // A nav entry naming a module is `module: '<id>'`; the host's are the only
    // ones left, so the two counts have to agree.
    const allNav = [...shell.matchAll(/to:\s*'[^']*'[^}]*?module:\s*(null|'[^']*')/gs)].length;
    const hostNav = [...shell.matchAll(/to:\s*'[^']*'[^}]*?module:\s*null/gs)].length;
    expect(allNav).toBe(hostNav);
  });
});
