import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * An overlay module is flat under `modules/` and is not a package
 * (`specs/190-overlay-full-modules/` FR-002 – FR-003, contract
 * `overlay-module-layout.md` §1, #1848).
 *
 * **Flat.** A directory is a module iff it is a direct child of `modules/`.
 * A manifest anywhere deeper is a module none of the lifecycle, the migration
 * order or the activation axis would see — they see directories under
 * `modules/` and the dependencies their manifests declare — so it is refused as
 * `nested-module`, with the remedy: a sibling module and a declared dependency.
 *
 * **Not a package.** A `package.json`, a `tsconfig*.json` or a bundler or test
 * configuration inside a module would make it a package in everything but
 * name: its own build, its own `exports`, outside the one project the overlay
 * build compiles (`backend/tsconfig.apps.json`). Refused as
 * `package-in-disguise`. A module that wants to be a package is promoted to one
 * (`overlay-module-layout.md` §5).
 *
 * `node_modules` and `dist` are not walked: neither is a module's own source.
 */

export interface OverlayLayoutFinding {
  readonly kind: 'nested-module' | 'package-in-disguise';
  /** The offending file, absolute. */
  readonly file: string;
}

export class OverlayLayoutError extends Error {
  override readonly name = 'OverlayLayoutError';
  readonly findings: readonly OverlayLayoutFinding[];

  constructor(root: string, findings: readonly OverlayLayoutFinding[]) {
    const lines = findings.map((finding) => `  - [${finding.kind}] ${finding.file}`);
    const remedies: string[] = [];
    if (findings.some((finding) => finding.kind === 'nested-module')) {
      remedies.push(
        '`nested-module`: an overlay module is a direct child of `modules/` and is identified by ' +
          'its own `manifest.ts`; a manifest deeper down is a module nothing composes — make it a ' +
          'sibling module and declare the dependency in its manifest.',
      );
    }
    if (findings.some((finding) => finding.kind === 'package-in-disguise')) {
      remedies.push(
        '`package-in-disguise`: an overlay module has no build or package configuration of its ' +
          'own — every overlay module is compiled by the one project `backend/tsconfig.apps.json`. ' +
          'Remove the file, or promote the module to a module package.',
      );
    }
    super(
      `[overlay] ${String(findings.length)} file(s) under ${root} break the overlay module ` +
        `layout:\n${lines.join('\n')}\n${remedies.join('\n')}\nNothing was composed and nothing ` +
        'was written.',
    );
    this.findings = findings;
  }
}

/** A file inside a module that makes the module a package in disguise. */
const PACKAGE_IN_DISGUISE =
  /^(?:package\.json|tsconfig(?:\..+)?\.json|(?:tsup|vite|vitest)\.config\.[cm]?[jt]s)$/;

/** A manifest, in either spelling the loader resolves. */
const MANIFEST = /^manifest\.[jt]s$/;

/** Directories that are not a module's own source. */
const NOT_SOURCE: ReadonlySet<string> = new Set(['node_modules', 'dist']);

function findingsIn(dir: string, isModuleRoot: boolean, out: OverlayLayoutFinding[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      if (!NOT_SOURCE.has(name)) findingsIn(full, false, out);
      continue;
    }
    if (!isModuleRoot && MANIFEST.test(name)) out.push({ kind: 'nested-module', file: full });
    if (PACKAGE_IN_DISGUISE.test(name)) out.push({ kind: 'package-in-disguise', file: full });
  }
}

/** Every layout finding of the modules `ids` under `root`, in path order. */
export function overlayLayoutFindings(
  root: string,
  ids: readonly string[],
): OverlayLayoutFinding[] {
  const out: OverlayLayoutFinding[] = [];
  for (const id of ids) findingsIn(join(root, id), true, out);
  return out.sort((left, right) => left.file.localeCompare(right.file));
}

/** Throw, listing every finding at once, when an overlay module breaks the layout. */
export function assertOverlayLayout(root: string, ids: readonly string[]): void {
  const findings = overlayLayoutFindings(root, ids);
  if (findings.length > 0) throw new OverlayLayoutError(root, findings);
}
