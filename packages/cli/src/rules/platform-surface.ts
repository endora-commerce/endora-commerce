/**
 * CI check — a module reaches the platform only through what the platform
 * publishes (feature 080, T042d; ruling **D-160.8**).
 *
 * ## Why it exists
 *
 * `specs/080-f4-real-scope/contracts/host-package.md` §1 classifies all 53
 * platform files a module reaches as **P** (published API), **A** (accidental
 * reach — host-internal, harness-only or orchestrator-only) or **O** (the
 * module is reaching for a class where a sanctioned port exists). Three
 * delivered rows now build on that classification, and **nothing in the
 * repository enforced it**: `check:module-boundary` is module→module,
 * `check:kernel-boundary` is ORM relations, and the `exports` map D-160.7 rules
 * enforces nothing at all for the modules still in `backend/src` — which is all
 * of them. A classification with no ratchet rots at the speed of the tree, and
 * this one is load-bearing for the package split.
 *
 * ## The population, and what it misses
 *
 * Every import specifier written in a module's own sources — core under the
 * application's module roots, packaged under `packages/modules/<id>`, overlay
 * under `src/apps` — that names the platform. Two spellings, and they are the
 * same reach:
 *
 *   * a **relative** specifier that resolves to a file outside the module tree.
 *     "Outside the module tree" is the whole predicate: the host is everything
 *     that is not a module, so a reach into `src/seeds` or `src/composition.ts`
 *     is judged by the same rule as one into `src/kernel`, with no directory
 *     list to keep current.
 *   * a **bare** specifier into the host package — `<host>/kernel` — which is
 *     the only spelling a module outside the application tree has (feature 080,
 *     T060). It resolves through the host's own `exports` map to the same
 *     barrel, so `@endora-commerce/platform/http` and `../../http/index.js` are
 *     one answer. Neither the package name nor the subpath list is written
 *     here: both are read off the manifest of the member declaring
 *     `endora.type: "platform"`, so the D-161 scope rename and a sixth
 *     published directory arrive by being authored once.
 *
 * A declared subpath lands on a **barrel**, and reaching a barrel is reaching
 * the published surface entire — so a bare reach is counted, attributed and
 * cleared, and the symbol-level verdicts below are the relative spelling's. That
 * is not a weaker rule for a packaged module: a name the barrel does not carry
 * is a `tsc` error at the import, which is the same answer sooner. What the bare
 * spelling *can* be wrong about is the **subpath**, and that is the finding it
 * gets.
 *
 * Every specifier shape `scripts/lib/specifiers.ts` knows is read, `import type`
 * and the one type-position `import('…')` included (§0b: a `from '…'`-only scan
 * does not see it, and a module would move with an unrewritten specifier that
 * `tsc` resolves and `node` never sees).
 *
 * **The second bullet is T060 and it is a repair, not a widening.** The
 * population was relative specifiers alone, on the reasoning — written into
 * this header — that "there is no host package yet, and when there is, its
 * `exports` map refuses a deep path at resolution time and this check's
 * population shrinks to nothing on its own". Both halves were wrong by the time
 * the first module moved. The map refuses a *deep* path and licenses everything
 * a widened map would license, which is precisely the reach D-160.8 exists to
 * refuse; and a population that shrinks as the sweep proceeds is a check that
 * reports green because it stopped looking. Measured: batch one took **104**
 * reaches out of the walk and modules #1–#5 another 112, while the recorded
 * read size absorbed one module's worth of the fall inside its own floor. That
 * is why {@link hostDependentCoverage} exists beside the resolution — the
 * repair without the floor is one edit away from happening again.
 *
 * **What that misses, stated rather than discovered later.** A specifier is not
 * the only way to reach something, and `check:module-boundary` learned it the
 * expensive way — it had to grow a SQL-table predicate for 121 reaches that name
 * no specifier at all. The same three doors are open here and none of them is
 * this check's:
 *
 *   * **A container name.** `lazyPort('settingsReadPort')` reaches the platform
 *     through a string. That edge is `check:port-dependencies`' and
 *     `check:port-shape`'s, which between them own the port surface;
 *     `PLATFORM_OWNED_NAMES` is where a platform-owned name is declared.
 *   * **A platform-owned table.** `settings`, `audit_logs`,
 *     `module_registrations` and `sales_channels` are the host's, and SQL naming
 *     one names no specifier. That door is `check:module-boundary`'s and it is
 *     **open**: its owner map attributes those four to `kernel` off the
 *     platform-relative path of the file declaring them, so a module's SQL
 *     naming one is reported like any other cross-owner reach. `catalog`'s
 *     `sales_channel_products` join is ledgered under that attribution today,
 *     and `admin_actions`' `module_registrations` join was until feature 080
 *     retired it. This paragraph read *"a module→platform table reach is
 *     currently nobody's"* and was measured false while that second entry was
 *     being drained — it was written before the platform relocation taught the
 *     other check to attribute a `packages/platform/…` path to the kernel.
 *     What is still not this check's is the **verdict**: a table has no barrel,
 *     so there is no published-symbol question to ask about one.
 *   * **A module package's own layout.** Where inside a package a subpath
 *     leads is that package's `exports` map, and this check reads only the
 *     *host's*. A module that reached another module by bare specifier is
 *     `check:module-boundary`'s, which resolves module package names for
 *     exactly that reason.
 *
 * ## The granularity: per symbol, of a named file
 *
 * A finding is a **(module file, platform file, symbol)** triple, and the
 * verdict is "does that platform file's barrel publish that name". Not per file,
 * and the difference is not academic — !883 measured it: sixteen symbols of
 * **P** files are reached by nobody and are deliberately unpublished, so
 * "the file is P" licenses `SettingsCache`, `decryptSecretValue` and the LRU
 * tuning constants along with the symbols the classification actually names.
 *
 * **What per-*file* granularity would catch that this will not.** A per-file
 * check would refuse every reach into an **A** or **O** file outright, symbol or
 * no symbol — so it would flag `SettingNotRegistered` imported from
 * `settings.service.ts` (row 8, **O**), `parseHostMap` from
 * `sales-channel-resolver.service.ts` (row 24, **O**) and
 * `MembershipMutationResult` from `sales-channel-membership.service.ts` (row 15,
 * **O**). Eight such symbols stand today and §8 rules every one of them
 * *published* on purpose — a `@throws` a caller cannot name is a method a caller
 * cannot call. So the per-file verdict would be eight false findings, and its
 * one genuine catch is a different question: *is this symbol rightly on the
 * barrel at all?* That question belongs to
 * `test/unit/kernel/published-surface.test.ts`, which holds each barrel to
 * §1.3's own symbol column in both directions. The two are deliberately not
 * duplicates: that test asks whether the barrel is right, this check asks
 * whether the tree obeys it, and both read the barrel through
 * `scripts/lib/platform-surface.ts` so they cannot disagree about what it says.
 *
 * **That gap is closed** (T042f). It read, until then: `!883` prunes and
 * ratchets three of the five barrels, and `tenancy/index.ts` and
 * `commands/index.ts` are published surface by D-160.7 with no expected set at
 * all — so for two of this check's five subpaths its authority was a barrel
 * nothing held to §1.3. Both are now pruned to their **P** columns (§1.3 rows
 * 2, 5, 12, 21, 28, 30, 33) and ratcheted two-way, and
 * `published-surface.test.ts` derives its own population from
 * {@link PUBLISHED_SUBPATHS} rather than a list, so a sixth published directory
 * cannot arrive unratcheted the way these two did.
 *
 * Worth recording, because a green that moves nothing is the outcome most
 * likely to be misread: closing it moved **no** ledger key and no finding. The
 * 37 names the two barrels shed are reached by no module, and every name a
 * module reaches stayed published — so nothing had been hiding behind the
 * unratcheted barrels. The value bought is prospective: a 38th name added to
 * either now has to move an expected set.
 *
 * ## Five findings
 *
 *   * `unpublished-symbol` — the rule itself.
 *   * `whole-file-reach` — `import * as`, a side-effect import, `export *`, a
 *     `require()` or a dynamic `import()` with no named binding, at a file that
 *     is not a barrel. The symbol set is not knowable from the specifier, so the
 *     reach is the file's *whole* surface, internals included.
 *   * `unresolvable-reach` — a relative specifier that names no file the walk
 *     found. It is a finding and not a skip: !879 found #215 one layer in, where
 *     a walk of the right length had its *result* discarded downstream and
 *     reported clean behind a full-length `read:` line.
 *   * `unattributed-source` — a file under a module walk root that no module
 *     owns. Same reason: a file walked and not judged is worse than one not
 *     walked, because the `read:` line counts it.
 *   * `unpublished-subpath` — a bare specifier into the host package naming a
 *     subpath its `exports` map does not declare, the host's root among them
 *     (D-160.7 publishes no root export). Today `node` and `tsc` refuse it too,
 *     which is not a reason to leave it unjudged: what makes it a *finding* is
 *     that widening the map is the obvious repair, and the whole of D-160.8 is
 *     that widening the map is the thing an author must not do quietly.
 *   * `host-internal-subpath` — a bare specifier naming a subpath the `exports`
 *     map **does** declare and no barrel carries (D-160.14, feature 109). It is
 *     a third state and not a shade of the two above, and it is the only one of
 *     the six that `node` and `tsc` both accept: `./composition` resolves, so
 *     nothing but this check stands between a module and 27 composition symbols
 *     — `composeModules`, `createRootContainer`, `registerOrm` — that no module
 *     may name, production source or test. A module's server-bound test composes
 *     through the test kit's `composeTestServer`.
 *
 *     It could not be a sixth {@link PUBLISHED_SUBPATHS} entry, measured:
 *     {@link PlatformSurface.published} is keyed by target file with no subpath
 *     dimension, so that entry would publish `composeModules` out of
 *     `kernel/compose.ts` for a module's *relative* reach as well — and, this
 *     check reporting `violations=0`, would change nothing it prints. The two
 *     lists answering differently is the mechanism, not a drift to reconcile:
 *     {@link HostPackage.declaredSubpaths} is the manifest's answer,
 *     {@link PUBLISHED_SUBPATHS} is the ruling's.
 *
 * ## One key space, and it is the repository's
 *
 * Every path here — a module source, a platform file, a barrel, a ledger key —
 * is written relative to the **repository root**. That is more verbose than the
 * `modules/blog/x.ts` shape the other ledgers use, and it is not a style
 * choice: this check *resolves* specifiers, and a specifier resolves in exactly
 * one namespace. `layout.keyOf` deliberately has two bases — an application
 * file is keyed inside `backend/src`, a packaged module's file relative to the
 * checkout, because there is no application prefix that would be true of the
 * second — and a resolver straddling both is wrong for every reach that crosses
 * between them. Measured on the split-tree fixture, where six modules live in
 * `packages/modules/<id>/src`: 90 reaches resolved to nothing, and the whole
 * point of that fixture is that a check keeps working while the layout moves.
 *
 * Plus the **refusals**, each over an input whose silent absence would narrow
 * the answer rather than fail it:
 *
 *   * a barrel this parse cannot read in full (an `export *`, a namespace
 *     re-export, an `export { … }` with no `from`) is exit 2, never a narrower
 *     published set. A short surface turns correct reaches into findings, and
 *     the obvious "repair" for one of those is to widen the barrel;
 *   * a workspace with no platform member, or a platform member publishing
 *     under no name — every bare reach would then be judged by nothing;
 *   * a module package whose `package.json` will not parse, which is what says
 *     whether it reaches the host at all;
 *   * and {@link hostDependentCoverage}'s shortfall: a module package that
 *     declares the host and contributed no host reach to this walk. That is
 *     issue #215's predicate over the population T060 restored, and it is the
 *     one derivation that would have caught T060's own defect — `manifest-index`
 *     counts modules that produced a *file*, which a packaged module does
 *     plentifully, and `platform-barrels` counts barrels, which a module move
 *     does not touch.
 *
 * ## The second consumer population (feature 115, D115-5)
 *
 * The rule above is *a reach into the host names a published subpath or a
 * declared host-internal one, never a file inside the package by relative path*,
 * and it was asked of **modules** only. The **application** writes the same
 * reach — 84 of them, every one of which resolves in this checkout and in no
 * instance built from published packages, which is the defect D-207 names — and
 * was outside the population by construction: `moduleIdOf` answers `null` for
 * every one of its files, so a green was honest about a population that did not
 * contain them. {@link scanApplicationReaches} is that half, `relative-host-reach`
 * is its finding, and {@link LedgeredHostReach} is its ledger's entry.
 *
 * It is one rule with two populations and not two rules: this analysis already
 * derives the four inputs a second one would re-derive, and two derivations of
 * one population are two answers waiting to disagree (D-100). Normative:
 * `specs/115-lifecycle-container-move/contracts/host-reach-check.md`.
 *
 * Usage: `tsx scripts/check-platform-surface.ts [--list]`
 * Exit 0 = every reach into the platform is published, declared or ledgered;
 * exit 1 = at least one is not, or a ledger entry is stale;
 * exit 2 = the walk, the index, a barrel or the application tree could not be read.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { moduleIdOf } from '../lib/module-population.js';
import {
  resolutionCandidates,
  resolveHostSpecifier,
  resolveRelative,
  type BarrelUnreadable,
  type HostPackage,
  type PlatformSurface,
} from '../lib/platform-surface.js';
import { type ReadCoverage } from '../lib/read-size.js';
import { namedSpecifiers } from '../lib/specifiers.js';

/** The symbol token recorded for a reach that names no symbol at all. */
export const WHOLE_FILE = '*';

