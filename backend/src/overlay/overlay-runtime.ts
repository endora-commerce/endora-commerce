// Overlay resolution — runtime loader used by composition.
//
// The resolver (`resolve-overlay.ts`) decides WHICH core units a deployment
// overrides; this module dynamically imports the overlay implementations so
// composition can wire them. It runs ONCE at composeApp() startup. For a
// bare-core build (no DEPLOYMENT / no overlay dir) both loaders return empty and
// composition is byte-for-byte unchanged (FR-008).
//
// Runtime path mapping: overlay files are authored under `backend/src/apps/…`
// and compiled to `backend/dist/apps/…`. When this module runs from `dist/`
// (production) we import the compiled `.js`; under tsx/vitest (dev + tests) we
// import the `.ts` source directly. Detected from `import.meta.url`.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { ModuleManifest } from '@b2b/contracts';
import type { ModulePlugin } from '../http/server.js';
import type { EventBus } from '../events/bus.js';
import type { CommandBus } from '../commands/index.js';
import type { AuditLogService } from '../modules/audit_logs/services/audit-log-service.js';
import type { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import {
  activeOverlayModulesRoot,
  coreModulesRoot,
  selectedDeployment,
} from './overlay-roots.js';
import { indexCore, resolveOverlay, scanOverlay } from './resolve-overlay.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';

const RUNNING_FROM_DIST = import.meta.url.includes('/dist/');

/** Convert an absolute `backend/src/…/*.ts` overlay path to an importable URL. */
function importUrlFor(absSrcPath: string): string {
  const path = RUNNING_FROM_DIST
    ? absSrcPath.replace(`${'/src/'}`, '/dist/').replace(/\.ts$/, '.js')
    : absSrcPath;
  return pathToFileURL(path).href;
}

function pascalCase(fileStem: string): string {
  return fileStem
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Pick the class/constructor export from a dynamically-imported overlay module. */
function pickClassExport(mod: Record<string, unknown>, relPath: string): unknown {
  if (typeof mod['default'] === 'function') return mod['default'];
  const stem = (relPath.split('/').pop() ?? relPath).replace(/\.ts$/, '');
  const byName = mod[pascalCase(stem)];
  if (typeof byName === 'function') return byName;
  for (const value of Object.values(mod)) {
    if (typeof value === 'function') return value;
  }
  return undefined;
}

/**
 * Load overlay SERVICE class overrides for the active deployment, keyed
 * `"<moduleId>/<relPath>"` (e.g. `price_lists/services/pricing-service.ts`).
 * The value is the overlay's exported class; composition passes it into the
 * owning module factory. Empty for a bare-core build.
 */
export async function loadOverlayServiceClasses(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  const overlayRoot = activeOverlayModulesRoot(env);
  if (overlayRoot === null) return map;
  const resolution = resolveOverlay({
    coreRoot: coreModulesRoot(),
    overlayRoot,
    deployment: selectedDeployment(env),
  });
  for (const o of resolution.overrides) {
    if (o.kind !== 'service') continue;
    const mod = (await import(importUrlFor(o.overlayPath))) as Record<string, unknown>;
    const impl = pickClassExport(mod, o.relPath);
    if (impl !== undefined) map.set(`${o.moduleId}/${o.relPath}`, impl);
  }
  return map;
}

// ---- Overlay-only modules (US2) -------------------------------------------

/**
 * Common dependencies handed to an overlay module's plugin factory.
 * Includes the API interceptor registry (feature 060, FR-012) so client-only
 * overlay modules can register pre/post interceptors during composition.
 */
export interface OverlayModuleContext {
  emFactory: () => EntityManager;
  redis: Redis;
  eventBus: EventBus;
  commandBus: CommandBus;
  auditLogService: AuditLogService;
  requireAdmin: RequireAdminFactory;
  apiInterceptors: ApiInterceptorRegistry;
}

/** An overlay module's `plugin.ts` exports this as `overlayModule` (or default). */
export type OverlayModuleFactory = (ctx: OverlayModuleContext) => ModulePlugin;

/** An overlay module's manifest + on-disk location (no plugin wiring yet). */
export interface OverlayModuleManifest {
  id: string;
  manifest: ModuleManifest;
  filePath: string;
}

/** Ids of client-only overlay modules for the active deployment (absent from core). */
function newOverlayModuleIds(env: NodeJS.ProcessEnv): { root: string; ids: string[] } | null {
  const overlayRoot = activeOverlayModulesRoot(env);
  if (overlayRoot === null) return null;
  const { newModules } = scanOverlay(overlayRoot, indexCore(coreModulesRoot()));
  return { root: overlayRoot, ids: newModules };
}

/**
 * Discover overlay MODULE manifests for the active deployment WITHOUT wiring
 * their plugins. Used early in composition to build the deployment-resolved
 * registry the permission catalogue + lifecycle consume (FR-009, FR-012).
 * Empty for a bare-core build.
 */
export async function discoverOverlayModuleManifests(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OverlayModuleManifest[]> {
  const found = newOverlayModuleIds(env);
  if (found === null) return [];
  const out: OverlayModuleManifest[] = [];
  for (const id of found.ids) {
    const manifestPath = join(found.root, id, 'manifest.ts');
    const mod = (await import(importUrlFor(manifestPath))) as Record<string, unknown>;
    const manifest = mod['manifest'] as ModuleManifest | undefined;
    if (manifest) out.push({ id, manifest, filePath: manifestPath });
  }
  return out;
}

/**
 * Load overlay module Fastify PLUGINS for the active deployment, wired with the
 * shared context. Called late in composition once the event/command bus exist.
 * Empty for a bare-core build.
 */
export async function loadOverlayModulePlugins(
  ctx: OverlayModuleContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModulePlugin[]> {
  const found = newOverlayModuleIds(env);
  if (found === null) return [];
  const plugins: ModulePlugin[] = [];
  for (const id of found.ids) {
    const mod = (await import(importUrlFor(join(found.root, id, 'plugin.ts')))) as Record<
      string,
      unknown
    >;
    const factory = (mod['overlayModule'] ?? mod['default']) as OverlayModuleFactory | undefined;
    if (typeof factory === 'function') plugins.push(factory(ctx));
  }
  return plugins;
}
