/**
 * The escape hatch's resolution half (feature 113, T235 —
 * `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §6).
 *
 * A module that would ship more demo data than the budget allows moves it into
 * a package of its own and names that package in `demo.package`. This file is
 * how the runner finds it, and it exists as a file of its own so that §6.4's
 * two steps are two functions:
 *
 * > **§6.4** The runner MUST probe resolvability before importing, and MUST NOT
 * > distinguish the two states by catching the import's throw.
 *
 * A single `try { await import(name) } catch { … }` that reads the throw as
 * *not installed* answers both questions with one signal, so a demo package
 * that is installed and **broken** reads as absent and the run continues
 * quietly without it. That is
 * the fail-open shape `check:port-catches` refuses one seam over, and it is the
 * reason {@link DemoPackageResolver} has two methods rather than one.
 *
 * ## Why the name is not an `import` specifier, measured
 *
 * §6.2, and it is the whole reason this resolution is the runner's rather than
 * the module's. A module package's `package.json` is generated
 * (`backend/scripts/lib/module-package-manifest.ts`), and `peerNamesOf` records
 * every specifier `namedSpecifiers` yields **with no filter on kind** — a walk
 * that recognises `dynamic-import`. So a literal
 * `await import('@endora-commerce/mod-<id>-demo')` written anywhere in the
 * module's own sources is emitted as a **required** peer, and pnpm then installs
 * the demo package for every client, which is the opposite of what the field is
 * for. Both halves re-verified against those two files on 2026-09-09.
 *
 * The consequence is worth stating because it decides the shape below: since
 * the module may not import the package, the module's own body cannot *use* it
 * either. So the package supplies the demo body, and the declaration's own
 * `seed` / `reset` are not called when it loads — §6.3's first row in its own
 * words, *"the module's demo data is the package's"*.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { ModuleDemoManifest } from '@endora-commerce/contracts';

/**
 * How the runner finds a module's demo package, in two steps (§6.4).
 *
 * Injected rather than reached for, so the three answers §6.3 requires are
 * assertable with no package on disk — the same reason `isPresent` and
 * `contextFor` are parameters.
 */
export interface DemoPackageResolver {
  /**
   * Is this package installed?
   *
   * Answered by resolution alone: it must not evaluate the package, because a
   * package that throws on evaluation is §6.3's **third** answer and not its
   * second.
   */
  isInstalled(name: string): boolean;
  /**
   * Load it.
   *
   * A throw here is a failure and is reported as one (§3.8). Nothing may catch
   * it and report the package as absent.
   */
  load(name: string): Promise<unknown>;
}

/**
 * The default resolver: Node's own resolution, from the instance's root.
 *
 * `from` is the directory whose `node_modules` the package is installed into —
 * the **instance's**, not the platform's. A bare `import(name)` inside this
 * package would resolve against `@endora-commerce/platform`'s own dependencies,
 * where a client's demo package is not and must not be; a host that runs from
 * somewhere other than the instance root passes its own `from`.
 *
 * The probe is `require.resolve`, which answers without evaluating, and the
 * load is a real ESM `import()` of the path it returned. The bound is stated
 * rather than discovered: for a **dual** CJS/ESM package `require.resolve`
 * takes the `require` condition, so the file imported would be the CommonJS
 * one. Every package this repository generates declares a single `default`
 * condition per subpath, so the two coincide — measured over every module
 * package's own manifest in this repository.
 */
export function createDemoPackageResolver(from: string = process.cwd()): DemoPackageResolver {
  const require = createRequire(pathToFileURL(`${from}/package.json`));
  return {
    isInstalled(name) {
      // The one `catch` in this file, and it is not a classification: a
      // resolution failure *is* the answer to "is this installed", and nothing
      // about evaluation has happened yet. §6.3's third answer is decided by
      // `load` throwing, one method down, where nothing catches it.
      try {
        require.resolve(name);
        return true;
      } catch {
        return false;
      }
    },
    async load(name) {
      return await import(pathToFileURL(require.resolve(name)).href);
    },
  };
}

/**
 * A demo package that loaded but does not carry a demo body.
 *
 * Its own error rather than a `TypeError` from the first call, because the two
 * are indistinguishable to an operator and only one of them names the field to
 * fix. It reaches the report as {@link DemoRunFailedError}'s `cause`, so §3.8's
 * *"naming the module"* holds for it exactly as for a body that threw.
 */
export class DemoPackageShapeError extends Error {
  constructor(
    readonly moduleId: string,
    readonly packageName: string,
    detail: string,
  ) {
    super(
      `[demo] module '${moduleId}' names '${packageName}' in \`demo.package\`, and that ` +
        `package ${detail}. A demo package exports \`demo\`: an object with a \`summary\` ` +
        'string and \`seed\` and \`reset\` functions, the same shape a module declares in ' +
        'its own `manifest.ts`.',
    );
    this.name = 'DemoPackageShapeError';
  }
}

/**
 * The demo body a loaded package supplies, or a refusal naming what is wrong.
 *
 * **`after` is deliberately not read from here.** Ordering is decided by
 * `planDemoRun` from the *declarations*, before anything is loaded — that is
 * the property that makes the plan decidable with no database and no module
 * system — so a package's own `after` would arrive after the sequence it wants
 * to change. The module's manifest keeps that field, as it keeps `package`.
 */
export function demoBodyFromPackage(
  loaded: unknown,
  moduleId: string,
  packageName: string,
): ModuleDemoManifest<never> {
  if (typeof loaded !== 'object' || loaded === null || !('demo' in loaded)) {
    return refuse(moduleId, packageName, 'exports no `demo`');
  }
  const demo = (loaded as { demo: unknown }).demo;
  if (typeof demo !== 'object' || demo === null) {
    return refuse(moduleId, packageName, 'exports a `demo` that is not an object');
  }
  const candidate = demo as Partial<ModuleDemoManifest<never>>;
  if (typeof candidate.summary !== 'string' || candidate.summary.length === 0) {
    return refuse(moduleId, packageName, 'exports a `demo` with no `summary`');
  }
  if (typeof candidate.seed !== 'function' || typeof candidate.reset !== 'function') {
    return refuse(
      moduleId,
      packageName,
      'exports a `demo` whose `seed` or `reset` is not a function',
    );
  }
  return {
    summary: candidate.summary,
    seed: candidate.seed,
    reset: candidate.reset,
  };
}

function refuse(moduleId: string, packageName: string, detail: string): never {
  throw new DemoPackageShapeError(moduleId, packageName, detail);
}