/** The symbol token recorded for a finding that is about the file, not a name. */
export const NO_SYMBOL = '?';

/** The target token recorded for a source file no module owns. */
export const NO_MODULE = '(unattributed)';

export type PlatformSurfaceFindingKind =
  | 'unpublished-symbol'
  | 'whole-file-reach'
  | 'unresolvable-reach'
  | 'unattributed-source'
  | 'unpublished-subpath'
  | 'host-internal-subpath'
  | 'relative-host-reach';

export interface PlatformSurfaceFinding {
  readonly kind: PlatformSurfaceFindingKind;
  /** The module file, keyed relative to the source root. */
  readonly file: string;
  readonly line: number;
  /** The module that owns {@link file}, or `null` when nothing does. */
  readonly moduleId: string | null;
  /**
   * The platform file reached, keyed relative to the source root — or, for an
   * `unresolvable-reach`, the specifier as written, and for an
   * `unattributed-source`, {@link NO_MODULE}.
   */
  readonly target: string;
  /** The name reached, {@link WHOLE_FILE}, or {@link NO_SYMBOL}. */
  readonly symbol: string;
  /** The specifier as written, for the failure message. */
  readonly specifier: string;
  /**
   * The **bare specifier** that carries {@link PlatformSurfaceFinding.target} —
   * `@endora-commerce/platform/kernel` — or `null` when no barrel carries the
   * file at all. A `relative-host-reach`'s remedy, and nothing else's.
   *
   * It is derived in the analysis rather than in {@link remedyOf} because the
   * derivation needs the barrels and the `exports` map and a remedy sentence has
   * neither: {@link PlatformSurface.publishedBy} says which barrel publishes the
   * file, {@link HostPackage.subpathTargets} says which subpath that barrel is,
   * and {@link HostPackage.name} says what a consumer writes. All three are read
   * off the package, so a sixth published directory changes the sentence in the
   * same run rather than when somebody remembers — which is the property
   * host-reach-check.md §3 asks for.
   */
  readonly publishedAs?: string | null;
}

