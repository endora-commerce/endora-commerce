/**
 * The module set an instance installs — derived, closed, and refused before
 * anything is written (`contracts/instance-tree.md` §3).
 *
 * ## It is never a list
 *
 * §3.2: with no `--module` the command writes **the smallest set that
 * composes** — the modules declaring `activation.nonDeactivatable`, closed over
 * the manifests' `dependencies` **and their `acknowledgedDependencies`**, which
 * bind exactly as hard and which {@link ModuleCandidate.acknowledged} explains.
 * The number is derived on every run and appears in no source file (D-100):
 * un-locking a module changes the default in the same run, and nothing here has
 * to be edited for it.
 *
 * ## Where the manifests come from
 *
 * §3.4: from the packages the command **resolved** — a module package publishes
 * its manifest as its root export (`"." -> ./dist/manifest.js`), so the
 * declaration this reads is the one the platform will read when it composes
 * that same install. It is imported through the package's own `exports` map
 * rather than by a path into it, so a package that lays its build out
 * differently is followed rather than missed.
 *
 * ## The required predicate, and the one thing this file owes T134
 *
 * {@link requiredModuleIds} is the predicate `requiredModulesFrom` implements
 * in `@endora-commerce/platform/composition` — *a manifest whose `activation`
 * carries `nonDeactivatable`* — and it is written here rather than imported
 * because this package depends on `@endora-commerce/contracts` and not on the
 * platform. **That is a second copy of a derived fact and it is exactly what
 * T134 closes** (`tasks.md` Phase 4: *"using `requiredModulesFrom(manifests)`
 * and the platform's own message. Never a second list (D-100)"*). It is
 * confined to one four-line function, with the reason on it, so the replacement
 * is a deletion rather than a search.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  EnvironmentInputsSchema,
  unionEnvironmentInputs,
  type EnvironmentInput,
} from '@endora-commerce/contracts';

import { InstanceHostError, InstanceInputError, type ResolvedPackage } from './host.js';

/** One module package, as this command needs it. */
export interface ModuleCandidate {
  readonly id: string;
  readonly packageName: string;
  /**
   * The version **this package** declares about itself, and the source of the
   * `^` range the instance's manifest carries for it.
   *
   * It was read here and dropped on the way to the template, which had the
   * platform's version in scope and wrote that onto every module. That is
   * correct only while a release moves every package together, and a release
   * does not — see {@link PlannedModulePackage} in `template.ts`.
   */
  readonly version: string;
  /** The manifest's own `dependencies`, which the closure walks. */
  readonly dependencies: readonly string[];
  /**
   * The module ids of the manifest's `acknowledgedDependencies`, which the
   * closure walks **exactly as** `dependencies` — because the platform does.
   *
   * The two spellings differ in one thing only: `acknowledgedDependencies`
   * withdraws the *install ordering* a `dependencies` entry claims, for an edge
   * whose ordering would close a cycle. `carts` names `promotions` there for
   * that reason and no other, and its own manifest says the edge *"is a real
   * bind: a cart that cannot resolve its discount must not quote a figure it
   * cannot justify"*. `assertLockedModulesPresent` agrees and makes no
   * distinction: a module named in **either** array that the deployment does
   * not ship is `ReducedDeploymentError`, thrown out of `loadModulePresence`
   * before anything listens.
   *
   * So a set derived over `dependencies` alone is a set the platform refuses
   * to boot, and that is not a hypothesis — it is what the instance acceptance
   * criterion's A4 and A15 were, measured on 2026-09-14 with a registry
   * install's discovery shape: *"promotions — not shipped by this deployment,
   * and it is needed: carts — acknowledgedDependencies, port
   * `promotionService`"*. Both assertions are the same failure, because
   * `pnpm run start` and the instance's own `admin:create` both compose.
   *
   * **Why it was invisible until an instance installed from a registry.** The
   * criterion's `tarball` mode pins every auto-installed peer as a real
   * dependency of the instance — `mod-promotions` among them, because
   * `mod-carts` peer-depends on it — which puts it at the top level of
   * `node_modules`, where the platform's package discovery looks. A registry
   * install leaves it inside `.pnpm`, where that walk deliberately does not.
   * The tarball tree is therefore wider than any client's, and it was the only
   * tree this had ever been measured on.
   *
   * It stays a separate field rather than being folded into `dependencies` so
   * the ordering the manifest withdrew is still withdrawn here, and so the F2
   * refusal can keep naming the module that asked.
   */
  readonly acknowledged: readonly string[];
  /** `activation.nonDeactivatable` — the required predicate's subject. */
  readonly required: boolean;
  /** The manifest's `activation.reason`, which the refusal prints (§3.3). */
  readonly reason: string | undefined;
  /**
   * True when the **platform package itself** carries this module.
   *
   * `_lifecycle` is the one today (D-160.11: *"it is the one module the
   * packaging sweep does not turn into a package"*), and §3.2 counts it that
   * way — *"25 are packages and `_lifecycle` arrives with the platform"*. Such
   * a module is in the set and gets **no `dependencies` entry**: an instance
   * that named it would be asking a registry for a package nobody publishes.
   *
   * Derived, never a list: it is a module the platform's **own `exports` map**
   * publishes a manifest through, so a second host-carried module needs no edit
   * here and one that becomes a package stops being carried in the same run.
   */
  readonly carriedByHost: boolean;
  /**
   * The manifest's own `env` — what this module reads from the environment.
   *
   * Read here because this is the one place in the run where the **installed**
   * manifests are in hand, and a module's declaration reaches a client's
   * `.env.example` only through them (`specs/123-oss-install-experience/` T3-B).
   * A manifest whose `env` is not a declaration contributes nothing rather than
   * refusing the run: it is a published artefact of another version of the
   * platform, and this file already reads one loosely for that reason.
   */
  readonly env: readonly EnvironmentInput[];
}

