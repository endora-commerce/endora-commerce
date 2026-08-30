/**
 * Which of a module package's declared subpaths are **contract surface**
 * (D-171).
 *
 * **The rule, in one sentence:** a subpath is contract surface iff the module it
 * resolves to exports no runtime binding.
 *
 * T050 (!928) gave a module package a type-only `./ports` subpath so that a
 * published port interface has a home — `packages/contracts` is compiled by
 * `admin` and `storefront` and holds zero `@mikro-orm` imports on purpose, so an
 * `EntityManager`-taking signature cannot live there (D-169). What T050
 * correctly declined to take is the consequence: `check-module-boundary.ts` went
 * on counting `import type { X } from '@endora-commerce/mod-y/ports'` as a
 * cross-module reach, exactly as it counts `<pkg>/backend`. Publishing an
 * interface therefore gave it a supported name and did **not** retire the
 * consumer's ledger entry, which is precisely what D-169 says the conversion
 * removes.
 *
 * ## Why the designation is derived and not written down
 *
 * Two alternatives were measured and refused, and both are worth stating here
 * because each looks simpler than this file:
 *
 *  - **A named list of subpaths in the layout contract.** That is D-100 exactly:
 *    the contract says it and the check holds a copy, with neither reading the
 *    other. The copy goes stale in silence, and the silence is an exemption.
 *  - **A field in the package's own `endora` block.** That is a self-certified
 *    exemption from our own debt ledger, issued by the measured party. A module
 *    wanting its `./backend` reach to stop counting would simply add it.
 *    `endora.type` / `endora.id` answer *"what is this?"*, which the platform
 *    must ask a stranger; *"which of my subpaths are exempt from your
 *    bookkeeping?"* is not a question to hand one.
 *
 * So it is re-derived every run from the artefact, and it **fails closed**: put a
 * `const` on `./ports` and the exemption evaporates in the same run T050's guard
 * goes red. A later `./types` is exempt automatically and correctly; a
 * `./services` is not.
 *
 * Measured against the real set: `./ports` emits `export {};` → contract;
 * `./backend` exports `registerModule` and `entities` → reach; `./migrations`
 * exports `migrations` plus the named classes → reach; the package root exports
 * `manifest` → reach.
 *
 * ## What is a refusal and what is a reach
 *
 * The two failure directions are not symmetric and are deliberately answered
 * differently.
 *
 *  - A subpath the package **does not declare** — no `exports` map, no matching
 *    key, or a key this cannot resolve to a runtime target because the
 *    specifier's shape is outside the rule (a wildcard entry such as
 *    `"./i18n/*"`) — is a **reach**. So is a declared subpath whose target is
 *    not JavaScript at all (`"./package.json"`, which every module package
 *    ships): parsing JSON as a module finds no export and would call it contract
 *    surface, which is an exemption granted by a wrong reading. That is the
 *    fail-closed direction: the reach keeps counting as debt, which is what it
 *    did before this file existed.
 *  - A subpath whose **emitted module cannot be read** — the runtime target is
 *    declared and the file behind it is missing, unreadable, or the entry
 *    declares `types` and no runtime condition at all — is a **refusal**
 *    ({@link UnreadableSubpathError}), which the CLI turns into exit 2. A file
 *    the check cannot read must never become an exemption; that is issue #113's
 *    shape, and it is the one direction in which a silence would grant standing
 *    rather than withhold it.
 *
 * A package directory this cannot find a `package.json` in, or whose manifest
 * does not parse, is also a refusal: the directory came from the layout's own
 * derivation, so its absence is a broken derivation and not a statement about
 * the package.
 */
import { isAbsolute, join, normalize } from 'node:path';

import {
  nodeSourceReader,
  runtimeExportsOfEmittedModule,
  type SourceReader,
} from './emitted-exports.js';

/** What a subpath a module reached turned out to be. */
export interface SubpathSurface {
  /**
   * `contract` — the emitted module exports nothing, so the reach is a reach
   * into published contract surface and is not cross-module debt.
   * `runtime` — it exports at least one binding.
   * `undeclared` — the package declares no such subpath.
   * `not-a-module` — it declares one and the target is not JavaScript
   * (`"./package.json": "./package.json"`, which every module package ships).
   *
   * Only `contract` exempts a reach. The other three are fail-closed and differ
   * only so that a message can say which it was.
   */
  readonly kind: 'contract' | 'runtime' | 'undeclared' | 'not-a-module';
  /** The bindings the emitted module exports; empty for the other two kinds. */
  readonly runtimeExports: readonly string[];
}

/** A declared subpath whose emitted module could not be read (issue #113). */
export class UnreadableSubpathError extends Error {
  override readonly name = 'UnreadableSubpathError';
  readonly packageName: string;
  readonly subpath: string;

  constructor(packageName: string, subpath: string, detail: string) {
    super(
      `the module package '${packageName}' declares '${subpath === '' ? '.' : `./${subpath}`}' ` +
        `and its emitted module could not be read (${detail}). A subpath is contract surface ` +
        'iff the module it resolves to exports no runtime binding (D-171), and a file this ' +
        'check cannot read must never become an exemption — build the packages ' +
        '(`pnpm run build:packages`) or repair the `exports` entry',
    );
    this.packageName = packageName;
    this.subpath = subpath;
  }
}

/** Answers, per `(package name, subpath)`, whether the subpath is contract surface. */
export interface ModulePackageSurfaces {
  /**
   * The surface a subpath publishes.
   *
   * @throws {UnreadableSubpathError} when the subpath is declared and its
   *   emitted module cannot be read.
   */
  readonly surfaceOfSubpath: (packageName: string, subpath: string) => SubpathSurface;
  /** How many files the answers above have opened, for the `read:` line. */
  readonly filesRead: () => number;
}

