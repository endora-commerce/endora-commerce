import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MODULES } from '../../src/composition.generated.js';
import { EventBus } from '../../src/events/bus.js';
import { composeModules, type ModuleEntry } from '../../src/kernel/compose.js';
import { createRootContainer } from '../../src/kernel/container.js';
import {
  PackageDecorationNotOfferedError,
  type ModuleContext,
} from '../../src/kernel/module-context.js';
import { ApiInterceptorRegistry } from '../../src/http/interceptors/index.js';
import { loadOverlayModuleEntries } from '../../src/overlay/overlay-runtime.js';
import { findRepoRoot } from '../../scripts/lib/module-roots.js';
import {
  modulePackages,
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../scripts/lib/workspace-packages.js';

/**
 * **Case A** — a deployment's overlay module decorates a registration owned by
 * a module this repository ships as a **workspace package** (D-177, and
 * `specs/080-f4-real-scope/t053c-analysis.md` §3, which specifies this file).
 *
 * ## What is being asserted, and why it needed its own file
 *
 * D-176 Q3 refuses an overlay wrapping a registration an **installed** package
 * owns, and that refusal is keyed on one optional field:
 * `ModuleEntry.installedPackage`, whose only writer is the host's package
 * loader, which refuses a workspace member by realpath containment. So a module
 * that becomes a workspace package composes through `MODULES` with **no origin
 * marking**, is not in `installedPackageModuleIds`, and the overlay exemption
 * still applies to it. That is Case A, it is permitted, and D-177 settles that
 * it is permitted by construction rather than by accident.
 *
 * **Nothing in the tree asserted it.** The tests that come closest each miss it
 * from a different side:
 *
 *   - `overlay-decoration-seam.test.ts`' T-A hand-builds its `price_lists`
 *     stand-in, so the real entry can change underneath it;
 *   - its T-A″ sets `installedPackage: true` by hand — it asserts the *guard*,
 *     never the *derivation*;
 *   - `unit/packages/installed-packages.test.ts` asserts the derivation (a
 *     workspace member is refused as installed) and composes nothing;
 *   - A10 in `unit/scripts/package-schema-acceptance.test.ts` runs the
 *     acceptance instance, whose module package is *installed* by construction,
 *     so it exercises Case B on purpose.
 *
 * The regression that join exists to catch is a refactor that gives workspace
 * module packages an origin marking — a "unify package discovery" pass, a
 * generator that starts emitting `installedPackage` beside a bare
 * `@endora-commerce/mod-*` specifier, or a root that runs the module packages
 * through `loadPackageModuleEntries` for symmetry. Any of those turns every
 * deployment decoration over a packaged owner into a `ModuleCompositionError`
 * at boot, and every test above stays green. Most of this repository's modules
 * are packages today, so that is most of the platform.
 *
 * ## Three properties, and none of them is a written-down list
 *
 * 1. **The derivation.** The subject ids come off `endora: { type: 'module' }`
 *    in the members `pnpm-workspace.yaml` globs — the package's own statement
 *    about itself, the same one the boot-time discovery reads — so the 44th
 *    module package is covered by existing (D-100).
 * 2. **Entry-shape identity**, not merely the absence of a boolean. A packaged
 *    module's `MODULES` entry must be indistinguishable from a core module's.
 *    The absence of `installedPackage` is the property that matters today;
 *    identity of the key set is the property that stays true if the field is
 *    renamed, which is exactly the shape a "unify discovery" refactor takes.
 * 3. **The behaviour, through the real composition.** Every case below composes
 *    the **real** `MODULES` entry — its real `id`, its real `version`, its real
 *    `registerModule`, and whatever origin fields the generated array carries —
 *    with the **real** `example_overlay` entry from `loadOverlayModuleEntries`,
 *    never a hand-built `{ overlay: true }` literal. Hand-building the subject
 *    is precisely what makes the three near-misses above near-misses.
 *
 * ## The vacuous-pass guard is not padding here
 *
 * The derived id set was **empty until !910**. An assertion that iterates it
 * would have passed for the whole life of this repository before the first
 * module package existed, and it is one refactor away from being empty again —
 * the #113 / #215 failure this estate refuses everywhere else. So an empty set,
 * and a derived id with no `MODULES` entry, are both loud failures rather than
 * a loop that runs zero times.
 *
 * ## The one thing added to the real entry, and why
 *
 * The `example_overlay` module decorates one name, `pricingService`. No module
 * package registers it — `price_lists`, which does, is still core and carries a
 * second, unrelated packaging blocker. So each case runs the packaged module's
 * **own** `registerModule` and then registers `pricingService` on the same
 * `ModuleContext`, which makes the container's ownership ledger attribute the
 * name to that packaged module. That is the fact the decoration guard reads,
 * and it is the only thing this file supplies: the entry's identity and its
 * origin fields come from the generated array, so a refactor that marks a
 * workspace package reaches these cases through the spread rather than around
 * them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Registered by the packaged module under test; decorated by the overlay. */
interface ProbePricing {
  resolveLinePrice(input: unknown): Promise<{ priceListId: string } | null>;
}

const log = (): { info: () => void; warn: () => void; error: () => void } => ({
  info: () => {},
  warn: () => {},
  error: () => {},
});

/**
 * Every module id this repository ships as a workspace module package.
 *
 * Derived, never listed: `modulePackages` reads the `endora` block of each
 * member `pnpm-workspace.yaml` globs, so a module that becomes a package joins
 * this set in the merge request that packages it.
 */
function workspaceModulePackageIds(): readonly string[] {
  const repoRoot = findRepoRoot(HERE);
  if (repoRoot === null) {
    throw new Error(
      'no pnpm workspace above this test file — the subject set is derived from its ' +
        'members, so there is nothing to assert over',
    );
  }
  return modulePackages(workspaceMembers(repoRoot, nodeWorkspaceFs()))
    .map((pkg) => pkg.moduleId)
    .sort();
}

/**
 * The generated entries for those ids, refusing both empty answers.
 *
 * A derived id with no entry is the third refactor shape §3 names — a root that
 * composes module packages through the runtime package loader instead of
 * `MODULES` — and it has to be a failure here rather than one fewer iteration.
 */
function packagedEntries(): readonly ModuleEntry[] {
  const ids = workspaceModulePackageIds();
  if (ids.length === 0) {
    throw new Error(
      'no workspace member declares `endora: { type: "module" }` — this file asserts a ' +
        'property of module packages and there are none, which is a green that means ' +
        '"not looking" (the set was empty until !910)',
    );
  }
  const entries: ModuleEntry[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const entry = MODULES.find((candidate) => candidate.id === id);
    if (entry === undefined) missing.push(id);
    else entries.push(entry);
  }
  if (missing.length > 0) {
    throw new Error(
      `these workspace module packages compose through no MODULES entry: ${missing.join(', ')} — ` +
        'a root that composes them some other way is exactly the change this file exists to ' +
        'refuse, because it would take the origin marking with it',
    );
  }
  return entries;
}

/** The real overlay entry, with its `overlay` marking derived by the loader. */
async function exampleOverlayEntry(): Promise<ModuleEntry> {
  const entries = await loadOverlayModuleEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
  const entry = entries.find((candidate) => candidate.id === 'example_overlay');
  if (!entry) throw new Error('the example deployment ships no example_overlay module');
  return entry;
}

/**
 * The packaged entry, unchanged but for the registration the overlay decorates.
 *
 * `extra` is spread **after** the real entry so a case can add the origin
 * marking; nothing here ever removes one.
 */
function withDecoratedName(entry: ModuleEntry, extra: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    ...entry,
    ...extra,
    registerModule: (ctx: ModuleContext): void => {
      entry.registerModule(ctx);
      ctx.di.register({
        pricingService: ctx.asValue({
          resolveLinePrice: async (): Promise<{ priceListId: string }> => ({
            priceListId: 'core-list',
          }),
        }),
      });
    },
  };
}

