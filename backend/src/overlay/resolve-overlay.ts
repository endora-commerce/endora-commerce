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
import { SchemaOverrideNotSupportedError, UnknownOverrideTargetError } from './errors.js';
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

/**
 * What `tsc` emits beside every unit it compiles. They are build artefacts, not
 * units a deployment can override, and they exist only in a compiled tree — so
 * the source tree this scan was written against never held one and nothing
 * excluded them. In `backend/dist` each unit brings three, and every one of
 * them classified as `'other'`, which is `UnknownOverrideTargetError` for a
 * file nobody wrote (feature 080, D-165 step C).
 */
const EMIT_SIDECAR = /(?:\.d\.ts|\.map)$/;

/**
 * Recursively collect module-relative POSIX file paths under a module dir,
 * sorted. Emit sidecars are left out on both sides — of the core index and of
 * the overlay scan — so a compiled tree indexes exactly the units a source tree
 * does.
 */
function listModuleFiles(moduleDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && !EMIT_SIDECAR.test(name)) out.push(toPosix(relative(moduleDir, full)));
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
 * Classify a module-relative path into an override kind. Only `route` and
 * `config` are overridable. `schema` (entities/migrations) and `other`
 * (anything else) are rejected.
 *
 * **`services/` is no longer overridable by shadowing** (feature 072, T067). A
 * service override is a decoration of a container registration, declared in the
 * overriding module rather than inferred from a file's path, so a `services/`
 * file under an overlay is now an unknown target — which is what it is: a file
 * the platform would silently never load.
 */
export function classifyKind(relPath: string): UnitKind {
  // A compiled tree spells every one of these `.js`, and this function used to
  // read the extension five times — so under `backend/dist` a route override
  // classified as `'other'` and the scan refused it as an unknown target
  // (feature 080, D-165 step C). The kind is a property of the unit, not of the
  // artefact format it is currently in, so the compiled name is read as the
  // authored one and every rule below stays written once.
  const path = relPath.endsWith('.js') ? `${relPath.slice(0, -'.js'.length)}.ts` : relPath;
  if (path.endsWith('.interface.ts')) return 'other';
  if (path.startsWith('entities/') || path.startsWith('migrations/')) {
    return 'schema' satisfies RejectedKind;
  }
  if (path.startsWith('routes/') || /^routes\.[^/]+\.ts$/.test(path)) return 'route';
  if (path === 'plugin.ts') return 'route';
  if (path === 'config.ts' || path.startsWith('config/')) return 'config';
  if (path === 'manifest.ts') return 'config';
  return 'other';
}

function isOverridable(kind: UnitKind): kind is OverridableKind {
  return kind === 'route' || kind === 'config';
}

/**
 * Scan a deployment overlay root against the core index. Returns the overlay
 * contributions (units it overrides) and the ids of brand-new overlay modules.
 * Throws (fails the build) on any schema override or unknown target.
 */
export function scanOverlay(
  overlayRoot: string,
  core: CoreIndex,
): { contributions: OverlayContribution[]; newModules: string[] } {
  const contributions: OverlayContribution[] = [];
  const newModules: string[] = [];

  for (const moduleId of listModuleDirs(overlayRoot)) {
    // A module id absent from core is a brand-new client-only overlay module —
    // it owns all its files, so nothing here shadows anything and there is no
    // override to classify. Additive.
    //
    // It does **not** own schema: out-of-core code contributes no persisted
    // entity class and no migration (D-105). The decorator is deliberately not
    // spelled out in this comment — the entity registry's walk looks for that
    // token in source text and would collect this sentence as an entity, which
    // is precisely what it did when this note was first written.
    //
    // The rule is not enforced here, deliberately —
    // this function answers "what does this deployment override?", and an
    // overlay module overrides nothing. The refusal lives in
    // `scripts/generate-composer.ts`, which is where the entity and migration
    // registries are built and therefore the only place that can say the table
    // would never be created.
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

      contributions.push({
        moduleId,
        kind,
        relPath,
        overlayPath: join(moduleDir, relPath),
        corePath: join(overlayRoot, '..'), // placeholder; recomputed by caller with coreRoot
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
