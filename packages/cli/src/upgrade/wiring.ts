/**
 * The wiring an `endora upgrade` brings to the installed release's rendering
 * (`specs/190-overlay-full-modules/` FR-017, contract `overlay-build.md` §5, #1848).
 *
 * ## What it touches
 *
 * - the compiled entry points that name where `apps/` is — `backend/src/{index,worker,cli}.ts`
 *   and `backend/src/module-commands/runtime.ts`;
 * - `backend/tsconfig.apps.json`, written when absent;
 * - the backend member's `build`, `dev` and `typecheck` scripts, and the root's `typecheck`
 *   and the `typecheck` term of `setup`.
 *
 * ## The rule: a release's file is rewritten, a client's is reported
 *
 * A wiring file is the client's file. One is rewritten only while it is byte for byte what a
 * release rendered (`./wiring-renderings.ts`, the instance's name and scope put back in); one
 * already current is left; anything else is **reported** — the operator re-applies the edit to
 * the new rendering. A script is judged the same way against the value the earlier release
 * wrote. Nothing here deletes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { planInstance, type PlanInput } from '../new-instance/template.js';
import { PREVIOUS_WIRING } from './wiring-renderings.js';

/** The files the upgrade owns while they are a release's, relative to the instance root. */
export const WIRING_FILES = [
  'backend/src/index.ts',
  'backend/src/worker.ts',
  'backend/src/cli.ts',
  'backend/src/module-commands/runtime.ts',
] as const;

const APPS_CONFIG = 'backend/tsconfig.apps.json';
const NODE = 'node --env-file-if-exists=../.env';

/** What 0.112.0 wrote for each script this upgrade moves, and what it writes now. */
const BACKEND_SCRIPTS: ReadonlyArray<{ name: string; was: readonly (string | null)[] }> = [
  { name: 'build', was: ['tsc -p tsconfig.json'] },
  { name: 'dev', was: [`tsc -p tsconfig.json --watch & ${NODE} --watch dist/index.js`] },
  { name: 'typecheck', was: [null] },
];

export interface InstanceIdentity {
  /** The root manifest's `name`. */
  readonly name: string;
  /** The platform package's scope, `@endora-commerce/`. */
  readonly scope: string;
}

export interface CurrentWiring {
  readonly files: Readonly<Record<string, string>>;
  readonly appsConfig: string;
  readonly backendScripts: Readonly<Record<string, string>>;
  readonly rootScripts: Readonly<Record<string, string>>;
}

/** This CLI's own rendering of the wiring, for one instance's name and scope. */
export function currentWiring(identity: InstanceIdentity): CurrentWiring {
  const input: PlanInput = {
    name: identity.name,
    deployment: identity.name,
    scope: identity.scope,
    platformVersion: '0.0.0',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '0.0.0',
    docsRanges: new Map(),
    declaredRanges: new Map(),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    declared: [],
    existingEnv: '',
    generated: new Map(),
  };
  const plan = planInstance(input);
  const content = (path: string): string => {
    const file = plan.files.find((candidate) => candidate.path === path);
    if (file === undefined) throw new Error(`the instance template renders no ${path}`);
    return file.content;
  };
  const scriptsOf = (path: string): Record<string, string> =>
    (JSON.parse(content(path)) as { scripts: Record<string, string> }).scripts;
  return {
    files: Object.fromEntries(WIRING_FILES.map((path) => [path, content(path)])),
    appsConfig: content(APPS_CONFIG),
    backendScripts: scriptsOf('backend/package.json'),
    rootScripts: scriptsOf('package.json'),
  };
}

export interface WiringChange {
  /** A file path, or `<manifest> scripts.<name>`. */
  readonly what: string;
  readonly file: string;
  readonly after: string;
}