/**
 * One ledgered reach: which unpublished names this file may take from that
 * platform file, and why.
 *
 * **The symbols are named rather than counted**, which is where this ledger
 * differs from `check:module-boundary`'s omittable `{ sites, reason }`. There a
 * count is enough because the verdict is per *target* — a file either may name
 * another module's directory or it may not, and how often says nothing a
 * reviewer needs. Here the verdict is per *symbol*: a **P** file publishes some
 * of its exports and withholds others, so an entry that did not name the symbol
 * could not be checked against the barrel it disagrees with, and a reach that
 * swapped one unpublished name for another would inherit the entry in silence.
 */
export interface LedgeredReach {
  /** Every unpublished name this file takes from that target. Order is not read. */
  readonly symbols: readonly string[];
  /** Why it stands, and what would retire it. */
  readonly reason: string;
}

/**
 * The reaches into unpublished platform surface that stand today.
 *
 * Keyed `<module file>|<platform file>`, both relative to the repository root —
 * so moving code inside a file does not invalidate an entry, and re-opening a
 * closed reach does not silently inherit one.
 *
 * The platform half is spelled at `packages/platform/src/…` since the
 * relocation, which is where the file is. A module still writes the old relative
 * specifier and still lands on a re-export shim at `backend/src/<subpath>/…`;
 * {@link PlatformSurfaceInput.canonicalTargetOf} follows the shim, because a
 * shim publishes nothing and judging one would refuse every reach in the tree.
 * Forty of these keys were re-spelled by the move and not one entry, symbol or
 * count moved with them.
 *
 * **Two-way and draining**, in the idiom of `PORT_CATCHES_TO_DRAIN`: an
 * unledgered reach fails the build, a key that no longer describes one fails it,
 * and a listed symbol the walk no longer sees fails it too. Every entry names
 * the contract paragraph that classified it and the event that retires it — an
 * entry is debt with a due date, not a permission.
 *
 * **What is left is four files, and none of them is a module's.** The ledger
 * held 33 keys; 29 of them were `_lifecycle`'s, under five reasons that each
 * said the same thing in a different register — the ORM bootstrap a
 * container-less CLI has no other way to reach, the `ModulePlugin` type, the
 * worker-pause pair, the twelve unpublished targets it was the only consumer
 * of. All 29 retired together, and **not one of them by editing an import**,
 * which is what every one of those reasons predicted: D-160.11's second half
 * moved `_lifecycle`'s platform-safe files into the host package, where the
 * same specifier crosses no boundary
 * ({@link PlatformSurfaceInput.platformSourceRoot}), and left its host half —
 * the manifest registry, the divergence reader and the five `module:*`
 * commands — outside the module walk, where it is host code like `src/db` and
 * `src/overlay` and was never this check's subject.
 *
 * So no module is blocked by this check, and none is ledgered by it. The three
 * entries that were questions rather than repairs are all answered:
 * `REGISTRY_CACHE` went with D-174 — `admin_actions` registers an
 * `InProcessCacheLayer` and the platform's own state-changed subscriber drops
 * it, so the module names no channel and no new symbol was published — and the
 * TOTP shim entry went by **deletion**: its premise turned out to be false (§8's
 * one-hop rule is scoped to *port* methods, and the barrel applies it that way
 * in both directions), the two backup-code functions had zero call sites and
 * zero tests, and the shim itself had zero importers. Nothing was published for
 * any of them.
 *
 * A new entry is therefore a real finding, not a queue position: it is a module
 * the F4 sweep cannot convert, and the group header it needs has to be written
 * before it is added.
 */