/** What a resolution decided, before a single file is planned. */
export interface ModuleSetResolution {
  /** Every id in the set, sorted, so the manifest a run writes is reproducible. */
  readonly ids: readonly string[];
  /** The ids the operator asked for, before the closure. Empty for the default. */
  readonly requested: readonly string[];
  /** The ids the closure added on top of `requested` (or of the required set). */
  readonly closure: readonly string[];
  /** True when no `--module` was given and §3.2's default was written. */
  readonly defaulted: boolean;
  readonly candidates: ReadonlyMap<string, ModuleCandidate>;
}

/**
 * A manifest, as loosely as this file may read one.
 *
 * Deliberately structural rather than `ModuleManifest`: the manifest being read
 * is a **published artefact of another version of the platform**, and a run
 * that refused a manifest carrying a field this build has never heard of would
 * refuse every instance scaffolded against a newer platform.
 */
interface RawManifest {
  readonly id?: unknown;
  readonly dependencies?: unknown;
  readonly acknowledgedDependencies?: unknown;
  readonly activation?: unknown;
  readonly env?: unknown;
}

/**
 * The environment inputs a manifest declares, or none.
 *
 * Parsed rather than trusted, and a declaration this build cannot read is
 * **dropped rather than refused** — see {@link RawManifest}. The consequence of
 * dropping one is a name missing from a client's `.env.example`, which is the
 * defect this feature closes; the consequence of refusing would be an instance
 * that cannot be scaffolded at all because one installed package ships a field
 * shape from a newer platform. The second is worse, and `check:env-inputs`
 * refuses a malformed declaration in the tree that authored it, which is where
 * the finding belongs.
 */
function environmentInputsOf(value: unknown): readonly EnvironmentInput[] {
  if (!Array.isArray(value)) return [];
  const parsed = EnvironmentInputsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * The required set — the predicate `requiredModulesFrom` implements.
 *
 * See the file header: this is the one derived fact this file states a second
 * time, and T134 replaces it with the platform's own function.
 */
export function requiredModuleIds(
  candidates: ReadonlyMap<string, ModuleCandidate>,
): readonly string[] {
  return [...candidates.values()].filter((entry) => entry.required).map((entry) => entry.id);
}

/**
 * The file a package's **own `exports` map** publishes as its root export.
 *
 * Derived from the package's declaration rather than guessed at, for the reason
 * feature 080's T041a gives about specifiers: nothing in the tree spells
 * `dist/manifest.js`, and a package that lays its build out differently is
 * followed rather than missed. A package that publishes no root export is F7 —
 * its manifest is not reachable by name, which is how the platform will reach
 * it too.
 */
function conditionTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object') return undefined;
  const record = entry as Record<string, unknown>;
  const candidate = record['import'] ?? record['default'] ?? record['node'];
  return typeof candidate === 'string' ? candidate : undefined;
}

function rootEntryOf(pkg: ResolvedPackage): string {
  const exports = pkg.manifest['exports'];
  const root =
    typeof exports === 'string'
      ? exports
      : exports !== null && typeof exports === 'object'
        ? (exports as Record<string, unknown>)['.']
        : undefined;
  const target = conditionTarget(root) ?? conditionTarget(pkg.manifest['main']);
  if (target === undefined) {
    throw new InstanceHostError(
      'F7',
      `${pkg.name} publishes no root export, so its manifest — the \`dependencies\` the ` +
        `module set is closed over and the \`activation\` the required set is derived from — ` +
        `cannot be read by name. Nothing is written.`,
    );
  }
  return join(pkg.dir, target);
}