export interface WiringPlan {
  readonly changes: readonly WiringChange[];
  /** What the operator edited: reported, never written. */
  readonly edited: ReadonlyArray<{ readonly what: string; readonly remedy: string }>;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** The instance's name and its platform scope, read from the root manifest. */
export function instanceIdentity(instanceDir: string): InstanceIdentity | null {
  const manifest = readJson(join(instanceDir, 'package.json'));
  const name = typeof manifest['name'] === 'string' ? manifest['name'] : null;
  const declared = ['dependencies', 'devDependencies'].flatMap((field) =>
    Object.keys((manifest[field] as Record<string, unknown> | undefined) ?? {}),
  );
  const platform = declared.find((dependency) => /^@[^/]+\/platform$/.test(dependency));
  if (name === null || platform === undefined) return null;
  return { name, scope: platform.slice(0, -'platform'.length) };
}

/** Everything the upgrade would change, and everything it would only report. */
export function planWiring(instanceDir: string): WiringPlan {
  const identity = instanceIdentity(instanceDir);
  if (identity === null) return { changes: [], edited: [] };
  // Only a tree the template rendered: one with none of its wiring files is not an
  // instance this command scaffolded, and nothing in it is a release's to rewrite.
  if (!WIRING_FILES.some((path) => existsSync(join(instanceDir, path)))) {
    return { changes: [], edited: [] };
  }
  const fill = (text: string): string =>
    text.replaceAll('{{name}}', identity.name).replaceAll('{{scope}}', identity.scope);
  const current = currentWiring(identity);
  const changes: WiringChange[] = [];
  const edited: Array<{ what: string; remedy: string }> = [];

  for (const path of WIRING_FILES) {
    const file = join(instanceDir, path);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const target = current.files[path]!;
    if (text === target) continue;
    const released = PREVIOUS_WIRING.some((entry) => entry.files[path] !== undefined && fill(entry.files[path]) === text);
    if (released) changes.push({ what: path, file, after: target });
    else edited.push({ what: path, remedy: 're-apply your edit to the new rendering in the 0.113.0 upgrade note' });
  }

  const apps = join(instanceDir, APPS_CONFIG);
  if (!existsSync(apps)) changes.push({ what: APPS_CONFIG, file: apps, after: current.appsConfig });

  const backendManifest = join(instanceDir, 'backend', 'package.json');
  if (existsSync(backendManifest)) {
    const manifest = readJson(backendManifest);
    const scripts = { ...((manifest['scripts'] as Record<string, string> | undefined) ?? {}) };
    const moved: string[] = [];
    for (const { name, was } of BACKEND_SCRIPTS) {
      const now = current.backendScripts[name];
      const value = scripts[name] ?? null;
      if (now === undefined || value === now) continue;
      if (was.includes(value)) {
        scripts[name] = now;
        moved.push(name);
      } else {
        edited.push({
          what: `backend/package.json scripts.${name}`,
          remedy: `set it to \`${now}\`, keeping what you added`,
        });
      }
    }
    if (moved.length > 0) {
      changes.push({
        what: `backend/package.json scripts.${moved.join(', scripts.')}`,
        file: backendManifest,
        after: `${JSON.stringify({ ...manifest, scripts }, null, 2)}\n`,
      });
    }
  }

  const rootManifest = join(instanceDir, 'package.json');
  const root = readJson(rootManifest);
  const rootScripts = { ...((root['scripts'] as Record<string, string> | undefined) ?? {}) };
  const rootMoved: string[] = [];
  if (rootScripts['typecheck'] === undefined && current.rootScripts['typecheck'] !== undefined) {
    rootScripts['typecheck'] = current.rootScripts['typecheck'];
    rootMoved.push('typecheck');
  }
  const setup = rootScripts['setup'];
  if (setup !== undefined && !setup.includes('pnpm run typecheck')) {
    if (setup.includes('pnpm run build && pnpm run migrate')) {
      rootScripts['setup'] = setup.replace(
        'pnpm run build && pnpm run migrate',
        'pnpm run build && pnpm run typecheck && pnpm run migrate',
      );
      rootMoved.push('setup');
    } else {
      edited.push({
        what: 'package.json scripts.setup',
        remedy: 'add `pnpm run typecheck` after `pnpm run build`',
      });
    }
  }
  if (rootMoved.length > 0) {
    changes.push({
      what: `package.json scripts.${rootMoved.join(', scripts.')}`,
      file: rootManifest,
      after: `${JSON.stringify({ ...root, scripts: rootScripts }, null, 2)}\n`,
    });
  }

  return { changes, edited };
}

/** Write every change of `plan`. Nothing reported is touched. */
export function applyWiringPlan(plan: WiringPlan): void {
  for (const change of plan.changes) writeFileSync(change.file, change.after, 'utf8');
}
