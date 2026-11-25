/**
 * The overlay module layout, as `endora build overlays` checks it
 * (`specs/190-overlay-full-modules/` T012, FR-002 – FR-003, contract
 * `overlay-module-layout.md` §1).
 *
 * The platform refuses the same layout when it resolves overlay modules
 * (`@endora-commerce/platform`'s `overlay/overlay-layout.ts`), and the build refuses it
 * earlier, before a compile. The CLI does not depend on the platform — an instance runs it
 * before anything is installed into `backend/` — so the walk is written twice, and
 * `layout.test.ts` runs both over the same trees and requires the same findings: the two
 * walks must agree or one of them would let through what the other refuses.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface LayoutFinding {
  readonly kind: 'nested-module' | 'package-in-disguise';
  /** The offending file, absolute. */
  readonly file: string;
}

const PACKAGE_IN_DISGUISE =
  /^(?:package\.json|tsconfig(?:\..+)?\.json|(?:tsup|vite|vitest)\.config\.[cm]?[jt]s)$/;
const MANIFEST = /^manifest\.[jt]s$/;
const NOT_SOURCE: ReadonlySet<string> = new Set(['node_modules', 'dist']);

/** The module directories under one `modules/` root: direct children, hidden ones excluded. */
export function moduleIdsUnder(modulesRoot: string): string[] {
  let names: string[];
  try {
    names = readdirSync(modulesRoot);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith('.'))
    .filter((name) => {
      try {
        return statSync(join(modulesRoot, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function walk(dir: string, isModuleRoot: boolean, out: LayoutFinding[]): void {
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
      if (!NOT_SOURCE.has(name)) walk(full, false, out);
      continue;
    }
    if (!isModuleRoot && MANIFEST.test(name)) out.push({ kind: 'nested-module', file: full });
    if (PACKAGE_IN_DISGUISE.test(name)) out.push({ kind: 'package-in-disguise', file: full });
  }
}

/** Every layout finding of the modules `ids` under `modulesRoot`, in path order. */
export function layoutFindings(modulesRoot: string, ids: readonly string[]): LayoutFinding[] {
  const out: LayoutFinding[] = [];
  for (const id of ids) walk(join(modulesRoot, id), true, out);
  return out.sort((left, right) => left.file.localeCompare(right.file));
}