/**
 * Every JavaScript entry point a package's own `exports` map publishes.
 *
 * Used to ask the **host** which modules it carries: a subpath is a candidate
 * because the package declares it, never because a name was written here. A
 * wildcard subpath and a non-`.js` target (`./theme.css`, `./package.json`) are
 * outside the question by construction — neither can carry a manifest.
 */
function exportedEntriesOf(pkg: ResolvedPackage): readonly (readonly [string, string])[] {
  const exports = pkg.manifest['exports'];
  if (exports === null || typeof exports !== 'object') return [];
  const entries: (readonly [string, string])[] = [];
  for (const [subpath, entry] of Object.entries(exports as Record<string, unknown>)) {
    if (subpath.includes('*')) continue;
    const target = conditionTarget(entry);
    if (target === undefined || !target.endsWith('.js')) continue;
    entries.push([subpath, join(pkg.dir, target)]);
  }
  return entries;
}

/** What one pass over the host package's own entry points found. */
interface HostDeclarations {
  /** The modules the platform package itself carries, id to manifest. */
  readonly carried: readonly (readonly [string, RawManifest])[];
  /**
   * The platform's own environment-input declaration.
   *
   * Read off the **installed** platform rather than compiled into this command,
   * for R2.3's reason and for the reason every manifest here is read the same
   * way: the platform being installed is a published artefact of a version this
   * CLI may be older or newer than, and a list here could never see it. It is
   * found by the export it carries rather than by naming a subpath, which is
   * `exportedEntriesOf`'s own rule — a package that lays its build out
   * differently is followed rather than missed.
   *
   * Empty when the resolved platform publishes none. That is not a refusal: an
   * older platform declared nothing, and an instance scaffolded against one gets
   * an `.env.example` holding what that platform's modules declare, which is
   * what it actually reads.
   */
  readonly env: readonly EnvironmentInput[];
}

/**
 * What the **host package itself** declares, off its own `exports` map.
 *
 * See {@link ModuleCandidate.carriedByHost}. An entry point that will not
 * import is **F7** and never a skip: a host-carried module the run could not
 * see is a required module the set will then be missing, and the operator would
 * be sent to install a package that does not exist.
 *
 * One pass, two answers: every entry point is imported exactly once, and both
 * the carried manifests and the platform's environment declaration are taken
 * from it. Two loops would import the same modules twice.
 */
async function hostDeclarations(host: ResolvedPackage): Promise<HostDeclarations> {
  const carried: (readonly [string, RawManifest])[] = [];
  let env: readonly EnvironmentInput[] = [];
  for (const [subpath, file] of exportedEntriesOf(host)) {
    let loaded: { manifest?: unknown; PLATFORM_ENVIRONMENT_INPUTS?: unknown };
    try {
      loaded = (await import(pathToFileURL(file).href)) as {
        manifest?: unknown;
        PLATFORM_ENVIRONMENT_INPUTS?: unknown;
      };
    } catch (error: unknown) {
      throw new InstanceHostError(
        'F7',
        `${host.name}${subpath.slice(1)} could not be imported ` +
          `(${error instanceof Error ? error.message : String(error)}), so this run cannot say ` +
          `which modules the platform itself carries. One of them is required by every ` +
          `instance, so a run that guessed would write a module set the platform then refuses ` +
          `to compose. Nothing is written; rebuild the platform package and try again.`,
      );
    }
    const manifest = loaded.manifest as RawManifest | undefined;
    if (manifest !== undefined && typeof manifest.id === 'string' && manifest.id.length > 0) {
      carried.push([manifest.id, manifest]);
    }
    if (env.length === 0) env = environmentInputsOf(loaded.PLATFORM_ENVIRONMENT_INPUTS);
  }
  return { carried, env };
}

