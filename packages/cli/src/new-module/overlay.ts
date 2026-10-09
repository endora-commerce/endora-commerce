/**
 * `endora new module`, inside an **instance** — the overlay half.
 *
 * ## Why there are two halves
 *
 * In a checkout of the platform repository this command writes a module
 * **package** and delegates its `package.json` to that repository's manifest
 * generator (`host.ts`). An instance has no such generator and must not grow
 * one: it holds a copy of no part of the platform (D-207). Until this file
 * existed the command therefore stopped in an instance, naming a script the
 * client's tree was never going to have — in the one tree a client extends.
 *
 * What an instance composes with no build and no generator is an **overlay
 * module**: a directory under `apps/<deployment>/modules/<id>/` holding a
 * `manifest.ts` and a `backend.ts`, discovered at runtime
 * (`specs/conventions/overlay-modules.md`). So that is what this half writes,
 * and nothing else — no `package.json`, no build configuration, no test
 * configuration. Node loads the two files and strips their types, which is why
 * the emitted code is the subset stripping accepts.
 *
 * ## What it refuses, and why it is a refusal rather than a narrower module
 *
 * A flag that asks for something an overlay module cannot be is refused by
 * name, before a byte is written. Quietly emitting less than was asked for is
 * the failure this command exists to prevent one level up: an author who passed
 * `--entities` and got a module with no table would find out at the first
 * query.
 *
 *   * **schema** (`--entities`, `--tenant-scope`). An overlay module contributes
 *     no `@Entity()` class and no migration (D-106); `endora generate` refuses
 *     one in an instance.
 *   * **an admin screen** (`--admin`, `--action`). A screen is a module
 *     package's `./admin` layer, which the admin registry is generated from. An
 *     overlay module is in no registry, so a palette action would open a route
 *     nothing mounts.
 *   * **a published port** (`--ports`). A type-only `./ports` subpath is a
 *     package's `exports` entry.
 *   * **a worker or a subscriber** (`--worker`, `--subscriber`). Both are one
 *     call on the context the emitted `registerModule` already receives, and the
 *     refusal says which — the package scaffold's emitted worker is three files
 *     and a build, none of which an overlay has.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parseEnvFile } from '../inputs/env-file.js';
import { installedModulePackages } from '../lib/module-packages.js';
import type { EmittedFile } from './emit.js';
import { MANIFEST_GENERATOR, findRepoRoot } from './host.js';
import {
  buildScaffoldSpec,
  gatingPermissionOf,
  pascalOf,
  ScaffoldInputError,
  slugOf,
  type ModuleScaffoldSpec,
  type ScaffoldInput,
} from './spec.js';

/** The instance this run is standing in. */
export interface OverlayHost {
  /** The directory holding `pnpm-workspace.yaml`. */
  readonly root: string;
  /** The npm scope the instance installs the platform under, with its slash. */
  readonly scope: string;
  /** Does the root manifest declare the contracts package a manifest imports? */
  readonly declaresContracts: boolean;
}

/**
 * The instance above `cwd`, or `null` when this is not one.
 *
 * An instance is a workspace whose **root manifest depends on the platform**
 * and that carries no manifest generator — the first is what `endora new
 * instance` writes (`instance-tree.md` §2.1) and the second is what tells it
 * from the platform repository, whose root depends on nothing of its own.
 */
export function resolveOverlayHost(cwd: string): OverlayHost | null {
  const root = findRepoRoot(cwd);
  if (root === null) return null;
  if (existsSync(join(root, MANIFEST_GENERATOR))) return null;
  let manifest: { dependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    return null;
  }
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const platform = dependencies.find((name) => /^@[^/]+\/platform$/.test(name));
  if (platform === undefined) return null;
  const scope = platform.slice(0, platform.indexOf('/') + 1);
  return { root, scope, declaresContracts: dependencies.includes(`${scope}contracts`) };
}