export interface PlatformSurfaceInput {
  /**
   * The module sources to judge, keyed relative to the source root.
   *
   * Everything the walk opened, including a file no module owns — attributing
   * it is the analysis' job and failing to is a finding.
   */
  readonly sources: ReadonlyMap<string, string>;
  /** Every file key that exists under the source root, for resolving a specifier. */
  readonly files: ReadonlySet<string>;
  /** The published surface, from `lib/platform-surface.ts`. */
  readonly surface: PlatformSurface;
  /**
   * Which module a key belongs to. Defaults to the `modules/<id>/` segment,
   * which is what the application tree and an overlay tree both carry; a run
   * over a tree that holds module **packages** passes the layout's own
   * attribution, which reads a package's declared id instead.
   */
  readonly moduleIdOf?: (key: string) => string | null;
  /**
   * A resolved target's canonical key — the file a specifier really lands on.
   *
   * Identity for every reach but one: the platform relocation left a re-export
   * shim at each old `backend/src/{kernel,http,tenancy,commands,events}/…` path,
   * so a module's relative specifier resolves to a file whose whole content is
   * `export * from` the platform's own. Judging the shim would compare a module's
   * symbol against a barrel that lives one tree over and publish nothing, turning
   * all 1642 reaches into findings. Judging the file the shim forwards to is the
   * effective truth and keeps this check's answer the same across the move — the
   * ledger's platform half is spelled at the platform, which is where it is.
   */
  readonly canonicalTargetOf?: (key: string) => string;
  /**
   * The host package, so a **bare** specifier into it is judged like a relative
   * one (feature 080, T060).
   *
   * `null` — the default — is "this workspace declares no platform", which is
   * true of every fixture workspace and of nothing else. It is not a way to
   * switch the population off: a run whose workspace *has* a platform passes it,
   * and `main` exits 2 when it cannot find one.
   */
  readonly host?: HostPackage | null;
  /**
   * The platform's own source root, repo-relative — so a module whose sources
   * live **inside** the host package is not judged for reaching it (feature
   * 080, D-160.11).
   *
   * `_lifecycle` merged into `@endora-commerce/platform`, and its files go on
   * naming `../../kernel/lifecycle/registry-cache.js` exactly as they did in
   * `backend/src/lifecycle/`. The specifier is unchanged and its meaning is
   * not: it is now a reach from one directory of a package into another
   * directory of the *same* package, which crosses no boundary and which no
   * `exports` map is asked about. This check's whole subject is the reach a
   * packaged module could not write — D-160.8, and the reason the sixteen
   * `LIFECYCLE_HOST_HALF` entries said they would *"retire with the merge, not
   * by editing the import"*. Judging them here would publish twelve kernel and
   * `http` symbols for one consumer forever, which is what D-160.11 refused.
   *
   * It exempts the **reaches**, never the file: the walk still opens it, still
   * counts it in `read: files=`, and still reports it as `unattributed-source`
   * if no module owns it — so a module file inside the platform that stopped
   * resolving to its id is a finding rather than a silence (#215 one layer in).
   * Every other file in the platform is outside this check's population
   * already, for the same reason: none of them is a module's.
   *
   * `null` — the default — is "this workspace has no platform", which is true
   * of every fixture and of nothing else; `main` exits 2 before it gets here.
   */
  readonly platformSourceRoot?: string | null;
}

/** One module package's answer to "does your manifest declare the host?". */
export interface ModulePackageDeclaration {
  readonly moduleId: string;
  /** True when its `dependencies` or `peerDependencies` name the host package. */
  readonly dependsOnHost: boolean;
}

/**
 * The floor that follows the sweep: every module package whose manifest
 * declares the host must have contributed a host reach to this walk.
 *
 * This is issue #215's predicate over the population T060 restored, and it is
 * the one derivation that would have caught the defect. The other two cannot:
 * `manifest-index` counts modules that produced a **file**, and a packaged
 * module produces plenty; `platform-barrels` counts barrels, which the move
 * does not touch. What fell was the *reaches*, and the number that recorded
 * them was a snapshot in `test/helpers/check-read-sizes.ts` whose −10% floor
 * absorbed one module's worth of the fall without a word.
 *
 * The declaration is a second author's, which is what makes it worth
 * reconciling against: `manifests:generate` renders a module package's
 * `peerDependencies` from the bare specifiers its sources import, and
 * `manifests:check` fails on drift. So "the manifest says this package reaches
 * the host" and "the walk read a reach from this package" are two derivations
 * of one fact, and a walk that stopped reading bare specifiers makes them
 * disagree in the same run.
 *
 * `null` rather than `expected: 0` for a tree with no module package that
 * declares the host — every tree in this repository until !910, and every
 * fixture workspace. An expectation of zero is itself a refusal in this
 * grammar, and rightly: a floor that expects nothing is switched off.
 */
export function hostDependentCoverage(
  packages: readonly ModulePackageDeclaration[],
  hostReachModules: ReadonlySet<string>,
): ReadCoverage | null {
  const declaring = packages.filter((pkg) => pkg.dependsOnHost);
  if (declaring.length === 0) return null;
  return {
    source: 'host-dependents',
    expected: declaring.length,
    covered: declaring.filter((pkg) => hostReachModules.has(pkg.moduleId)).length,
  };
}