/** One candidate, from a manifest and the package it came out of. */
function candidateFrom(
  id: string,
  manifest: RawManifest,
  packageName: string,
  version: string,
  carriedByHost: boolean,
): ModuleCandidate {
  const activation = manifest.activation as
    | { readonly nonDeactivatable?: unknown; readonly reason?: unknown }
    | undefined;
  return {
    id,
    packageName,
    version,
    dependencies: Array.isArray(manifest.dependencies)
      ? manifest.dependencies.filter((entry): entry is string => typeof entry === 'string')
      : [],
    // Read as loosely as everything else here: this manifest is a published
    // artefact of another version of the platform, and an entry whose shape
    // this build cannot read is dropped rather than refused (see
    // {@link RawManifest}). One id per entry, de-duplicated, because `carts`
    // names `promotions` once per port.
    acknowledged: Array.isArray(manifest.acknowledgedDependencies)
      ? [
          ...new Set(
            manifest.acknowledgedDependencies
              .map((entry) =>
                typeof entry === 'object' && entry !== null
                  ? (entry as { readonly moduleId?: unknown }).moduleId
                  : undefined,
              )
              .filter((id): id is string => typeof id === 'string'),
          ),
        ]
      : [],
    env: environmentInputsOf(manifest.env),
    required:
      activation !== undefined &&
      typeof activation === 'object' &&
      'nonDeactivatable' in activation,
    reason: typeof activation?.reason === 'string' ? activation.reason : undefined,
    carriedByHost,
  };
}

/** What one resolution read off the packages installed beside the target. */
export interface LoadedCandidates {
  readonly candidates: ReadonlyMap<string, ModuleCandidate>;
  /**
   * The platform's own environment-input declaration, or empty.
   *
   * It comes back beside the candidates because it is read in the same pass
   * over the same entry points ({@link HostDeclarations}), and because the two
   * are the two halves of one answer: what a scaffolded instance reads from its
   * environment is the platform's declaration unioned with the manifests of the
   * modules it installed, and a caller holding one half without the other would
   * write a file that is short by the other.
   */
  readonly platformEnv: readonly EnvironmentInput[];
}

/**
 * Every module package this run resolved, with its own manifest read.
 *
 * A package whose manifest cannot be imported, or whose manifest declares no
 * `id`, is **F7** and never a skip: a module set short by however many
 * manifests failed to load is a manifest the client installs and a set the
 * platform then composes differently, with nothing in either tree to say so.
 */
export async function loadModuleCandidates(
  packages: ReadonlyMap<string, ResolvedPackage>,
  host?: ResolvedPackage | undefined,
): Promise<LoadedCandidates> {
  const candidates = new Map<string, ModuleCandidate>();
  for (const pkg of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (pkg.endora?.type !== 'module') continue;
    const declaredId = pkg.endora.id;
    if (typeof declaredId !== 'string' || declaredId.length === 0) {
      throw new InstanceHostError(
        'F7',
        `${pkg.name} declares \`endora.type: "module"\` and no \`endora.id\`, so this run ` +
          `cannot say which module it is. Nothing is written.`,
      );
    }
    // Resolved outside the `try` deliberately: its own F7 says the package
    // publishes no root export, which is a different finding from a root export
    // that failed to load, and a `catch` here would report the first as the
    // second.
    const entry = rootEntryOf(pkg);
    let manifest: RawManifest;
    try {
      const loaded = (await import(pathToFileURL(entry).href)) as {
        manifest?: unknown;
      };
      manifest = (loaded.manifest ?? {}) as RawManifest;
    } catch (error: unknown) {
      throw new InstanceHostError(
        'F7',
        `${pkg.name}'s manifest could not be read from ${pkg.dir} ` +
          `(${error instanceof Error ? error.message : String(error)}). Its \`dependencies\` ` +
          `are what the module set is closed over, so a run that skipped it would write a set ` +
          `that is short by whatever that module needs. Nothing is written; build or reinstall ` +
          `the package and try again.`,
      );
    }
    candidates.set(declaredId, candidateFrom(declaredId, manifest, pkg.name, pkg.version, false));
  }

  // The host's own, last: a package that has been extracted out of the platform
  // wins over the copy still inside it, which is the direction that follows a
  // module *leaving* the host rather than the one that pins it there.
  if (host === undefined) return { candidates, platformEnv: [] };
  const declarations = await hostDeclarations(host);
  for (const [id, manifest] of declarations.carried) {
    if (candidates.has(id)) continue;
    candidates.set(id, candidateFrom(id, manifest, host.name, host.version, true));
  }
  return { candidates, platformEnv: declarations.env };
}

/**
 * What a scaffolded instance reads from its environment — the whole population,
 * derived and never listed (`specs/123-oss-install-experience/` FR-010).
 *
 * The platform's declaration first, then each **installed** module's, in module
 * order, so a name that has migrated between the two carries the platform's
 * sentence (`unionEnvironmentInputs`). The set of modules is this run's, so a
 * different `--module` set is a different population with nothing here edited.
 */
