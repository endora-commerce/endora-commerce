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
 *   * **schema without an entity** (`--tenant-scope` alone). The scope picks
 *     the decorator on the entity `--entities` emits; with no `--entities`
 *     there is nothing for it to decorate. `--entities` itself is honoured
 *     since #1852 (`specs/190-overlay-full-modules/` FR-055): an overlay module
 *     may own a table since D-297, so it gets the package scaffold's entity —
 *     legacy decorators, exactly one tenancy decorator — under `entities/`, the
 *     `entities` export the platform registers it by, and a first migration
 *     named by `../lib/migration-naming.ts`.
 *   * **a worker or a subscriber** (`--worker`, `--subscriber`). Both are one
 *     call on the context the emitted `registerModule` already receives, and the
 *     refusal says which — the package scaffold's emitted worker is three files
 *     and a build, none of which an overlay has.
 *
 * `--ports` is honoured since #1854 (FR-059): the module gets a `ports.ts` holding
 * its port interface and a `ctx.di.providePort` call in `backend.ts`. `ports.ts` is
 * the one file a sibling overlay module may `import type`
 * (`specs/190-overlay-full-modules/contracts/overlay-ports.md` §2) — the overlay
 * spelling of a package's type-only `./ports` subpath.
 *
 * `--admin` and `--action` are honoured since #1855 (FR-059): an overlay module's
 * `admin/index.tsx` is in its deployment's admin registry, so it gets the package
 * scaffold's screen at that fixed path, and `--action` the manifest's palette entry,
 * gated by the module's first permission on the route the emitted `backend.ts`
 * registers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parseEnvFile } from '../inputs/env-file.js';
