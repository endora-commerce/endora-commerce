import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { AdminContributions, PermissionRequirement } from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  ACTION_PERMISSION_DISAGREEMENTS,
  analyse,
  type ActionRecord,
} from '../../../scripts/check-action-route-permissions.js';
import type { BackendServerHandle } from '../../helpers/test-server.js';

/**
 * The palette half of `specs/163-projects-and-tasks/` FR-041
 * (`contracts/admin-surfaces.md` §4, Principle XVI): what one module's manifest
 * advertises under ⌘K, read from the artefacts that decide it rather than
 * restated — the registered manifest, the module's own `./admin` routes, its
 * bundles, its Fastify registrations and the server's palette registry.
 */

/** One palette action as §4 states it. */
export interface ExpectedAction {
  readonly id: string;
  readonly route: string;
  readonly permission: string;
  readonly icon: string;
  readonly label: { readonly en: string; readonly pl: string };
}

const MODULES_ROOT = fileURLToPath(new URL('../../../../packages/modules/', import.meta.url));

export function declaredActions(moduleId: string) {
  const manifest = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === moduleId)?.manifest;
  expect(manifest, `${moduleId} must be a registered module`).toBeDefined();
  return manifest?.actions ?? [];
}

/** A bundle of the module, as shipped. */
function bundle(moduleId: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(readFileSync(join(MODULES_ROOT, moduleId, 'i18n', `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

/** Holding `code` alone satisfies `requirement` — the kit's rule, restated for the reason `batch-sixteen` gives. */
function opensWith(requirement: PermissionRequirement | undefined, code: string): boolean {
  if (requirement === undefined) return true;
  if (typeof requirement === 'string') return requirement === code;
  return requirement.length === 0 || requirement.includes(code);
}

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourcesUnder(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * `check:action-route-permissions` over this module alone: its actions against
 * its own Fastify registrations, keyed as the check keys a module's file, with
 * the check's own ledger applied.
 */
export function actionRouteFindings(moduleId: string) {
  const backend = join(MODULES_ROOT, moduleId, 'src', 'backend');
  const sources = new Map<string, string>();
  for (const file of sourcesUnder(backend)) {
    sources.set(`modules/${moduleId}/${relative(backend, file).split('\\').join('/')}`, readFileSync(file, 'utf8'));
  }
  const actions: ActionRecord[] = declaredActions(moduleId).map((action) => ({
    moduleId,
    actionId: action.id,
    targetRoute: action.targetRoute,
    ...(action.requiredPermission === undefined ? {} : { requiredPermission: action.requiredPermission }),
    // An action that names its entry route is judged against it, as `check:action-route-permissions` does.
    ...(action.entryApiRoute === undefined ? {} : { entryApiRoute: action.entryApiRoute }),
  }));
  const ledger = Object.fromEntries(
    Object.entries(ACTION_PERMISSION_DISAGREEMENTS).filter(([key]) => key.startsWith(`${moduleId}:`)),
  );
  return analyse({ sources, actions }, ledger);
}

/** The palette entries `moduleId` advertises to the stub administrator: id → label, in `language`. */
export async function servedActions(
  h: BackendServerHandle,
  moduleId: string,
  language: 'en' | 'pl' = 'en',
): Promise<Record<string, string>> {
  const response = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/admin-actions?language=${language}`,
    cookies: { b2b_session: 'stub-admin-session' },
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as { data: { data: Array<{ actionId: string; moduleId: string; label: string }> } };
  return Object.fromEntries(
    body.data.data
      .filter((action) => action.moduleId === moduleId)
      .map((action) => [action.actionId, action.label] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** The declarations — id, route, code and icon — in the manifest's order. */
export function expectDeclared(moduleId: string, expected: readonly ExpectedAction[]): void {
  expect(
    declaredActions(moduleId).map((action) => [action.id, action.targetRoute, action.requiredPermission, action.icon]),
  ).toEqual(expected.map((a) => [a.id, a.route, a.permission, a.icon]));
}

/** Each action opens a screen the module's own admin layer declares, on the action's code. */
export function expectTargetsOwnRoutes(moduleId: string, admin: AdminContributions): void {
  for (const action of declaredActions(moduleId)) {
    const target = (admin.routes ?? []).find((route) => route.path === action.targetRoute);
    expect(target, `${action.id} targets ${action.targetRoute}`).toBeDefined();
    expect(
      opensWith(target?.requiredPermission, action.requiredPermission ?? ''),
      `${action.id} advertises ${String(action.requiredPermission)} for ${action.targetRoute}`,
    ).toBe(true);
  }
}

/** Labels in both languages, in the bundles and as the palette serves them. */
export async function expectLabels(
  h: BackendServerHandle,
  moduleId: string,
  expected: readonly ExpectedAction[],
): Promise<void> {
  for (const language of ['en', 'pl'] as const) {
    const words = bundle(moduleId, language);
    for (const action of declaredActions(moduleId)) {
      expect(words[action.labelKey], `${language}: ${action.labelKey}`).toEqual(expect.any(String));
      if (action.descriptionKey) {
        expect(words[action.descriptionKey], `${language}: ${action.descriptionKey}`).toEqual(expect.any(String));
      }
    }
    expect(await servedActions(h, moduleId, language), language).toEqual(
      Object.fromEntries(
        [...expected].sort((a, b) => a.id.localeCompare(b.id)).map((a) => [a.id, a.label[language]] as const),
      ),
    );
  }
}