export function instanceEnvironmentInputs(
  platformEnv: readonly EnvironmentInput[],
  modules: readonly ModuleCandidate[],
): readonly EnvironmentInput[] {
  return unionEnvironmentInputs([
    platformEnv,
    ...[...modules].sort((a, b) => a.id.localeCompare(b.id)).map((module) => module.env),
  ]);
}

/**
 * The set, closed and refused (§3.1, §3.2, §3.4).
 *
 * Pure over its two inputs, so its proofs enter at the top of the analysis
 * (issue #130) — a fixture supplies candidates and a request, never a
 * pre-computed set.
 */
export function resolveModuleSet(
  requested: readonly string[],
  candidates: ReadonlyMap<string, ModuleCandidate>,
): ModuleSetResolution {
  const asked = [...new Set(requested.map((entry) => entry.trim()).filter((e) => e.length > 0))];

  // F3 — an id no resolvable package declares. Named before the closure, so
  // the operator sees their own typo rather than a dependency that "cannot be
  // satisfied" three modules downstream.
  const unknown = asked.filter((id) => !candidates.has(id));
  if (unknown.length > 0) {
    throw new InstanceInputError(
      'F3',
      `\`--module\` names ${unknown.join(', ')}, which no package resolvable from here ` +
        `declares. This run resolved ${String(candidates.size)} module ` +
        `${candidates.size === 1 ? 'package' : 'packages'}; install the one you meant beside ` +
        `the target directory, or drop the name. Nothing is written.`,
    );
  }

  const defaulted = asked.length === 0;
  const seed = defaulted ? requiredModuleIds(candidates) : asked;
  if (seed.length === 0) {
    throw new InstanceInputError(
      'F2',
      `no module set could be derived: no \`--module\` was given and no resolvable package ` +
        `declares \`activation.nonDeactivatable\`, so there is no smallest set that composes ` +
        `to fall back to. Name the modules with \`--module <id>\` (repeatable, ` +
        `comma-splittable). Nothing is written.`,
    );
  }

  // The closure over the manifests' own `dependencies` **and**
  // `acknowledgedDependencies` — see {@link ModuleCandidate.acknowledged} for
  // why the two are one population here and for the boot this walk used to
  // write a set the platform refused. The F2 refusal for an edge nothing
  // satisfies is unchanged. Breadth-first so the refusal can name the module
  // that asked, which is the fact the operator can act on.
  const chosen = new Set<string>();
  const queue = [...seed];
  const unsatisfied: { readonly from: string; readonly to: string }[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (chosen.has(id)) continue;
    chosen.add(id);
    const candidate = candidates.get(id)!;
    for (const dependency of [...candidate.dependencies, ...candidate.acknowledged]) {
      if (chosen.has(dependency)) continue;
      if (!candidates.has(dependency)) {
        unsatisfied.push({ from: id, to: dependency });
        continue;
      }
      queue.push(dependency);
    }
  }

  // F2 — the required half, which is R5.6's and whose message T134 replaces
  // with the platform's own. It is asked after the closure because a required
  // module is very often already pulled in by one the operator named.
  const missingRequired = requiredModuleIds(candidates).filter((id) => !chosen.has(id));

  if (unsatisfied.length > 0 || missingRequired.length > 0) {
    const lines: string[] = [
      `the module set you asked for cannot compose, so nothing was written.`,
      '',
    ];
    for (const edge of unsatisfied) {
      lines.push(
        `  ${edge.from} declares a dependency on ${edge.to}, and no package resolvable from`,
        `      here declares that module.`,
        `      remedy: install it beside the target directory, or drop --module ${edge.from}.`,
        '',
      );
    }
    for (const id of missingRequired) {
      const candidate = candidates.get(id)!;
      lines.push(
        `  ${id} is missing, and the platform cannot run without it:`,
        `      ${candidate.reason ?? 'its manifest declares `activation.nonDeactivatable`.'}`,
        `      remedy: --module ${id}`,
        '',
      );
    }
    lines.push(
      'A module whose manifest declares `activation.nonDeactivatable` is required to be',
      'present, not merely un-switch-off-able. An instance written without one does not',
      'degrade: it exits, in the boot hook of whichever module happens to need it first.',
    );
    throw new InstanceInputError('F2', lines.join('\n'));
  }

  const ids = [...chosen].sort();
  const seeded = new Set(seed);
  return {
    ids,
    requested: defaulted ? [] : asked,
    closure: ids.filter((id) => !seeded.has(id)),
    defaulted,
    candidates,
  };
}