function compose(entries: readonly ModuleEntry[]): { cradle: Record<string, unknown> } {
  const container = createRootContainer();
  composeModules(entries, {
    container,
    eventBus: new EventBus(),
    log: log(),
    // The overlay module registers an interceptor; a root that mounts no
    // registry refuses that registration, which would make every case here fail
    // for a reason that is not the one under test.
    interceptorRegistry: new ApiInterceptorRegistry(),
  });
  return { cradle: container.cradle as unknown as Record<string, unknown> };
}

describe('the derived subject set — what this file is asserting over', () => {
  it('finds workspace module packages at all', () => {
    // The vacuous-pass guard, stated as its own case so an empty derivation
    // reads as "this file measured nothing" rather than as three green loops.
    const ids = workspaceModulePackageIds();
    expect(ids.length).toBeGreaterThan(0);
  });

  it('composes every one of them through the generated core list', () => {
    const entries = packagedEntries();
    expect(entries.map((entry) => entry.id)).toEqual(workspaceModulePackageIds());
  });
});

describe('Case A — a packaged module’s MODULES entry is indistinguishable from a core module’s', () => {
  it('carries no origin marking', () => {
    // `in`, not `=== undefined`: an entry that carries the field explicitly set
    // to `false` is already a tree that has an opinion about origin, and the
    // next commit is the one that sets it to `true`.
    const marked = packagedEntries()
      .filter((entry) => 'installedPackage' in entry)
      .map((entry) => `${entry.id}: installedPackage=${String(entry.installedPackage)}`);

    expect(marked).toEqual([]);
  });

  it('has exactly the keys a core entry has', () => {
    // The property that survives the field being renamed. Both sides come out
    // of the same real array, so nothing here is a copy of the generator's
    // output shape written into a test.
    const packagedIds = new Set(workspaceModulePackageIds());
    const coreEntries = MODULES.filter((entry) => !packagedIds.has(entry.id));
    expect(coreEntries.length).toBeGreaterThan(0);

    const signatures = new Set(coreEntries.map((entry) => Object.keys(entry).sort().join(',')));
    // One signature, or the comparison below has no subject: a core list whose
    // own entries disagree cannot say what "shaped like a core entry" means.
    expect([...signatures]).toHaveLength(1);
    const coreSignature = [...signatures][0];

    const drift = packagedEntries()
      .map((entry) => ({ id: entry.id, keys: Object.keys(entry).sort().join(',') }))
      .filter((seen) => seen.keys !== coreSignature)
      .map((seen) => `${seen.id}: ${seen.keys} (a core entry has ${String(coreSignature)})`);

    expect(drift).toEqual([]);
  });
});

