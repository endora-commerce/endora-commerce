// Overlay resolution — deterministic scan of core + a deployment overlay.
//
// Walks the core modules root and a deployment's overlay modules root, applies
// the shadowing rule (an overlay file at the same module-relative path replaces
// its core equivalent), and returns the resolved overrides + new overlay
// modules. Fails closed on schema overrides, unknown targets, un-contracted
// service overrides, and conflicts. Pure + injectable (roots are parameters) so
// it is unit-testable without a database. See contracts/overlay-resolution.md.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { assertNoConflicts } from './conflict-policy.js';
import {
  MissingCoreContractError,
  SchemaOverrideNotSupportedError,
  UnknownOverrideTargetError,
} from './errors.js';
import {
  type OverlayContribution,
  type OverlayResolution,
  type OverridableKind,
  type RejectedKind,
  type UnitKind,
} from './types.js';

/** Index of a module's files, keyed by module id → set of module-relative POSIX paths. */
export interface CoreIndex {
  moduleIds: ReadonlySet<string>;
  filesByModule: ReadonlyMap<string, ReadonlySet<string>>;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** Deterministic list of subdirectories (module folders) directly under `root`. */
function listModuleDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Recursively collect module-relative POSIX file paths under a module dir, sorted. */
function listModuleFiles(moduleDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(toPosix(relative(moduleDir, full)));
    }
  };
  walk(moduleDir);
  return out.sort();
}

/** Build the core index (module ids + their file paths) from the core root. */
export function indexCore(coreRoot: string): CoreIndex {
  const moduleIds = new Set<string>();
  const filesByModule = new Map<string, ReadonlySet<string>>();
  for (const id of listModuleDirs(coreRoot)) {
    moduleIds.add(id);
    filesByModule.set(id, new Set(listModuleFiles(join(coreRoot, id))));
  }
  return { moduleIds, filesByModule };
}

/**
 * Classify a module-relative path into an override kind. Only `service`,
 * `route`, `config` are overridable in v1. `schema` (entities/migrations) and
 * `other` (anything else, incl. `*.interface.ts`) are rejected.
 */
export function classifyKind(relPath: string): UnitKind {
  if (relPath.endsWith('.interface.ts')) return 'other';
  if (relPath.startsWith('entities/') || relPath.startsWith('migrations/')) {
    return 'schema' satisfies RejectedKind;
  }
  if (relPath.startsWith('services/')) return 'service';
  if (relPath.startsWith('routes/') || /^routes\.[^/]+\.ts$/.test(relPath)) return 'route';
  if (relPath === 'plugin.ts') return 'route';
  if (relPath === 'config.ts' || relPath.startsWith('config/')) return 'config';
  if (relPath === 'manifest.ts') return 'config';
  return 'other';
}

function isOverridable(kind: UnitKind): kind is OverridableKind {
  return kind === 'service' || kind === 'route' || kind === 'config';
}

/** Sibling interface path for a service file, e.g. `services/x.ts` → `services/x.interface.ts`. */
function interfaceSibling(relPath: string): string {
  return relPath.replace(/\.ts$/, '.interface.ts');
}

/**
 * Scan a deployment overlay root against the core index. Returns the overlay
 * contributions (units it overrides) and the ids of brand-new overlay modules.
 * Throws (fails the build) on any schema override, unknown target, or
 * un-contracted service override.
 */
export function scanOverlay(
  overlayRoot: string,
  core: CoreIndex,
): { contributions: OverlayContribution[]; newModules: string[] } {
  const contributions: OverlayContribution[] = [];
  const newModules: string[] = [];

  for (const moduleId of listModuleDirs(overlayRoot)) {
    // A module id absent from core is a brand-new client-only overlay module —
    // it owns all its files (including its own entities/migrations). Additive.
    if (!core.moduleIds.has(moduleId)) {
      newModules.push(moduleId);
      continue;
    }
    const coreFiles = core.filesByModule.get(moduleId) ?? new Set<string>();
    const moduleDir = join(overlayRoot, moduleId);
    for (const relPath of listModuleFiles(moduleDir)) {
      const kind = classifyKind(relPath);
      if (kind === 'schema') throw new SchemaOverrideNotSupportedError(moduleId, relPath);
      if (!isOverridable(kind)) throw new UnknownOverrideTargetError(moduleId, relPath);
      // The shadowed unit must exist in core (else it is a stale/typo target).
      if (!coreFiles.has(relPath)) throw new UnknownOverrideTargetError(moduleId, relPath);

      let interfaceRelPath: string | null = null;
      if (kind === 'service') {
        const iface = interfaceSibling(relPath);
        if (!coreFiles.has(iface)) throw new MissingCoreContractError(moduleId, relPath);
        interfaceRelPath = iface;
      }
      contributions.push({
        moduleId,
        kind,
        relPath,
        overlayPath: join(moduleDir, relPath),
        corePath: join(overlayRoot, '..'), // placeholder; recomputed by caller with coreRoot
        interfaceRelPath,
      });
    }
  }
  newModules.sort();
  return { contributions, newModules };
}

/**
 * Full resolution for one deployment: index core, scan the overlay, reject
 * conflicts, and return the deterministic resolution. When `overlayRoot` is
 * `null` (no deployment / no overlay dir) the result is core-only and empty.
 */
export function resolveOverlay(params: {
  coreRoot: string;
  overlayRoot: string | null;
  deployment: string | null;
}): OverlayResolution {
  const { coreRoot, overlayRoot, deployment } = params;
  if (overlayRoot === null) {
    return { deployment: null, overrides: [], newModules: [] };
  }
  const core = indexCore(coreRoot);
  const { contributions, newModules } = scanOverlay(overlayRoot, core);
  assertNoConflicts(contributions);
  const overrides = contributions
    .map((c) => ({
      ...c,
      corePath: join(coreRoot, c.moduleId, c.relPath),
      source: 'overlay' as const,
      deployment: deployment ?? '',
    }))
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.kind.localeCompare(b.kind) || a.relPath.localeCompare(b.relPath));
  return { deployment, overrides, newModules };
}