/**
 * The default: every subpath is a reach.
 *
 * It is what a caller that supplies no package directories gets, and it is the
 * behaviour that shipped before D-171 — an exemption is granted only by a
 * measurement, never by the absence of one.
 */
export const EVERY_SUBPATH_IS_A_REACH: ModulePackageSurfaces = {
  surfaceOfSubpath: () => ({ kind: 'runtime', runtimeExports: [] }),
  filesRead: () => 0,
};

/** The conditions a runtime resolution may take, in the order Node takes them. */
const RUNTIME_CONDITIONS: readonly string[] = ['default', 'import', 'node', 'require'];

/**
 * The runtime target an `exports` value names, or `null` when it names none.
 *
 * `types` is skipped deliberately: a declaration file says what a consumer's
 * compiler sees and never what its bundler loads, and the whole predicate is
 * about the second. An entry that offers `types` and nothing else therefore
 * resolves to `null`, which the caller reports as unreadable rather than as
 * contract surface — that shape is the broken subpath D-169's own test names
 * (`ERR_PACKAGE_PATH_NOT_EXPORTED` for every consumer whose toolchain emits the
 * import), not a subpath that publishes nothing.
 */
function runtimeTargetOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const conditions = value as Record<string, unknown>;
  for (const condition of RUNTIME_CONDITIONS) {
    if (!Object.prototype.hasOwnProperty.call(conditions, condition)) continue;
    const resolved = runtimeTargetOf(conditions[condition]);
    if (resolved !== null) return resolved;
  }
  return null;
}

/**
 * The surfaces reader for a set of module packages.
 *
 * `directories` maps each package's npm name to its directory and `reader` is
 * how files are read, both parameters for the reason `readPortsSurface` takes
 * them: a fixture enters at the top of the analysis — a real `package.json` and
 * a real emitted module — rather than as a pre-classified record handed to the
 * last function in the chain (issue #130).
 */
export function modulePackageSurfaces(
  directories: ReadonlyMap<string, string>,
  reader: SourceReader = nodeSourceReader,
): ModulePackageSurfaces {
  const manifests = new Map<string, Record<string, unknown> | null>();
  const answers = new Map<string, SubpathSurface>();
  let filesRead = 0;

  const manifestOf = (packageName: string, directory: string): Record<string, unknown> | null => {
    const cached = manifests.get(packageName);
    if (cached !== undefined) return cached;
    const path = join(directory, 'package.json');
    let parsed: Record<string, unknown> | null = null;
    if (reader.exists(path)) {
      filesRead += 1;
      try {
        const value: unknown = JSON.parse(reader.read(path));
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
    }
    manifests.set(packageName, parsed);
    return parsed;
  };

  const surfaceOfSubpath = (packageName: string, subpath: string): SubpathSurface => {
    // The separator is spelled as an escape: a raw NUL makes git call the file
    // binary and every diff of it unreviewable (issue #190).
    const key = `${packageName}\0${subpath}`;
    const cached = answers.get(key);
    if (cached !== undefined) return cached;

    const answer = measure(packageName, subpath);
    answers.set(key, answer);
    return answer;
  };

  function measure(packageName: string, subpath: string): SubpathSurface {
    const directory = directories.get(packageName);
    // A package this reader was not given is one nobody asked it to measure;
    // the caller's own map decided that, so the fail-closed answer is a reach.
    if (directory === undefined) return { kind: 'undeclared', runtimeExports: [] };

    const manifest = manifestOf(packageName, directory);
    if (manifest === null) {
      throw new UnreadableSubpathError(
        packageName,
        subpath,
        `no readable package manifest at ${join(directory, 'package.json')}`,
      );
    }
    const exports = manifest.exports;
    if (exports === null || typeof exports !== 'object' || Array.isArray(exports)) {
      return { kind: 'undeclared', runtimeExports: [] };
    }
    const entries = exports as Record<string, unknown>;
    const declaredKey = subpath === '' ? '.' : `./${subpath}`;
    if (!Object.prototype.hasOwnProperty.call(entries, declaredKey)) {
      // Includes every wildcard entry (`"./i18n/*"`), which is outside the rule:
      // one key stands for a family of files with no single emitted module to
      // measure, so it stays a reach.
      return { kind: 'undeclared', runtimeExports: [] };
    }

    const target = runtimeTargetOf(entries[declaredKey]);
    if (target === null) {
      throw new UnreadableSubpathError(
        packageName,
        subpath,
        `its '${declaredKey}' entry declares no runtime condition, so there is no emitted ` +
          'module to measure',
      );
    }
    const resolved = isAbsolute(target) ? target : join(directory, normalize(target));
    // `"./package.json": "./package.json"` is a declared subpath of every module
    // package and is not an emitted module. Parsing it as one would find no
    // export and call it contract surface, which is an exemption granted by a
    // wrong reading rather than by a measurement.
    if (!/\.(js|mjs|cjs)$/.test(resolved)) return { kind: 'not-a-module', runtimeExports: [] };
    if (!reader.exists(resolved)) {
      throw new UnreadableSubpathError(packageName, subpath, `${resolved} does not exist`);
    }
    let runtimeExports: readonly string[];
    filesRead += 1;
    try {
      runtimeExports = runtimeExportsOfEmittedModule(resolved, reader);
    } catch (error) {
      throw new UnreadableSubpathError(
        packageName,
        subpath,
        `${resolved} could not be read (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    return runtimeExports.length === 0
      ? { kind: 'contract', runtimeExports: [] }
      : { kind: 'runtime', runtimeExports };
  }

  return { surfaceOfSubpath, filesRead: () => filesRead };
}