describe('Case A — a deployment’s overlay decorates a workspace-packaged owner’s registration', () => {
  it('wraps it for every module this repository ships as a package', async () => {
    const overlay = await exampleOverlayEntry();
    const entries = packagedEntries();
    expect(entries.length).toBeGreaterThan(0);

    const refused: string[] = [];
    const unwrapped: string[] = [];
    for (const entry of entries) {
      let tag: string | undefined;
      try {
        const { cradle } = compose([withDecoratedName(entry), overlay]);
        const pricing = cradle['pricingService'] as ProbePricing;
        tag = (await pricing.resolveLinePrice({}))?.priceListId;
      } catch (err) {
        refused.push(`${entry.id}: ${(err as Error).name}`);
        continue;
      }
      // Core ran and the deployment adjusted what it produced — delegation, not
      // replacement. An undecorated `core-list` is the other way this can fail:
      // composition succeeds, nothing wraps, and no exception announces it.
      if (tag !== 'overlay:core-list') unwrapped.push(`${entry.id}: ${String(tag)}`);
    }

    // Two assertions rather than one object, so the failure prints the module
    // ids: vitest elides a nested array behind `…(2)` and a standing assertion
    // that cannot say *which* module regressed is one bisect away from useless.
    expect(refused).toEqual([]);
    expect(unwrapped).toEqual([]);
  });
});

describe('the discrimination — the same entry, marked as an installed package, is refused', () => {
  it('throws PackageDecorationNotOfferedError naming the packaged owner', async () => {
    // Without this, "the overlay wrapped it" would be satisfied by a build in
    // which the guard does not run at all, and the case above would be
    // measuring the seam's absence rather than its answer. It is the same
    // requirement `check-inventory`'s red-proof rule states, applied to a seam.
    //
    // It is not a duplicate of `overlay-decoration-seam.test.ts`' T-A″, which
    // hand-builds a `vendor_pricing` stand-in: the subject here is the real
    // generated entry, so this also proves that these compositions reach the
    // guard at all — which is what makes the permitted case above evidence.
    const overlay = await exampleOverlayEntry();
    const entries = packagedEntries();
    expect(entries.length).toBeGreaterThan(0);

    const permitted: string[] = [];
    const wrongError: string[] = [];
    for (const entry of entries) {
      try {
        compose([withDecoratedName(entry, { installedPackage: true }), overlay]);
        permitted.push(entry.id);
      } catch (err) {
        if (!(err instanceof PackageDecorationNotOfferedError)) {
          wrongError.push(`${entry.id}: ${(err as Error).name}`);
          continue;
        }
        expect(err.registrationName).toBe('pricingService');
        expect(err.moduleId).toBe('example_overlay');
        expect(err.owner).toBe(entry.id);
      }
    }

    expect(permitted).toEqual([]);
    expect(wrongError).toEqual([]);
  });
});