function directoriesUnder(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** What the instance's own `.env` says it runs as, or `null`. */
function declaredDeployment(root: string): string | null {
  const path = join(root, '.env');
  if (!existsSync(path)) return null;
  return parseEnvFile(readFileSync(path, 'utf8')).get('DEPLOYMENT') ?? null;
}

/**
 * The deployment the module is written into, and whether the instance's `.env`
 * already selects it.
 *
 * `DEPLOYMENT` from the instance's own `.env` when it names one — that is the
 * deployment the instance composes, so it is the only directory a new module is
 * any use in. With none set, the one directory under `apps/`; and with several
 * and none set, a refusal, because choosing would write a module the instance
 * may never compose.
 */
function resolveDeployment(host: OverlayHost): { deployment: string; selected: boolean } {
  const onDisk = directoriesUnder(join(host.root, 'apps'));
  const declared = declaredDeployment(host.root);
  if (declared !== null) {
    if (!onDisk.includes(declared)) {
      throw new ScaffoldInputError(
        `${join(host.root, '.env')} sets DEPLOYMENT=${declared}, and there is no ` +
          `apps/${declared}/ in this instance${
            onDisk.length === 0 ? '' : ` (it has ${onDisk.map((d) => `apps/${d}/`).join(', ')})`
          }. An overlay module is composed only from the directory \`DEPLOYMENT\` names, so ` +
          `one written anywhere else would never run. Correct the value, or create the ` +
          `directory. Nothing is written.`,
      );
    }
    return { deployment: declared, selected: true };
  }
  if (onDisk.length === 1) return { deployment: onDisk[0]!, selected: false };
  if (onDisk.length === 0) {
    throw new ScaffoldInputError(
      `${host.root} has no directory under apps/, so there is no deployment to write an ` +
        `overlay module into. \`endora new instance\` writes apps/<deployment>/; create it ` +
        `and set DEPLOYMENT=<deployment> in .env. Nothing is written.`,
    );
  }
  throw new ScaffoldInputError(
    `this instance holds ${String(onDisk.length)} deployments (${onDisk.join(', ')}) and its ` +
      `.env sets no DEPLOYMENT, so there is no telling which one it runs as. Set ` +
      `DEPLOYMENT=<one of them> in ${join(host.root, '.env')} — the instance composes overlay ` +
      `modules from that directory alone. Nothing is written.`,
  );
}

/** One flag an overlay module cannot honour, and the sentence that says why. */
function refuseWhatAnOverlayCannotBe(
  input: ScaffoldInput & { readonly dir?: string | undefined; readonly scope?: string | undefined },
  modulesRoot: string,
): void {
  const refusals: (readonly [boolean, string])[] = [
    [
      input.entities === true,
      '--entities: an overlay module contributes no schema — no `@Entity()` class and no ' +
        'migration — and `endora generate`, `migrate`, every `module:*` command and the API ' +
        'at boot each refuse one. Keep small state in Settings; a module ' +
        'that owns a table is a module package.',
    ],
    [
      input.tenantScope !== undefined,
      '--tenant-scope: it chooses the decorator on an emitted entity, and an overlay module ' +
        'contributes no schema.',
    ],
    [
      input.admin !== undefined,
      '--admin: an admin screen is the `./admin` layer of a module package, which the ' +
        "instance's admin registry is generated from. An overlay module is in no registry.",
    ],
    [
      (input.actions ?? []).length > 0,
      '--action: a command-palette action opens an admin screen, and an overlay module has ' +
        'none to open.',
    ],
    [
      input.ports === true,
      '--ports: a published `./ports` subpath is a module package\'s `exports` entry.',
    ],
    [
      input.worker === true,
      '--worker: register one by hand with `ctx.worker(...)` in the emitted backend.ts — the ' +
        'context it receives is the whole `ModuleContext`.',
    ],
    [
      input.subscriber === true,
      '--subscriber: register one by hand with `ctx.subscribe(...)` in the emitted backend.ts ' +
        '— the context it receives is the whole `ModuleContext`.',
    ],
    [
      input.dir !== undefined,
      `--dir: an overlay module is discovered in one place, ${modulesRoot}/<id>/, and one ` +
        `written anywhere else is never composed.`,
    ],
    [
      input.scope !== undefined,
      '--scope: an overlay module is not a package and has no npm name.',
    ],
  ];
  const hit = refusals.filter(([asked]) => asked).map(([, why]) => why);
  if (hit.length === 0) return;
  throw new ScaffoldInputError(
    `inside an instance, \`endora new module\` writes an overlay module under ` +
      `${modulesRoot}/, and ${hit.length === 1 ? 'one flag asks' : 'these flags ask'} for ` +
      `something an overlay module cannot be:\n` +
      `${hit.map((why) => `  - ${why}`).join('\n')}\n` +
      `Nothing is written.`,
  );
}

export interface OverlayModuleOptions extends ScaffoldInput {
  readonly dir?: string | undefined;
  readonly scope?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface OverlayModulePlan {
  readonly spec: ModuleScaffoldSpec;
  readonly deployment: string;
  /** Absolute. */
  readonly moduleDir: string;
  readonly files: readonly EmittedFile[];
  readonly nextSteps: readonly string[];
}

/**
 * Everything the run decides, before anything is written.
 *
 * The dependency list is the author's plus the two the emitted code needs:
 * `settings`, which stores the on/off switch the manifest declares, and `auth`,
 * which owns the `requireAdmin` gate an emitted admin route is behind. Each is
 * checked against what this instance actually installed — a dependency nothing
 * provides is refused here rather than by `module:install` three commands
 * later.
 */
export function planOverlayModule(
  host: OverlayHost,
  options: OverlayModuleOptions,
): OverlayModulePlan {
  const { deployment, selected } = resolveDeployment(host);
  const modulesRoot = join(host.root, 'apps', deployment, 'modules');
  const shownRoot = relative(host.root, modulesRoot).split(sep).join('/');
  refuseWhatAnOverlayCannotBe(options, shownRoot);

  const needed = [
    ...(options.nonDeactivatable === undefined ? ['settings'] : []),
    ...((options.permissions ?? []).length > 0 ? ['auth'] : []),
  ];
  const spec = buildScaffoldSpec({
    ...options,
    dependencies: [...new Set([...(options.dependencies ?? []), ...needed])],
  });

  const installed = installedModulePackages(host.root);
  const overlaySiblings = directoriesUnder(modulesRoot);
  const holder = installed.find((pkg) => pkg.moduleId === spec.id);
  if (holder !== undefined) {
    throw new ScaffoldInputError(
      `"${spec.id}" is already the module id of ${holder.name}, which this instance installed. ` +
        `A module id is identity of record for the lifecycle registry, the settings namespace ` +
        `and every permission code, so it cannot be claimed twice — the platform refuses the ` +
        `collision at boot. Choose another id. Nothing is written.`,
    );
  }
  const moduleDir = join(modulesRoot, spec.id);
  if (existsSync(moduleDir) && statSync(moduleDir).isDirectory() && readdirSync(moduleDir).length > 0) {
    throw new ScaffoldInputError(
      `${moduleDir} exists and is not empty (${readdirSync(moduleDir).slice(0, 5).join(', ')}). ` +
        `This command never merges into a directory: it is not idempotent over an existing ` +
        `module, and pretending otherwise would silently discard hand-written code.`,
    );
  }
  const known = new Set([...installed.map((pkg) => pkg.moduleId), ...overlaySiblings]);
  const missing = spec.dependencies.filter((dependency) => !known.has(dependency));
  if (missing.length > 0) {
    throw new ScaffoldInputError(
      `this module depends on ${missing.map((id) => `"${id}"`).join(', ')}, and this instance ` +
        `has installed no module with ${missing.length === 1 ? 'that id' : 'those ids'}` +
        `${
          missing.some((id) => needed.includes(id))
            ? ' (`settings` stores the on/off switch the manifest declares; `auth` owns the ' +
              'gate an admin route is behind)'
            : ''
        }. A dependency nothing provides is refused by \`module:install\`. Install the ` +
        `package that ships it (\`pnpm add -w -E <package>@<version>\` in the instance's root, ` +
        `at the version its other platform packages are pinned at, then \`pnpm run migrate\` and ` +
        `\`pnpm run module:install\`), or drop the dependency. Nothing is written.`,
    );
  }

  const files: EmittedFile[] = [
    { path: 'manifest.ts', content: overlayManifest(spec, host.scope) },
    { path: 'backend.ts', content: overlayBackend(spec, host.scope) },
    { path: 'i18n/en.json', content: overlayBundle(spec) },
    { path: 'i18n/pl.json', content: overlayBundle(spec) },
  ];

  const where = `${shownRoot}/${spec.id}`;
  const publicRoute = `/api/v1/${slugOf(spec.id)}`;
  const nextSteps: string[] = [
    ...(selected
      ? []
      : [
          `add DEPLOYMENT=${deployment} to the .env in this instance's root. The instance ` +
            `composes overlay modules from the directory that variable names, and it is not ` +
            `set: without it nothing fails, and this module is simply not there.`,
        ]),
    ...(host.declaresContracts
      ? []
      : [
          `pnpm add -w ${host.scope}contracts@"$(node -p "require('./node_modules/${host.scope}platform/package.json').dependencies['${host.scope}contracts']")" ` +
            `— the emitted manifest.ts imports it and this instance does not declare it, so ` +
            `every command would stop on ERR_MODULE_NOT_FOUND. The part in $(…) prints the ` +
            `exact version the installed platform pins.`,
        ]),
    `pnpm run module:install ${spec.id} — creates the module's settings and loads its ` +
      `translations. \`pnpm run module:status\` shows it as not-installed until then.`,
    ...(spec.permissions.length === 0
      ? []
      : [
          `translate ${where}/i18n/pl.json — both shipped languages carry the same keys, and ` +
            `its values are your English text because a translation is a human judgement.`,
        ]),
    `pnpm run generate — records what this deployment now does differently from the platform ` +
      `in apps/${deployment}/divergence.generated.md. Commit it. As written the module reaches ` +
      `into nothing, so the run is clean; once it resolves a port or decorates a service the ` +
      `command asks for one sentence in apps/${deployment}/divergence.ts, and exits 1 until ` +
      `it has one.`,
    `pnpm run start (or pnpm run dev:all), then GET ${publicRoute} — the route the emitted ` +
      `backend.ts registers. Nothing compiles that file: Node strips its types as it loads ` +
      `it, so keep to plain TypeScript — no \`enum\`, no \`namespace\`, no constructor ` +
      `parameter property.`,
  ];

  return { spec, deployment, moduleDir, files, nextSteps };
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function overlayManifest(spec: ModuleScaffoldSpec, scope: string): string {
  const lines: string[] = [];
  const withSettings = spec.activation.kind === 'setting';
  lines.push(
    withSettings
      ? `import { defineModuleManifest, defineModuleSettingsManifest } from '${scope}contracts';`
      : `import { defineModuleManifest } from '${scope}contracts';`,
  );
  lines.push('');
  if (spec.activation.kind === 'setting') {
    lines.push('// The Settings this module owns. The first is its on/off switch, which');
    lines.push('// `activation` below points at; add your own beside it — the admin renders a');
    lines.push('// field for each one, with no screen written by you.');
    lines.push('const settings = defineModuleSettingsManifest({');
    lines.push(`  moduleCode: ${quote(spec.id)},`);
    lines.push(`  groups: [{ code: ${quote(spec.id)}, name: ${quote(spec.name)} }],`);
    lines.push('  settings: [');
    lines.push('    {');
    lines.push(`      code: ${quote(spec.activation.settingCode)},`);
    lines.push(`      name: ${quote(`${spec.name} enabled`)},`);
    lines.push('      description:');
    lines.push(
      `        ${quote(
        `Switches the ${spec.name} module on or off as a whole. Nothing is deleted: its data is kept and comes back when you switch the module on again.`,
      )},`,
    );
    lines.push(`      groupCode: ${quote(spec.id)},`);
    lines.push(`      valueType: 'boolean',`);
    lines.push('      defaultValue: true,');
    lines.push('    },');
    lines.push('  ],');
    lines.push('});');
    lines.push('');
  }
  lines.push('/**');
  lines.push(` * ${spec.name} — an overlay module of this deployment.`);
  lines.push(' *');
  lines.push(' * The `id` below must equal this directory\'s name: it is the module\'s identity');
  lines.push(' * of record for the lifecycle registry, its settings and its permission codes.');
  lines.push(' */');
  lines.push('export const manifest = defineModuleManifest({');
  lines.push(`  id: ${quote(spec.id)},`);
  lines.push(`  name: ${quote(spec.name)},`);
  lines.push(`  description: ${quote(spec.description)},`);
  lines.push(`  version: '1.0.0',`);
  lines.push('  // Every module this one needs. A module whose port you resolve belongs here.');
  lines.push(`  dependencies: [${spec.dependencies.map(quote).join(', ')}],`);
  if (withSettings) lines.push('  settings,');
  lines.push(`  i18n: { bundlesDir: 'i18n' },`);
  if (spec.permissions.length > 0) {
    lines.push('  // Every code a `requireAdmin(...)` in backend.ts enforces, so a role can be');
    lines.push('  // granted it. The label an operator reads is the');
    lines.push('  // `adminRoles.permission.<code>` key in this module\'s own bundles.');
    lines.push('  permissions: [');
    for (const permission of spec.permissions) {
      lines.push(`    { code: ${quote(permission.code)}, label: ${quote(permission.label)} },`);
    }
    lines.push('  ],');
  }
  if (spec.activation.kind === 'setting') {
    lines.push('  // A module that is off behaves as if it were never installed; off deletes');
    lines.push('  // nothing and is reversible.');
    lines.push(
      `  activation: { settingCode: ${quote(spec.activation.settingCode)}, default: true },`,
    );
  } else {
    lines.push('  // The platform refuses to switch this module off or uninstall it.');
    lines.push(
      `  activation: { nonDeactivatable: true, reason: ${quote(spec.activation.reason)} },`,
    );
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

function overlayBackend(spec: ModuleScaffoldSpec, scope: string): string {
  const gate = gatingPermissionOf(spec);
  const slug = slugOf(spec.id);
  const cradle = `${pascalOf(spec.id)}Cradle`;
  const lines: string[] = [];
  lines.push(
    gate === null
      ? `import type { ModuleContext } from '${scope}platform/kernel';`
      : `import type { ModuleContext, RequireAdminFactory } from '${scope}platform/kernel';`,
  );
  lines.push('');
  lines.push('// Nothing in an instance compiles this file: Node loads it and strips the types');
  lines.push('// as it goes. So it is written in the subset stripping accepts — an `enum`, a');
  lines.push('// `namespace` or a constructor parameter property stops the start with');
  lines.push('// ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. A union of string literals is the `enum`');
  lines.push('// you want.');
  lines.push('');
  if (gate !== null) {
    lines.push(`interface ${cradle} {`);
    lines.push('  readonly requireAdmin: RequireAdminFactory;');
    lines.push('}');
    lines.push('');
  }
  lines.push('/** The module\'s one entry point. The platform calls it once, at start. */');
  lines.push('export function registerModule(ctx: ModuleContext): void {');
  lines.push('  // Routes registered through `ctx.routes` answer 503 while the module is off,');
  lines.push('  // which is what makes the operator\'s switch real. `app` is a Fastify instance.');
  lines.push('  ctx.routes(async (app) => {');
  lines.push(`    app.get(${quote(`/api/v1/${slug}`)}, async () => ({`);
  lines.push(`      data: { module: ${quote(spec.id)} },`);
  lines.push('    }));');
  if (gate !== null) {
    lines.push('');
    lines.push('    // Gated by a permission the manifest declares. The code must match exactly.');
    lines.push('    app.get(');
    lines.push(`      ${quote(`/api/v1/admin/${slug}`)},`);
    lines.push(
      `      { preHandler: ctx.cradle<${cradle}>().requireAdmin(${quote(gate.code)}) },`,
    );
    lines.push(`      async () => ({ data: { module: ${quote(spec.id)} } }),`);
    lines.push('    );');
  }
  lines.push('  });');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/** A flat `key: text` map; the Polish file starts as the English text. */
function overlayBundle(spec: ModuleScaffoldSpec): string {
  const entries = Object.fromEntries(
    spec.permissions.map((permission) => [
      `adminRoles.permission.${permission.code}`,
      permission.label,
    ]),
  );
  return `${JSON.stringify(entries, null, 2)}\n`;
}