/** `<module file>|<platform file>` — the ledger key and the identity of a reach. */
export function keyOf(finding: PlatformSurfaceFinding): string {
  return `${finding.file}|${finding.target}`;
}

/** The file a specifier names, or `null` when the walk found no such file. */
/**
 * A specifier's target file, or `null`. Exported because both hosts build the
 * platform's published surface with it and a second resolver would be a second
 * answer to "which file does this name".
 */
export function resolveTarget(
  fromKey: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  const joined = resolveRelative(fromKey, specifier);
  if (joined === null) return null;
  for (const candidate of resolutionCandidates(joined)) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

export interface PlatformSurfaceScan {
  /** Every (specifier, symbol) reach into the platform the walk judged. */
  readonly reaches: number;
  readonly findings: readonly PlatformSurfaceFinding[];
  /**
   * Modules that named the host package by its **bare** specifier at least once
   * — published subpath or not.
   *
   * The numerator of {@link hostDependentCoverage}. A reach at a subpath the
   * host does not publish counts here: the question is whether the walk *read*
   * the package's host specifiers, and a finding is the loudest possible yes.
   */
  readonly hostReachModules: ReadonlySet<string>;
}

/**
 * Every module reach into the platform, judged against the published surface.
 *
 * Pure over source text, file keys and barrel-derived surface, so a fixture
 * enters exactly where a run does — including the specifier extraction and the
 * `.js` → `.ts` resolution, which is where a resolution bug would hide (issue
 * #130).
 */
export function scanPlatformSurface(input: PlatformSurfaceInput): PlatformSurfaceScan {
  const attribute = input.moduleIdOf ?? moduleIdOf;
  const canonical = input.canonicalTargetOf ?? ((key: string): string => key);
  const host = input.host ?? null;
  const platformSourceRoot = input.platformSourceRoot ?? null;
  const withinPlatform = (key: string): boolean =>
    platformSourceRoot !== null &&
    (key === platformSourceRoot || key.startsWith(`${platformSourceRoot}/`));
  const findings: PlatformSurfaceFinding[] = [];
  const hostReachModules = new Set<string>();
  let reaches = 0;

  for (const [file, text] of [...input.sources].sort(([a], [b]) => a.localeCompare(b))) {
    const moduleId = attribute(file);
    if (moduleId === null) {
      // A file the walk opened and could not attribute. Skipping it would leave
      // it counted in `read: files=` and judged by nothing, which is #215 one
      // layer in (!879).
      findings.push({
        kind: 'unattributed-source',
        file,
        line: 1,
        moduleId: null,
        target: NO_MODULE,
        symbol: NO_SYMBOL,
        specifier: '',
      });
      continue;
    }
    // Attributed, and then exempt: a module inside the host package reaches the
    // platform by relative path within one package — see `platformSourceRoot`.
    if (withinPlatform(file)) continue;

    for (const specifier of namedSpecifiers(text, file)) {
      // A bare specifier into the host package is the same reach a module in
      // the application tree writes relatively (feature 080, T060). Asked
      // first, because a specifier that names the host is never a relative one
      // and the two answers must not both be consulted.
      const hostReach = resolveHostSpecifier(specifier.text, host);
      if (hostReach !== null) hostReachModules.add(moduleId);
      if (hostReach?.kind === 'undeclared-subpath' || hostReach?.kind === 'host-internal-subpath') {
        findings.push({
          // The two are one branch and two verdicts on purpose: both are about
          // the *subpath* rather than a symbol, and only one of them names a
          // path the host's `exports` map resolves.
          kind:
            hostReach.kind === 'undeclared-subpath'
              ? 'unpublished-subpath'
              : 'host-internal-subpath',
          file,
          line: specifier.line,
          moduleId,
          target: specifier.text,
          symbol: NO_SYMBOL,
          specifier: specifier.text,
        });
        continue;
      }
      // Someone else's package: `zod`, `@mikro-orm/core`, another module's.
      if (hostReach === null && !specifier.text.startsWith('.')) continue;
      const resolved =
        hostReach === null ? resolveTarget(file, specifier.text, input.files) : hostReach.target;
      const target = resolved === null ? null : canonical(resolved);
      if (target === null) {
        findings.push({
          kind: 'unresolvable-reach',
          file,
          line: specifier.line,
          moduleId,
          target: specifier.text,
          symbol: NO_SYMBOL,
          specifier: specifier.text,
        });
        continue;
      }
      // Module → module is `check:module-boundary`'s rule, not this one's.
      if (attribute(target) !== null) continue;

      const named = specifier.bindings.filter((binding) => !binding.startsWith('* as'));
      const wholeFile = specifier.bindings.length === 0 || named.length < specifier.bindings.length;

      if (wholeFile) {
        reaches += 1;
        // Reaching a barrel *is* reaching the published surface, whole or not.
        if (!input.surface.barrels.has(target)) {
          findings.push({
            kind: 'whole-file-reach',
            file,
            line: specifier.line,
            moduleId,
            target,
            symbol: WHOLE_FILE,
            specifier: specifier.text,
          });
        }
      }

      const published = input.surface.published.get(target) ?? new Set<string>();
      for (const name of named) {
        reaches += 1;
        if (input.surface.barrels.has(target)) continue;
        if (published.has(name)) continue;
        findings.push({
          kind: 'unpublished-symbol',
          file,
          line: specifier.line,
          moduleId,
          target,
          symbol: name,
          specifier: specifier.text,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.file === b.file
      ? a.target === b.target
        ? a.symbol.localeCompare(b.symbol)
        : a.target.localeCompare(b.target)
      : a.file.localeCompare(b.file),
  );
  return { reaches, findings, hostReachModules };
}

export interface CheckResult {
  /** (specifier, symbol) reaches into the platform judged — the `sites=` number. */
  readonly reaches: number;
  readonly findings: readonly PlatformSurfaceFinding[];
  readonly violations: readonly PlatformSurfaceFinding[];
  readonly ledgered: readonly PlatformSurfaceFinding[];
  /** Ledger keys that describe no reach at all. */
  readonly staleKeys: readonly string[];
  /** `<key>#<symbol>` an entry names and the walk no longer sees. */
  readonly staleSymbols: readonly string[];
  /** Barrels the parse could not read in full — a caller exits 2 on any. */
  readonly unreadable: readonly BarrelUnreadable[];
  /** Modules that named the host package's own specifier — see the scan. */
  readonly hostReachModules: ReadonlySet<string>;
}

export function checkPlatformSurface(
  input: PlatformSurfaceInput,
  ledger: Readonly<Record<string, LedgeredReach>>,
): CheckResult {
  const scan = scanPlatformSurface(input);
  const seen = new Map<string, Set<string>>();
  for (const finding of scan.findings) {
    const symbols = seen.get(keyOf(finding)) ?? new Set<string>();
    symbols.add(finding.symbol);
    seen.set(keyOf(finding), symbols);
  }

  const covers = (finding: PlatformSurfaceFinding): boolean =>
    ledger[keyOf(finding)]?.symbols.includes(finding.symbol) === true;

  const staleKeys: string[] = [];
  const staleSymbols: string[] = [];
  for (const [key, entry] of Object.entries(ledger)) {
    const symbols = seen.get(key);
    if (symbols === undefined) {
      staleKeys.push(key);
      continue;
    }
    for (const symbol of entry.symbols) {
      if (!symbols.has(symbol)) staleSymbols.push(`${key}#${symbol}`);
    }
  }

  return {
    reaches: scan.reaches,
    findings: scan.findings,
    violations: scan.findings.filter((finding) => !covers(finding)),
    ledgered: scan.findings.filter(covers),
    staleKeys: staleKeys.sort(),
    staleSymbols: staleSymbols.sort(),
    unreadable: input.surface.unreadable,
    hostReachModules: scan.hostReachModules,
  };
}


/* ------------------------------------------------ the application's reaches */

/**
 * One ledgered application reach into the platform by relative path.
 *
 * Keyed `<application file>|<canonical platform file>` — the *canonical* file
 * and never the specifier, which is the one way this repair could regress in
 * silence: re-spelling `../../packages/platform/dist/x.js` as
 * `../../packages/platform/src/x.ts` is the same reach and must not clear an
 * entry (host-reach-check.md §4).
 *
 * `retiredBy` is a field rather than a sentence inside {@link
 * LedgeredHostReach.reason} because R4.1 requires every entry to name the phase
 * that retires it, and a requirement carried only by prose is one an author can
 * satisfy by writing anything. The companion test holds both to being non-empty.
 *
 * **No `permanent` member, deliberately** (R4.2/R4.5). Every entry has an
 * available remedy — a subpath the map already declares, or one this feature
 * adds — so an entry saying "this reach is correct" would mean the predicate has
 * outgrown its population. Narrow the predicate; never add the entry.
 */
export interface LedgeredHostReach {
  /** Why it stands. */
  readonly reason: string;
  /** The phase or feature that retires it. */
  readonly retiredBy: string;
}

/**
 * The application's own reaches into the platform, and what they resolve to.
 *
 * A second **consumer population** on this check's own rule — *a reach into the
 * host names a published subpath or a declared host-internal one, never a file
 * inside the package by relative path* — and not a second rule
 * (host-reach-check.md §1.1). The four inputs it needs are the four this check
 * already derives: where the platform's sources are, the name it publishes
 * under, the subpaths its `exports` map declares, and the barrels. A separate
 * script would re-derive all four, which is two answers to one population
 * (D-100).
 */
export interface ApplicationReachInput {
  /**
   * The application's own sources, keyed relative to the repository root: every
   * file the layout attributes to no module and that is not inside the platform.
   *
   * Module-attributed files stay in {@link PlatformSurfaceInput.sources} and are
   * judged by the existing rules; nothing about a module reach changes.
   */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * The platform member's own directory, repo-relative — `packages/platform`,
   * the directory holding its `package.json`.
   *
   * The target side is *anything inside the member*, which is both spellings at
   * once: `src/**` is what a well-meaning cleanup would write and `dist/**` is
   * what the tree writes today. Neither directory name appears in this analysis
   * — see {@link canonicalPlatformFile}.
   */
  readonly platformMemberRoot: string;
  /** The platform's source root, repo-relative — `packages/platform/src`. */
  readonly platformSourceRoot: string;
  /** Every source-file key the walk found, for the `.js` → `.ts` resolution. */
  readonly files: ReadonlySet<string>;
  /** The published surface, so a remedy can name the subpath that carries a file. */
  readonly surface: PlatformSurface;
  /** The host package — its `exports` map is what turns a barrel into a subpath. */
  readonly host: HostPackage;
}

/**
 * The platform **source** file a specifier landing inside the member names, or
 * `null`.
 *
 * The canonicalisation drops the member-relative path's **first segment** —
 * whatever it is — and re-roots the remainder at the platform's source root. So
 * `dist/lifecycle/manifest.js` and `src/lifecycle/manifest.ts` both canonicalise
 * to `packages/platform/src/lifecycle/manifest.ts`, and the word `dist` appears
 * nowhere: a build directory renamed in the package's own `tsconfig.build.json`
 * arrives here by being renamed, not by anybody remembering this file (D-100).
 *
 * `null` for a specifier that lands inside the member and resolves to no source
 * file. That is deliberate and is the contract's own ruling (§3): a relative
 * specifier resolving to nothing inside the platform is not a host reach at all,
 * and reporting it here would be this check answering `tsc`'s question. The
 * risk it carries — a canonicalisation bug silently resolving everything to
 * `null` — is not silent: the ledger is two-way, so a walk that stopped
 * resolving reports every entry it holds as stale and exits 1.
 */
export function canonicalPlatformFile(
  joined: string,
  input: Pick<ApplicationReachInput, 'platformMemberRoot' | 'platformSourceRoot' | 'files'>,
): string | null {
  const prefix = `${input.platformMemberRoot}/`;
  if (!joined.startsWith(prefix)) return null;
  const withinMember = joined.slice(prefix.length);
  const cut = withinMember.indexOf('/');
  if (cut <= 0) return null;
  const rest = withinMember.slice(cut + 1);
  if (rest.length === 0) return null;
  for (const candidate of resolutionCandidates(`${input.platformSourceRoot}/${rest}`)) {
    if (input.files.has(candidate)) return candidate;
  }
  return null;
}

/** The bare specifier carrying a platform file, or `null` when none does. */
function publishedSpecifierFor(target: string, input: ApplicationReachInput): string | null {
  const carriers = input.surface.publishedBy.get(target) ?? new Set<string>();
  for (const [subpath, barrel] of input.host.subpathTargets) {
    // Reaching a barrel *is* reaching its subpath, whole or not.
    if (barrel === target || carriers.has(barrel)) return `${input.host.name}/${subpath}`;
  }
  return null;
}

/** What the application-reach walk read, beside what it found. */
export interface ApplicationReachScan {
  /** Relative reaches into the platform judged — this half's `sites=` addend. */
  readonly reaches: number;
  readonly findings: readonly PlatformSurfaceFinding[];
}

/**
 * Every application reach into the platform written as a relative path.
 *
 * Pure over source text, file keys, barrel-derived surface and the two platform
 * roots — so a fixture enters exactly where a run does, specifier extraction and
 * `.js` → `.ts` resolution included (issue #130, and the `check-entry-scope`
 * fixture that entered below its own classifier is the cautionary example).
 *
 * **A bare specifier into the host produces no finding here, and that is the
 * discrimination the rule turns on.** `@endora-commerce/platform/kernel` and
 * `@endora-commerce/platform/composition` are both correct from the application:
 * the first is published and the second is the host-internal address the host is
 * entitled to (D-160.14). The three-way answer for a bare specifier is a
 * *module's* — `resolveHostSpecifier` in {@link scanPlatformSurface} — and asking
 * it twice, with two populations and two verdicts, is two answers waiting to
 * disagree.
 */
export function scanApplicationReaches(input: ApplicationReachInput): ApplicationReachScan {
  const findings: PlatformSurfaceFinding[] = [];
  let reaches = 0;

  for (const [file, text] of [...input.sources].sort(([a], [b]) => a.localeCompare(b))) {
    for (const specifier of namedSpecifiers(text, file)) {
      if (!specifier.text.startsWith('.')) continue;
      const joined = resolveRelative(file, specifier.text);
      if (joined === null) continue;
      const target = canonicalPlatformFile(joined, input);
      if (target === null) continue;
      reaches += 1;
      findings.push({
        kind: 'relative-host-reach',
        file,
        line: specifier.line,
        moduleId: null,
        target,
        symbol: NO_SYMBOL,
        specifier: specifier.text,
        publishedAs: publishedSpecifierFor(target, input),
      });
    }
  }

  findings.sort((a, b) =>
    a.file === b.file ? a.target.localeCompare(b.target) : a.file.localeCompare(b.file),
  );
  return { reaches, findings };
}

export interface ApplicationReachResult extends ApplicationReachScan {
  readonly violations: readonly PlatformSurfaceFinding[];
  readonly ledgered: readonly PlatformSurfaceFinding[];
  /** Ledger keys that describe no reach the walk found. */
  readonly staleKeys: readonly string[];
}

/**
 * The application's reaches, judged against the ledger — both directions
 * (host-reach-check.md §4 R4.3).
 *
 * One reach may appear twice under one key when a file names the same platform
 * file from two specifiers; the ledger is keyed `(file, target)` and covers
 * both, which is right: the entry's subject is the coupling, not the line.
 */
export function checkApplicationReaches(
  input: ApplicationReachInput,
  ledger: Readonly<Record<string, LedgeredHostReach>>,
): ApplicationReachResult {
  const scan = scanApplicationReaches(input);
  const seen = new Set(scan.findings.map(keyOf));
  const covers = (finding: PlatformSurfaceFinding): boolean => ledger[keyOf(finding)] !== undefined;
  return {
    ...scan,
    violations: scan.findings.filter((finding) => !covers(finding)),
    ledgered: scan.findings.filter(covers),
    staleKeys: Object.keys(ledger)
      .filter((key) => !seen.has(key))
      .sort(),
  };
}

/**
 * The coverage floor for the application half: the ledger's own still-on-disk
 * file set, against what the walk opened of it.
 *
 * host-reach-check.md §5's fourth refusal, and it is `check:module-boundary`'s
 * admin-host floor one package over — a floor derived from *the ledger* rather
 * than from a count, so a walk that stopped reaching the files it is ledgered
 * over is a refusal rather than a drained ledger. The ledger is a second
 * author's answer to "which application files reach the platform": it was
 * written by whoever measured the debt, and it goes stale loudly rather than
 * quietly.
 *
 * `null` rather than `expected: 0` once the ledger empties, which is what this
 * ledger is for: an expectation of zero is itself a refusal in this grammar
 * (`readSizeRefusal`'s `no-expectation`), and rightly — a floor that expects
 * nothing is switched off.
 */
export function hostReachCoverage(
  ledger: Readonly<Record<string, LedgeredHostReach>>,
  onDisk: (file: string) => boolean,
  opened: ReadonlySet<string>,
): ReadCoverage | null {
  const ledgeredFiles = new Set(Object.keys(ledger).map((key) => key.split('|')[0] ?? ''));
  const expected = [...ledgeredFiles].filter((file) => onDisk(file));
  if (expected.length === 0) return null;
  return {
    source: 'host-reaches',
    expected: expected.length,
    covered: expected.filter((file) => opened.has(file)).length,
  };
}

/**
 * Why this run may not report on the application's reaches, or `null`.
 *
 * Two of host-reach-check.md §5's four refusals — the two that are facts about
 * *this* half's inputs. The first ("no platform root") is already this check's
 * own first refusal and stays there; the fourth is the ledger-derived coverage
 * floor and belongs to `read-size.ts`, which is the one place in the estate that
 * owns a short walk.
 *
 * Both fail in the direction that produces a **clean** result, which is why they
 * are exit 2 and not a finding. An empty canonical-target map reports every
 * relative reach as reaching nothing; an application walk that opened no file
 * reports no reach at all — and this check's module half would go on printing
 * `files=2069` beside it, because 1364 of `backend/src`'s files are a module's
 * and a broken *application* walk leaves every one of those numbers healthy
 * (issue #215's shape over this population).
 */
export function applicationReachRefusal(input: {
  readonly canonicalTargets: number;
  readonly applicationFiles: number;
}): string | null {
  if (input.canonicalTargets === 0) {
    return (
      'the platform walk produced no source file — a relative reach into the platform is ' +
      'canonicalised against that walk, so every one of them would resolve to nothing and ' +
      'the application half would report clean over a population it never saw'
    );
  }
  if (input.applicationFiles === 0) {
    return (
      'the application walk opened no file — the module half of this check reads most of ' +
      "`backend/src` and would keep printing a healthy `files=`, so a broken application " +
      'walk is a silence rather than a number that moved (issue #215)'
    );
  }
  return null;
}

/**
 * Why this run may not judge a reach against the surface it read, or `null`.
 *
 * Pure over the two things that can be silently missing — a barrel that is not
 * there, and a re-export the parse cannot enumerate — because both fail in the
 * same direction and it is the wrong one: a **short** published set turns
 * correct reaches into findings, and the obvious repair for one of those is to
 * widen the barrel. So it is exit 2, in the idiom of `readSizeRefusal`, and a
 * proof enters where a run enters (issue #130).
 */
export function platformSurfaceRefusal(input: {
  readonly missingBarrels: readonly string[];
  readonly surface: PlatformSurface;
}): string | null {
  if (input.missingBarrels.length > 0) {
    return (
      `${input.missingBarrels.join(', ')} — a published subpath (D-160.7) whose barrel is ` +
      'not there. The published surface would come back short and every reach into that ' +
      'directory would read as a violation; refusing to report on it'
    );
  }
  if (input.surface.unreadable.length > 0) {
    const named = input.surface.unreadable
      .map((entry) => `\n  - ${entry.barrel}:${entry.line}  ${entry.reason}`)
      .join('');
    return (
      'a published barrel holds a re-export this parse cannot enumerate, so the published ' +
      'surface would come back short — and the obvious "repair" for a reach it wrongly ' +
      `refused is to widen the barrel:${named}`
    );
  }
  return null;
}

/**
 * Every TypeScript source under `dir`, with the rule's own prunes applied.
 *
 * Exported because the population is part of the rule: two hosts computing
 * "which files this check reads" two ways is the shape that lets one of them go
 * half-blind.
 */
export function collectPlatformSurfaceSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectPlatformSurfaceSources(full, out);
    } else if (
      // `.tsx` since feature 091: a module package's `./admin` layer is React
      // components, and a walk that cannot see them reports every relative
      // reach into one as `unresolvable-reach` — a finding about the walk.
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test.tsx') &&
      !name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A module package's own tooling configuration, which is not module source.
 *
 * `vitest.config.ts` is the first `.ts` file a module package holds that its
 * build does not compile (feature 089, Phase 1): `tsconfig.build.json` roots the
 * emit at `src/`, and the manifest's `files` ships `dist` and the asset
 * directories, so nothing a consumer installs contains it and no `exports`
 * subpath can name it. The other configurations a package carries are `.json`
 * and were therefore never in this walk at all.
 *
 * It has to leave the population rather than be made to resolve, because the
 * file exists to `mergeConfig` the repository root's `vitest.config.base.ts` —
 * which is where issue #255's foreign-workspace-link refusal lives, so the reach
 * is mandatory — and that root is in no module walk root and no source root. A
 * reach the walk cannot resolve is `unresolvable-reach`, deliberately fail-closed
 * (#215 one layer in), and the honest answer here is that this file is not a
 * module reach at all.
 *
 * Narrow on purpose: only a `*.config.ts` sitting **directly** at a module walk
 * root, which is a package's own root or a module directory. A `config.ts` under
 * `src/` stays module source, and a directory named `config/` is untouched.
 */
export function isPackageToolingConfig(root: string, file: string): boolean {
  const within = relative(root, file).split('\\').join('/');
  return !within.includes('/') && within.endsWith('.config.ts');
}

/** The remedy sentence a finding gets, by kind. */
/**
 * The remedy paragraph for a finding.
 *
 * Exported because the remedy is part of the rule and not part of a host: an
 * author outside this checkout reads the same sentence this repository's run
 * prints.
 */
export function remedyOf(finding: PlatformSurfaceFinding): string {
  switch (finding.kind) {
    case 'unpublished-symbol':
      return `\`${finding.symbol}\` is not published out of ${finding.target}`;
    case 'whole-file-reach':
      return `reaches every export of ${finding.target}, internals included`;
    case 'unresolvable-reach':
      return `\`${finding.specifier}\` resolves to no file the walk found`;
    case 'unattributed-source':
      return 'the walk opened this file and no module owns it';
    case 'unpublished-subpath':
      return (
        `\`${finding.specifier}\` names no subpath the host publishes — its \`exports\` map ` +
        'refuses the path at resolution time'
      );
    case 'relative-host-reach':
      return (
        `\`${finding.specifier}\` names ${finding.target} by relative path. ` +
        (finding.publishedAs === null || finding.publishedAs === undefined
          ? 'the platform declares no subpath carrying this file — the remedy is to declare ' +
            'one (host-internal unless a module needs it) or to stop reaching it'
          : `the address is \`${finding.publishedAs}\``) +
        '. A relative path into the package resolves in this checkout and in no instance, ' +
        'which is what stops a build made of published packages from working'
      );
    case 'host-internal-subpath':
      return (
        `\`${finding.specifier}\` names a subpath the host declares for its own composition ` +
        'and publishes to nobody (host-package.md §2.7). It resolves, which is why this is ' +
        'the one finding here that neither `node` nor `tsc` would raise — and no module may ' +
        'name it, production source or test alike. A server-bound test composes through the ' +
        'test kit, never through `composeModules`'
      );
  }
}