import { installedModulePackages } from '../lib/module-packages.js';
import {
  adminPage,
  bundleEntries,
  entityClassOf,
  entityFileOf,
  entitySource,
  initMigrationSource,
  migrationFileOf,
  portInterfaceOf,
  portNameOf,
  type EmittedFile,
} from './emit.js';
import { MANIFEST_GENERATOR, findRepoRoot } from './host.js';
import {
  adminApiPathFor,
  adminRoutesOf,
  adminScreenRouteOf,
  buildScaffoldSpec,
  camelOfActionId,
  gatingPermissionOf,
  navLabelKeyOf,
  pageComponentOf,
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

export function directoriesUnder(path: string): readonly string[] {
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
export function resolveDeployment(
  host: Pick<OverlayHost, 'root'>,
): { deployment: string; selected: boolean } {
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
      input.tenantScope !== undefined && input.entities !== true,
      '--tenant-scope: it chooses the tenancy decorator on the entity `--entities` emits, and ' +
        'without `--entities` there is no entity to decorate. Pass both, or neither.',
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

  const files = emitOverlayModuleFiles(spec, host.scope);

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
    ...(spec.layers.entities
      ? [
          `pnpm run build — compiles ${where}/ into backend/dist; the entity's decorators are ` +
            `the one thing in it that needs a compiler, and the platform reads the module's ` +
            `entities and migrations from there.`,
          `pnpm run migrate — creates its table. The next migration is \`endora new migration ` +
            `${spec.id} --name <slug>\`; the platform reads ${where}/migrations/ file by file.`,
        ]
      : []),
    `pnpm run module:install ${spec.id} — creates the module's settings and loads its ` +
      `translations. \`pnpm run module:status\` shows it as not-installed until then.`,
    ...(spec.layers.ports
      ? [
          `a sibling overlay module of this deployment consumes the port with ` +
            `\`import type { ${portInterfaceOf(spec)} } from '../${spec.id}/ports.js'\` and ` +
            `\`lazyPort<${portInterfaceOf(spec)}>(ctx, '${portNameOf(spec)}')\`, and lists ` +
            `\`${spec.id}\` in its manifest \`dependencies\`. \`pnpm run generate\` reports any ` +
            `other import between overlay modules.`,
        ]
      : []),
    ...(spec.permissions.length === 0
      ? []
      : [
          `translate ${where}/i18n/pl.json — both shipped languages carry the same keys, and ` +
            `its values are your English text because a translation is a human judgement.`,
        ]),
    ...(spec.layers.admin === null
      ? []
      : [
          `the admin screen is ${adminScreenRouteOf(spec) ?? ''}, in ${where}/admin/. \`pnpm run ` +
            `generate\` puts it in admin/src/deployments/${deployment}.generated.ts, and the admin ` +
            `built with DEPLOYMENT=${deployment} shows it.` +
            (spec.actions.length > 0
              ? ''
              : ` It has no command-palette action yet, so \`pnpm run generate\` exits 1 until ` +
                `manifest.ts declares one — scaffold with \`--action <id>=${adminScreenRouteOf(spec) ?? '/'}\` ` +
                `or add an \`actions\` entry by hand.`),
        ]),
    spec.layers.ports
      ? `pnpm run generate — records what this deployment now does differently from the ` +
        `platform in apps/${deployment}/divergence.generated.md. Commit it. The module ` +
        `publishes a port, so the command asks for one sentence saying why, under ` +
        `reasons['port-provided:${spec.id}:${portNameOf(spec)}'] in ` +
        `apps/${deployment}/divergence.ts, and exits 1 until it has one.`
      : `pnpm run generate — records what this deployment now does differently from the ` +
        `platform in apps/${deployment}/divergence.generated.md. Commit it. As written the ` +
        `module reaches into nothing, so the run is clean; once it resolves a port or ` +
        `decorates a service the command asks for one sentence in ` +
        `apps/${deployment}/divergence.ts, and exits 1 until it has one.`,
    `pnpm run start (or pnpm run dev:all), then GET ${publicRoute} — the route the emitted ` +
      `backend.ts registers. The instance builds it under \`erasableSyntaxOnly\`, so keep to ` +
      `plain TypeScript — no \`enum\`, no \`namespace\`, no constructor parameter property.`,
  ];

  return { spec, deployment, moduleDir, files, nextSteps };
}

/**
 * Every file an overlay module is written as, in the order they are written —
 * a pure function of the specification and the instance's npm scope.
 *
 * With `--entities`, the entity and its first migration are the package
 * scaffold's own (`emit.ts`), at an overlay's paths: `entities/` and
 * `migrations/` beside `manifest.ts`, and no `migrations/index.ts` — an overlay's
 * migrations are read file by file (`overlay-schema-discovery.md` §1).
 */
export function emitOverlayModuleFiles(
  spec: ModuleScaffoldSpec,
  scope: string,
): readonly EmittedFile[] {
  return [
    { path: 'manifest.ts', content: overlayManifest(spec, scope) },
    { path: 'backend.ts', content: overlayBackend(spec, scope) },
    ...(spec.layers.ports ? [{ path: 'ports.ts', content: overlayPorts(spec) }] : []),
    ...(spec.layers.entities
      ? [
          { path: `entities/${entityFileOf(spec)}`, content: entitySource(spec, scope) },
          { path: `migrations/${migrationFileOf(spec)}`, content: initMigrationSource(spec) },
        ]
      : []),
    ...(spec.layers.admin === null
      ? []
      : [
          { path: 'admin/index.tsx', content: overlayAdminIndex(spec, scope) },
          {
            path: `admin/pages/${pageComponentOf(spec)}.tsx`,
            content: adminPage(spec).replaceAll("'@endora-commerce/", `'${scope}`),
          },
        ]),
    { path: 'i18n/en.json', content: overlayBundle(spec) },
    { path: 'i18n/pl.json', content: overlayBundle(spec) },
  ];
}

/**
 * `admin/index.tsx` — the overlay module's admin contributions, at the fixed
 * path its deployment's admin registry imports (`overlay-module-layout.md` §2).
 * The same object a package's `./admin` layer exports: one landing route, one
 * sidebar entry in the chosen section, both gated by the module's first
 * permission, the screen a dynamic-import factory.
 */
function overlayAdminIndex(spec: ModuleScaffoldSpec, scope: string): string {
  const gate = gatingPermissionOf(spec);
  const route = adminScreenRouteOf(spec);
  const section = spec.layers.admin;
  if (gate === null || route === null || section === null) {
    throw new Error('overlayAdminIndex emitted without a gated route to mount the screen on');
  }
  return [
    `import type { AdminContributions } from '${scope}admin-kit/contributions';`,
    '',
    '/**',
    ` * ${spec.name} — the module's admin surface.`,
    ' *',
    ' * `pnpm run generate` imports this object into the admin registry of this',
    ' * deployment, `admin/src/deployments/<deployment>.generated.ts`, and an admin built',
    ' * with that `DEPLOYMENT` renders it. Export the object and nothing else, and keep',
    ' * every screen a `() => import(…)` factory: the registry then costs the',
    ' * declarations and none of the screens.',
    ' */',
    '',
    "/** The one route this module mounts, and the palette action's target. */",
    `const ROUTE_PATH = ${quote(route)};`,
    '',
    'export const contributions: AdminContributions = {',
    '  routes: [',
    '    {',
    '      path: ROUTE_PATH,',
    `      component: () => import('./pages/${pageComponentOf(spec)}.js'),`,
    `      // The code backend.ts gates \`${adminApiPathFor(route)}\` on.`,
    `      requiredPermission: ${quote(gate.code)},`,
    '      index: true,',
    '    },',
    '  ],',
    '  nav: [',
    '    {',
    '      to: ROUTE_PATH,',
    "      // Resolved in this module's own i18n namespace, out of i18n/en.json and pl.json.",
    `      labelKey: ${quote(navLabelKeyOf(spec))},`,
    `      icon: ${quote(spec.icon)},`,
    `      section: ${quote(section)},`,
    '      weight: 100,',
    `      requiredPermission: ${quote(gate.code)},`,
    '    },',
    '  ],',
    '};',
    '',
  ].join('\n');
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
  if (spec.actions.length > 0) {
    lines.push('  // Principle XVI: every admin screen is reachable from the command palette');
    lines.push('  // (⌘K / CTRL+K). The label and description are keys in i18n/en.json and');
    lines.push("  // pl.json; the code is the one backend.ts gates the target's API on.");
    lines.push('  actions: [');
    spec.actions.forEach((action, index) => {
      const key = camelOfActionId(action.id);
      lines.push('    {');
      lines.push(`      id: ${quote(action.id)},`);
      lines.push(`      labelKey: ${quote(`actions.${key}.label`)},`);
      lines.push(`      descriptionKey: ${quote(`actions.${key}.description`)},`);
      lines.push(`      icon: ${quote(spec.icon)},`);
      lines.push(`      targetRoute: ${quote(action.route)},`);
      lines.push(`      requiredPermission: ${quote(gatingPermissionOf(spec)?.code ?? '')},`);
      lines.push(`      keywords: [${quote(spec.name.toLowerCase())}],`);
      lines.push(`      weight: ${String(100 + index)},`);
      lines.push('    },');
    });
    lines.push('  ],');
  }
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
  if (spec.layers.ports) {
    lines.push(`import type { ${portInterfaceOf(spec)} } from './ports.js';`);
  }
  if (spec.layers.entities) {
    lines.push(
      `import { ${entityClassOf(spec)} } from './entities/${entityFileOf(spec).replace(/\.ts$/, '.js')}';`,
    );
  }
  lines.push('');
  lines.push('// The instance compiles this module under `erasableSyntaxOnly`');
  lines.push('// (backend/tsconfig.apps.json), so it is written in the subset that flag');
  lines.push('// accepts: an `enum`, a `namespace` or a constructor parameter property is');
  lines.push('// refused by `pnpm run typecheck` and `pnpm run build`. A union of string');
  lines.push('// literals is the `enum` you want.');
  lines.push('');
  if (spec.layers.entities) {
    lines.push('/**');
    lines.push(' * Every entity this module owns — what the platform registers with the ORM for it.');
    lines.push(' * A class under `entities/` that is not listed here is refused at start.');
    lines.push(' */');
    lines.push(`export const entities = [${entityClassOf(spec)}];`);
    lines.push('');
  }
  if (gate !== null) {
    lines.push(`interface ${cradle} {`);
    lines.push('  readonly requireAdmin: RequireAdminFactory;');
    lines.push('}');
    lines.push('');
  }
  lines.push('/** The module\'s one entry point. The platform calls it once, at start. */');
  lines.push('export function registerModule(ctx: ModuleContext): void {');
  if (spec.layers.ports) {
    lines.push('  // The one name another module may resolve. `providePort` registers it behind');
    lines.push('  // this module\'s own on/off state: a consumer calling it while this module is');
    lines.push('  // off gets the 503 MODULE_DISABLED answer at the call site.');
    lines.push('  //');
    lines.push('  // A sibling overlay module reaches it with');
    lines.push(`  // \`lazyPort<${portInterfaceOf(spec)}>(ctx, ${quote(portNameOf(spec))})\`, imports the type`);
    lines.push('  // with `import type` from this module\'s ports.ts and declares this module in');
    lines.push('  // its manifest `dependencies`.');
    lines.push(`  ctx.di.providePort<${portInterfaceOf(spec)}>(`);
    lines.push(`    ${quote(portNameOf(spec))},`);
    lines.push('    ctx');
    lines.push('      .asFunction(() => ({');
    lines.push(`        status: () => ({ module: ${quote(spec.id)}, name: ${quote(spec.name)} }),`);
    lines.push('      }))');
    lines.push('      .singleton(),');
    lines.push('  );');
    lines.push('');
  }
  lines.push('  // Routes registered through `ctx.routes` answer 503 while the module is off,');
  lines.push('  // which is what makes the operator\'s switch real. `app` is a Fastify instance.');
  lines.push('  ctx.routes(async (app) => {');
  lines.push(`    app.get(${quote(`/api/v1/${slug}`)}, async () => ({`);
  lines.push(`      data: { module: ${quote(spec.id)} },`);
  lines.push('    }));');
  if (gate !== null) {
    // One gated read per admin route: the module's own `/<slug>` with no
    // `--action`, else each action's target — `/api/v1/admin` + the route is the
    // entry `check:action-route-permissions` compares an action's code against.
    for (const route of adminRoutesOf(spec)) {
      lines.push('');
      lines.push('    // Gated by a permission the manifest declares. The code must match exactly.');
      lines.push('    app.get(');
      lines.push(`      ${quote(adminApiPathFor(route))},`);
      lines.push(
        `      { preHandler: ctx.cradle<${cradle}>().requireAdmin(${quote(gate.code)}) },`,
      );
      lines.push(
        `      async () => ({ data: { module: ${quote(spec.id)}, name: ${quote(spec.name)} } }),`,
      );
      lines.push('    );');
    }
  }
  lines.push('  });');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/**
 * `ports.ts` — the port's types, and the one file a sibling overlay module may import.
 *
 * The package scaffold's `./ports` with the `status()` shape whatever the layers: an
 * overlay module has no service layer for a `list()` port to delegate to.
 */
function overlayPorts(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  return `/**
 * ${spec.name} — the port other overlay modules of this deployment resolve.
 *
 * **This is the only file of the module another overlay module may import, and only
 * with \`import type\`.** \`pnpm run generate\` reports any other import between two
 * overlay modules — a value import, another file, another deployment, or a module
 * that does not declare this one in its manifest \`dependencies\`. A value written
 * here for this module's own use is therefore never evaluated by a consumer.
 *
 * The container name is part of the contract: this interface is registered under
 * \`${portNameOf(spec)}\`, and a consumer writes
 * \`lazyPort<${portInterfaceOf(spec)}>(ctx, '${portNameOf(spec)}')\`.
 *
 * No method here is optional: the resolution proxy answers every property with a
 * function, so \`if (port.maybe)\` is always true.
 */

/** What this module reports about itself. */
export interface ${pascal}Status {
  readonly module: string;
  readonly name: string;
}

export interface ${portInterfaceOf(spec)} {
  status(): ${pascal}Status;
}
`;
}

/**
 * A flat `key: text` map; the Polish file starts as the English text. The
 * package scaffold's keys — permission labels, palette actions, the sidebar
 * entry and the screen — less `module.*`, which an overlay module's manifest
 * carries as its `name` and `description`.
 */
function overlayBundle(spec: ModuleScaffoldSpec): string {
  const entries = Object.fromEntries(
    bundleEntries(spec).filter(([key]) => !key.startsWith('module.')),
  );
  return `${JSON.stringify(entries, null, 2)}\n`;
}
