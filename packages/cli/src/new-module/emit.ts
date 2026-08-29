/**
 * What `endora new module` writes (`contracts/module-scaffold-output.md` §1).
 *
 * The template is **code that composes files**, not a directory of files with
 * placeholders (`research.md` §7): most of what a module package holds is
 * conditional on the author's answers, and a placeholder language inside `.ts`
 * files is a language neither `tsc` nor `eslint` can read. What is emitted here
 * is ordinary source, compiled by this package's own build and asserted by tests
 * over the real output.
 *
 * **`package.json` is not in this file, deliberately.** It has an author
 * already — the platform's manifest generator — and a second one is D-100's
 * subject. See `manifest-render.ts`.
 */
import {
  adminApiPathFor,
  adminRoutesOf,
  camelOf,
  camelOfActionId,
  gatingPermissionOf,
  manifestObjectFor,
  pascalOf,
  segmentOf,
  slugOf,
  TENANT_SCOPE_DECORATORS,
  type ModuleScaffoldSpec,
} from './spec.js';
import { flatJson, quote, rootPrefixFor } from './text.js';

/** One file the command writes: a package-relative path and its whole content. */
export interface EmittedFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Every file except `package.json`, in the order they are written.
 *
 * `depth` is how far the target directory sits below the checkout root, which is
 * what the two tsconfigs' `extends` and the vitest configuration's base import
 * are relative to. It is passed in rather than computed here so the emitter
 * stays a pure function of the specification plus that one fact.
 */
export function emitModuleFiles(spec: ModuleScaffoldSpec, depth: number): readonly EmittedFile[] {
  const files: EmittedFile[] = [
    { path: 'tsconfig.json', content: typecheckConfig(depth) },
    { path: 'tsconfig.build.json', content: buildConfig() },
    { path: 'vitest.config.ts', content: vitestConfig(spec, depth) },
    { path: 'src/manifest.ts', content: moduleManifest(spec) },
    { path: 'src/backend/index.ts', content: backendIndex(spec) },
    { path: `src/backend/services/${slugOf(spec.id)}.service.ts`, content: service(spec) },
  ];
  if (spec.permissions.length > 0) {
    files.push({ path: 'src/backend/routes.admin.ts', content: adminRoutes(spec) });
  }
  if (spec.layers.entities) {
    files.push({ path: `src/backend/entities/${entityFileOf(spec)}`, content: entity(spec) });
    files.push({ path: `src/migrations/${migrationFileOf(spec)}`, content: migration(spec) });
    files.push({ path: 'src/migrations/index.ts', content: migrationsIndex(spec) });
  }
  if (spec.layers.worker) {
    files.push({ path: `src/backend/workers/${slugOf(spec.id)}.worker.ts`, content: worker(spec) });
  }
  if (spec.layers.ports) {
    files.push({ path: 'src/ports/index.ts', content: ports(spec) });
  }
  files.push({ path: 'i18n/en.json', content: bundle(spec) });
  files.push({ path: 'i18n/pl.json', content: bundle(spec) });
  files.push({ path: 'test/unit/manifest.test.ts', content: manifestTest(spec) });
  return files;
}

/** `QuickOrderItem` — the module's own aggregate, when it owns one. */
export function entityClassOf(spec: ModuleScaffoldSpec): string {
  return `${pascalOf(spec.id)}Item`;
}

/** `quick_order_items` — the table that entity maps, owned by this module alone. */
export function tableNameOf(spec: ModuleScaffoldSpec): string {
  return `${segmentOf(spec.id)}_items`;
}

export function entityFileOf(spec: ModuleScaffoldSpec): string {
  return `${slugOf(spec.id)}-item.entity.ts`;
}

/**
 * `<stamp>_<segment>_init.ts` — the filename
 * `specs/065-manifest-aware-migrations/contracts/naming-convention.md` §1
 * recognises, with the tail beginning at the owning module's segment so the
 * class name derived from it is scoped (feature 081, `unscoped-name`).
 */
export function migrationFileOf(spec: ModuleScaffoldSpec): string {
  return `${spec.migrationStamp}_${segmentOf(spec.id)}_init.ts`;
}

/** `Migration<STAMP><PascalCaseTail>` — §2's mechanical derivation from the filename. */
export function migrationClassOf(spec: ModuleScaffoldSpec): string {
  const tail = `${segmentOf(spec.id)}_init`
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `Migration${spec.migrationStamp}${tail}`;
}

/** `<Pascal>ReadPort` — the interface `./ports` publishes when the module owns one. */
export function portInterfaceOf(spec: ModuleScaffoldSpec): string {
  return `${pascalOf(spec.id)}ReadPort`;
}

/** `<camel>ReadPort` — the container name that interface is registered under. */
export function portNameOf(spec: ModuleScaffoldSpec): string {
  return `${camelOf(spec.id)}ReadPort`;
}

// --- the two build configurations, a constant of the layout ----------------

function typecheckConfig(depth: number): string {
  return `{
  // Type-check configuration, and the two-config split every package under
  // \`packages/\` uses. \`tsconfig.base.json\`'s \`paths\` block is active here, so
  // \`@endora-commerce/contracts\` resolves at its *source* and this package
  // type-checks against the branch it is on (issue #255). \`noEmit\` is set for
  // that reason: with \`paths\` active an emit would land beside another
  // package's source. The emitting configuration is \`tsconfig.build.json\`.
  //
  // \`@endora-commerce/platform\` is deliberately **not** in that \`paths\` block
  // and is resolved here through its own \`exports\` map, at its built \`.d.ts\`.
  // That is the same resolution the running application gets, which is what
  // keeps one copy of \`HttpError\`, \`SalesChannel\` and \`effectiveState\` in the
  // process. This package is refused a \`paths\` entry for its own sources on the
  // same grounds, one step sharper: \`paths\` is honoured by \`tsx\` and not by
  // \`node\`, so an entry would make a \`tsx\` process load this package's sources
  // rather than its \`dist\`, which is the split D-164 measured killing a
  // decorated entity.
  "extends": "${rootPrefixFor(depth)}/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  // A co-located test must not be compiled into \`dist\`: it imports \`vitest\`, a
  // devDependency, which is an unresolvable specifier in every consumer's
  // install. That is this exclusion's whole job, and it is an *emit* concern —
  // \`tsconfig.build.json\` extends this file, which is how it gets there. It
  // does not stop those tests running: \`vitest\` reads its own \`include\` and
  // transpiles what it collects.
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"]
}
`;
}

function buildConfig(): string {
  return `{
  // Emit configuration — the only configuration in this package allowed to
  // write files, and the declaration the platform's composer reads to learn
  // where this package's sources end up.
  //
  // \`paths\` is cleared, so \`@endora-commerce/contracts\` resolves through its
  // own \`exports\` map to its built \`.d.ts\`. \`rootDir\` with an active \`paths\`
  // block is the TS6059 trap: \`tsc\` reports the sibling's source as outside
  // \`rootDir\`, exits 2, and emits that sibling's \`.js\`/\`.d.ts\` beside its
  // source anyway.
  //
  // The artefact format is the package format, not a per-package judgement
  // (D-164): the manifest generator derives every \`exports\` target from this
  // file's \`rootDir\`/\`outDir\`, so a source-shipping module package is not
  // expressible, and a package that shipped source would be the one whose
  // specifiers resolved differently under \`tsx\` than under \`node\`.
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "paths": {},
    "rootDir": "./src",
    "noEmit": false,
    // A compile that failed must ship nothing. Without this a diagnostic is not
    // a stop — the artefacts are written before the exit code is.
    "noEmitOnError": true
  }
}
`;
}

function vitestConfig(spec: ModuleScaffoldSpec, depth: number): string {
  return `// This module package's own test run.
//
// Two things here are load-bearing rather than boilerplate:
//
//   * **\`mergeConfig(baseConfig, …)\`** — the base is the one file every
//     workspace's vitest configuration merges, and it is where issue #255's
//     foreign-workspace-link refusal lives. A configuration that skipped it
//     would let this package's run execute *another checkout's* sources while
//     reporting on this branch.
//   * **no \`--passWithNoTests\`, anywhere** — neither here nor in the generated
//     \`test\` script. A run that collects zero files from a package that ships
//     them must exit non-zero.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '${rootPrefixFor(depth)}/vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: ${quote(`mod-${slugOf(spec.id)}`)},
      environment: 'node',
      // Both roots the layout contract allows: co-located beside the source,
      // and the package-owned \`test/unit/\` tree.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  }),
);
`;
}

// --- src/manifest.ts -------------------------------------------------------

function moduleManifest(spec: ModuleScaffoldSpec): string {
  const manifest = manifestObjectFor(spec);
  const lines: string[] = [];
  lines.push(`import { defineModuleManifest } from '@endora-commerce/contracts';`);
  lines.push('');
  lines.push('/**');
  lines.push(` * ${spec.name} — module manifest.`);
  lines.push(' *');
  lines.push(' * The root export of a module package, and the module\'s identity of record: the');
  lines.push(' * lifecycle registry, the settings store, every permission code and every');
  lines.push(' * migration owner key on the `id` below, which must equal this directory\'s name');
  lines.push(' * and the `endora.id` in `package.json`.');
  lines.push(' *');
  lines.push(' * `version` is **not** wired to `package.json`\'s. They are different facts: the');
  lines.push(' * package version is `0.0.0` for every package in this family, while this one is');
  lines.push(' * what the lifecycle registry stores and what the admin\'s `pending-upgrade` flag');
  lines.push(' * compares. Importing one into the other puts `0.0.0` in the registry and');
  lines.push(' * silently disables drift detection.');
  lines.push(' */');
  lines.push('export const manifest = defineModuleManifest({');
  lines.push(`  id: ${quote(spec.id)},`);
  lines.push(`  name: ${quote(spec.name)},`);
  lines.push(`  description: ${quote(spec.description)},`);
  lines.push(`  version: '1.0.0',`);
  if (spec.dependencies.length === 0) {
    lines.push('  // Every module whose port this one resolves belongs here: that is what makes');
    lines.push('  // the edge real to the lifecycle, to the migration order and to an operator');
    lines.push('  // switching the owner off.');
    lines.push('  dependencies: [],');
  } else {
    lines.push('  // A module whose port this one resolves belongs here. The declaration is');
    lines.push('  // what makes the edge real to the lifecycle, to the migration order and to');
    lines.push('  // an operator switching the owner off — `check:port-dependencies` refuses a');
    lines.push('  // `lazyPort` resolution the manifest does not declare.');
    lines.push('  dependencies: [');
    for (const dependency of spec.dependencies) lines.push(`    ${quote(dependency)},`);
    lines.push('  ],');
  }
  if (spec.activation.kind === 'setting') {
    lines.push('  // Constitution XVII — the operator activation axis. A module that is off');
    lines.push('  // behaves as if never installed; off is non-destructive and reversible.');
    lines.push(
      `  activation: { settingCode: ${quote(spec.activation.settingCode)}, default: true },`,
    );
  } else {
    lines.push('  // Constitution XVII — this module declares that the platform cannot run');
    lines.push('  // without it, so the orchestrator refuses to disable *or* uninstall it, and');
    lines.push('  // a composition that lacks it is refused before any module registers.');
    lines.push('  activation: {');
    lines.push('    nonDeactivatable: true,');
    lines.push(`    reason: ${quote(spec.activation.reason)},`);
    lines.push('  },');
  }
  lines.push(`  i18n: { bundlesDir: 'i18n' },`);
  if (manifest.permissions !== undefined) {
    lines.push('  // Every code a `requireAdmin(...)` literal in this module enforces, so it is');
    lines.push('  // grantable on /admin-roles. The label an operator reads is the');
    lines.push('  // `adminRoles.permission.<code>` key in this package\'s own bundles.');
    lines.push('  permissions: [');
    for (const permission of manifest.permissions) {
      lines.push('    {');
      lines.push(`      code: ${quote(permission.code)},`);
      lines.push(`      module: ${quote(permission.module ?? spec.id)},`);
      lines.push(`      label: ${quote(permission.label)},`);
      lines.push('    },');
    }
    lines.push('  ],');
  }
  if (manifest.actions !== undefined) {
    lines.push('  // Principle XVI — a module with an admin surface is discoverable under');
    lines.push('  // CTRL+K. `requiredPermission` is the code enforced on this action\'s own');
    lines.push('  // target route, so the palette never advertises a 403.');
    lines.push('  actions: [');
    for (const action of manifest.actions) {
      lines.push('    {');
      lines.push(`      id: ${quote(action.id)},`);
      lines.push(`      labelKey: ${quote(action.labelKey)},`);
      lines.push(`      descriptionKey: ${quote(action.descriptionKey ?? '')},`);
      lines.push(`      icon: ${quote(action.icon)},`);
      lines.push(`      targetRoute: ${quote(action.targetRoute)},`);
      lines.push(`      requiredPermission: ${quote(action.requiredPermission ?? '')},`);
      lines.push(`      keywords: [${action.keywords.map(quote).join(', ')}],`);
      lines.push(`      weight: ${String(action.weight)},`);
      lines.push('    },');
    }
    lines.push('  ],');
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// --- src/backend/index.ts --------------------------------------------------

function backendIndex(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  const camel = camelOf(spec.id);
  const cradleName = `${pascal}Cradle`;
  const serviceName = `${pascal}Service`;
  const hasRoutes = spec.permissions.length > 0;
  const registersDeferred = hasRoutes || spec.layers.worker;
  const lines: string[] = [];

  lines.push(`import type { ModuleContext } from '@endora-commerce/platform/kernel';`);
  if (hasRoutes) {
    lines.push(`import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';`);
  }
  if (spec.layers.entities) {
    lines.push(`import type { EntityManager } from '@mikro-orm/postgresql';`);
  }
  if (spec.layers.worker) {
    lines.push(`import type { Redis } from 'ioredis';`);
  }
  if (spec.layers.ports) {
    lines.push(`import type { ${portInterfaceOf(spec)} } from '../ports/index.js';`);
  }
  lines.push(`import { ${serviceName} } from './services/${slugOf(spec.id)}.service.js';`);
  if (hasRoutes) {
    lines.push(`import { register${pascal}AdminRoutes } from './routes.admin.js';`);
  }
  if (spec.layers.entities) {
    lines.push(
      `import { ${entityClassOf(spec)} } from './entities/${slugOf(spec.id)}-item.entity.js';`,
    );
  }
  if (spec.layers.worker) {
    lines.push(
      `import { create${pascal}Worker } from './workers/${slugOf(spec.id)}.worker.js';`,
    );
  }
  lines.push('');
  lines.push('/**');
  lines.push(` * ${spec.name} — composition (\`registerModule\`).`);
  lines.push(' *');
  lines.push(' * The kernel container composes this module; there is no composition root that');
  lines.push(' * constructs its services. Everything it owns is registered here, everything it');
  lines.push(' * borrows is resolved through a seam, and every seam applies the module gate, so');
  lines.push(' * an operator switching this module off stops its routes, its queue consumers and');
  lines.push(' * its subscriptions without a check written per call site.');
  lines.push(' */');
  lines.push('');
  lines.push('/** What this module resolves from the container, and the names it owns. */');
  lines.push(`export interface ${cradleName} {`);
  if (spec.layers.entities) lines.push('  readonly emFactory: () => EntityManager;');
  if (hasRoutes) lines.push('  readonly requireAdmin: RequireAdminFactory;');
  if (spec.layers.worker) {
    lines.push('  /** The host\'s queue connection, absent in a composition that runs no queue. */');
    lines.push('  readonly moduleQueueRedis: Redis | undefined;');
  }
  lines.push(`  readonly ${camel}Service: ${serviceName};`);
  lines.push('}');
  lines.push('');
  if (spec.layers.subscriber) {
    lines.push('/** This module\'s own settings namespace, watched by the subscriber below. */');
    lines.push(`const SETTINGS_NAMESPACE = ${quote(`${spec.id}.`)};`);
    lines.push('');
    lines.push('/** The changed setting\'s code, read off the event payload without trusting it. */');
    lines.push('function settingCodeOf(payload: unknown): string | null {');
    lines.push('  const code = (payload as { settingCode?: unknown } | null)?.settingCode;');
    lines.push('  return typeof code === \'string\' ? code : null;');
    lines.push('}');
    lines.push('');
  }
  lines.push(`export function registerModule(ctx: ModuleContext): void {`);
  lines.push('  ctx.di.register({');
  if (spec.layers.entities) {
    lines.push(`    ${camel}Service: ctx`);
    lines.push(`      .asFunction(({ emFactory }: ${cradleName}) => new ${serviceName}(emFactory))`);
    lines.push('      .singleton(),');
  } else {
    lines.push(`    ${camel}Service: ctx.asFunction(() => new ${serviceName}()).singleton(),`);
  }
  lines.push('  });');
  if (spec.layers.ports) {
    lines.push('');
    lines.push('  // The one name another module may resolve. `providePort` wraps the');
    lines.push('  // registration in a transient gate on this module\'s effective state, so a');
    lines.push('  // consumer resolving it while this module is off gets the 503 MODULE_DISABLED');
    lines.push('  // envelope at the call site instead of a half-executed operation.');
    lines.push('  //');
    lines.push('  // A consumer reaches it with');
    lines.push('  // `lazyPort<' + portInterfaceOf(spec) + '>(ctx, ' + quote(portNameOf(spec)) + ')`');
    lines.push('  // and declares this module in its own manifest `dependencies`.');
    lines.push(`  ctx.di.providePort<${portInterfaceOf(spec)}>(`);
    lines.push(`    ${quote(portNameOf(spec))},`);
    lines.push('    ctx');
    lines.push(`      .asFunction(({ ${camel}Service }: ${cradleName}) => ({`);
    if (spec.layers.entities) {
      lines.push(`        list: () => ${camel}Service.list(),`);
    } else {
      lines.push(`        status: () => ${camel}Service.status(),`);
    }
    lines.push('      }))');
    lines.push('      .singleton(),');
    lines.push('  );');
  }
  if (registersDeferred) {
    lines.push('');
    lines.push('  // `ctx.routes` is the gated registration seam: everything registered inside it');
    lines.push('  // stops answering when the module is off, including routes added later.');
    lines.push('  // Never call `defineModuleRoutes` by hand.');
    lines.push('  ctx.routes(async (app) => {');
    const destructured = [
      ...(hasRoutes ? ['requireAdmin'] : []),
      `${camel}Service`,
      ...(spec.layers.worker ? ['moduleQueueRedis'] : []),
    ];
    if (destructured.length > 2) {
      lines.push('    const {');
      for (const name of destructured) lines.push(`      ${name},`);
      lines.push(`    } = ctx.cradle<${cradleName}>();`);
    } else {
      lines.push(`    const { ${destructured.join(', ')} } = ctx.cradle<${cradleName}>();`);
    }
    if (hasRoutes) {
      lines.push(`    await register${pascal}AdminRoutes(app, {`);
      lines.push(`      service: ${camel}Service,`);
      lines.push('      requireAdmin,');
      lines.push('    });');
    }
    if (spec.layers.worker) {
      lines.push('');
      lines.push('    // Principle X — a queue consumer, registered through `ctx.worker` so the');
      lines.push('    // module gate can stop it. A bare `new Worker` kept in a local is a');
      lines.push('    // consumer nothing in the platform can pause.');
      lines.push(`    if (process.env['BACKEND_ROLE'] !== 'api' && moduleQueueRedis !== undefined) {`);
      lines.push('      ctx.worker(');
      lines.push(`        create${pascal}Worker(moduleQueueRedis, async () => ({`);
      if (spec.layers.entities) {
        lines.push(`          scanned: (await ${camel}Service.list()).length,`);
      } else {
        lines.push(`          scanned: ${camel}Service.status().module.length,`);
      }
      lines.push('        })),');
      lines.push('        { logger: app.log },');
      lines.push('      );');
      lines.push('    }');
    }
    lines.push('  });');
  }
  if (spec.layers.subscriber) {
    lines.push('');
    lines.push('  // Constitution XVII item 2 — an EventBus subscription registered through');
    lines.push('  // `ctx.subscribe`, from this file. A bare `eventBus.on` in a service body is a');
    lines.push('  // subscription the module gate cannot reach.');
    lines.push(`  ctx.subscribe('settings.value_changed', (payload) => {`);
    lines.push('    const code = settingCodeOf(payload);');
    lines.push('    if (code === null || !code.startsWith(SETTINGS_NAMESPACE)) return;');
    lines.push('    ctx.log.info(');
    lines.push('      { settingCode: code },');
    lines.push(
      "      'a setting this module owns changed; anything derived from it is stale here',",
    );
    lines.push('    );');
    lines.push('  });');
  }
  lines.push('}');
  if (spec.layers.entities) {
    lines.push('');
    lines.push('/**');
    lines.push(' * The module\'s persisted entity classes, on the `./backend` subpath, as one');
    lines.push(' * array and **no named class export** (D-168).');
    lines.push(' *');
    lines.push(' * This is the shape the platform reads when the package is *installed*: the');
    lines.push(' * boot-time loader and the static declaration reader both take');
    lines.push(' * `exported[\'entities\']`, and a missing array is answered with `[]` — zero');
    lines.push(' * entities registered, no error anywhere.');
    lines.push(' */');
    lines.push(`export const entities = [${entityClassOf(spec)}];`);
  }
  lines.push('');
  return lines.join('\n');
}

// --- src/backend/services/<slug>.service.ts --------------------------------

function service(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  const lines: string[] = [];
  if (spec.layers.entities) {
    lines.push(`import type { EntityManager } from '@mikro-orm/postgresql';`);
    if (spec.layers.ports) {
      lines.push(`import type { ${pascal}Record } from '../../ports/index.js';`);
    }
    lines.push(
      `import { ${entityClassOf(spec)} } from '../entities/${slugOf(spec.id)}-item.entity.js';`,
    );
    lines.push('');
    if (!spec.layers.ports) {
      lines.push('/** One row as this module hands it out: never the managed entity itself. */');
      lines.push(`export interface ${pascal}Record {`);
      lines.push('  readonly id: string;');
      lines.push('  readonly label: string;');
      lines.push('  readonly createdAt: string;');
      lines.push('}');
      lines.push('');
    }
    lines.push('/**');
    lines.push(` * ${spec.name} — the module's own service.`);
    lines.push(' *');
    lines.push(' * It takes an `EntityManager` **factory** rather than an instance: the request');
    lines.push(' * scope forks one per request, so a captured instance is one transaction serving');
    lines.push(' * every caller.');
    lines.push(' *');
    lines.push(' * This one only reads. A write belongs on the Command Bus (Constitution XIII):');
    lines.push(' * `commandBus.run(...)` is what keeps auditing and undo uniform, and');
    lines.push(' * `check:command-coverage` reports a `persist`/`flush`/`nativeUpdate` that runs');
    lines.push(' * outside one.');
    lines.push(' */');
    lines.push(`export class ${pascal}Service {`);
    lines.push('  constructor(private readonly emFactory: () => EntityManager) {}');
    lines.push('');
    lines.push(`  async list(): Promise<readonly ${pascal}Record[]> {`);
    lines.push(`    const rows = await this.emFactory().find(`);
    lines.push(`      ${entityClassOf(spec)},`);
    lines.push('      {},');
    lines.push(`      { orderBy: { createdAt: 'desc' }, limit: 100 },`);
    lines.push('    );');
    lines.push('    return rows.map((row) => ({');
    lines.push('      id: row.id,');
    lines.push('      label: row.label,');
    lines.push('      createdAt: row.createdAt.toISOString(),');
    lines.push('    }));');
    lines.push('  }');
    lines.push('}');
  } else {
    if (spec.layers.ports) {
      lines.push(`import type { ${pascal}Status } from '../../ports/index.js';`);
      lines.push('');
    } else {
      lines.push('/** What this module reports about itself. */');
      lines.push(`export interface ${pascal}Status {`);
      lines.push('  readonly module: string;');
      lines.push('  readonly name: string;');
      lines.push('}');
      lines.push('');
    }
    lines.push('/**');
    lines.push(` * ${spec.name} — the module's own service.`);
    lines.push(' *');
    lines.push(' * This module owns no table, so the service holds no `EntityManager`. A write');
    lines.push(' * belongs on the Command Bus (Constitution XIII): `commandBus.run(...)` is what');
    lines.push(' * keeps auditing and undo uniform.');
    lines.push(' */');
    lines.push(`export class ${pascal}Service {`);
    lines.push(`  status(): ${pascal}Status {`);
    lines.push('    return {');
    lines.push(`      module: ${quote(spec.id)},`);
    lines.push(`      name: ${quote(spec.name)},`);
    lines.push('    };');
    lines.push('  }');
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
}

// --- src/backend/routes.admin.ts -------------------------------------------

function adminRoutes(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  const gate = gatingPermissionOf(spec);
  if (gate === null) throw new Error('adminRoutes emitted without a permission to gate on');
  const lines: string[] = [];
  lines.push(`import type { FastifyInstance } from 'fastify';`);
  lines.push(`import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';`);
  lines.push(
    `import type { ${pascal}Service } from './services/${slugOf(spec.id)}.service.js';`,
  );
  lines.push('');
  lines.push('/**');
  lines.push(` * ${spec.name} — admin routes.`);
  lines.push(' *');
  lines.push(' * The permission code is a **literal** in the `requireAdmin(...)` call, because');
  lines.push(' * that is what the permission inventory and `check:action-route-permissions` read;');
  lines.push(' * a computed code is an argument they refuse rather than skip. It matches the');
  lines.push(' * `permissions` entry in `src/manifest.ts` exactly, which is what makes it');
  lines.push(' * grantable on /admin-roles.');
  lines.push(' */');
  lines.push(`export interface ${pascal}AdminRoutesDeps {`);
  lines.push(`  readonly service: ${pascal}Service;`);
  lines.push('  readonly requireAdmin: RequireAdminFactory;');
  lines.push('}');
  lines.push('');
  lines.push(`export async function register${pascal}AdminRoutes(`);
  lines.push('  app: FastifyInstance,');
  lines.push(`  deps: ${pascal}AdminRoutesDeps,`);
  lines.push('): Promise<void> {');
  lines.push('  const { service, requireAdmin } = deps;');
  for (const route of adminRoutesOf(spec)) {
    lines.push('');
    lines.push('  app.get(');
    lines.push(`    ${quote(adminApiPathFor(route))},`);
    lines.push(`    { preHandler: requireAdmin(${quote(gate.code)}) },`);
    if (spec.layers.entities) {
      lines.push('    async () => ({ data: await service.list() }),');
    } else {
      lines.push('    async () => ({ data: service.status() }),');
    }
    lines.push('  );');
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// --- src/backend/entities/<slug>-item.entity.ts ----------------------------

/** The tenant column each scope adds to the entity and to the table. */
function tenantColumn(spec: ModuleScaffoldSpec): { property: string; column: string } | null {
  if (spec.tenantScope === 'org-scoped') {
    return { property: 'organizationId', column: 'organization_id' };
  }
  if (spec.tenantScope === 'customer-scoped') {
    return { property: 'customerAccountId', column: 'customer_account_id' };
  }
  return null;
}

function entity(spec: ModuleScaffoldSpec): string {
  const decorator = TENANT_SCOPE_DECORATORS[spec.tenantScope];
  const tenant = tenantColumn(spec);
  const lines: string[] = [];
  lines.push(
    `import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';`,
  );
  lines.push(`import { ${decorator} } from '@endora-commerce/platform/tenancy';`);
  lines.push(`import { randomUUID } from 'node:crypto';`);
  lines.push('');
  lines.push('/**');
  lines.push(` * ${spec.name} — this module's own aggregate.`);
  lines.push(' *');
  lines.push(` * It carries exactly one tenant-scope decorator, \`@${decorator}\` (Principle XI).`);
  lines.push(' * That is not documentation: the decorator is what registers the class with the');
  lines.push(' * global filter, and `check-entity-tenant-classification` refuses an entity that');
  lines.push(' * carries none or more than one — including one shipped inside an installed');
  lines.push(' * package, read out of its `./backend` artefact.');
  lines.push(' *');
  lines.push(` * The table is this module's alone. Reading another module's table is a`);
  lines.push(' * `check:module-boundary` finding whether the reach is a specifier or SQL.');
  lines.push(' */');
  lines.push(`@${decorator}()`);
  lines.push(`@Entity({ tableName: ${quote(tableNameOf(spec))} })`);
  lines.push(`export class ${entityClassOf(spec)} {`);
  lines.push(`  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';`);
  lines.push('');
  lines.push(`  @PrimaryKey({ type: 'uuid' })`);
  lines.push('  id: string = randomUUID();');
  if (tenant !== null) {
    lines.push('');
    lines.push(`  @Property({ type: 'uuid' })`);
    lines.push('  @Index()');
    lines.push(`  ${tenant.property}!: string;`);
  }
  lines.push('');
  lines.push(`  @Property({ type: 'string', length: 200 })`);
  lines.push('  label!: string;');
  lines.push('');
  lines.push(`  @Property({ type: 'datetime', onCreate: () => new Date() })`);
  lines.push('  createdAt: Date = new Date();');
  lines.push('');
  lines.push(`  @Property({ type: 'datetime', onUpdate: () => new Date() })`);
  lines.push('  updatedAt: Date = new Date();');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// --- src/migrations/ -------------------------------------------------------

function migration(spec: ModuleScaffoldSpec): string {
  const table = tableNameOf(spec);
  const tenant = tenantColumn(spec);
  const columns = [
    '        "id" uuid not null,',
    ...(tenant === null ? [] : [`        "${tenant.column}" uuid not null,`]),
    '        "label" varchar(200) not null,',
    '        "created_at" timestamptz not null,',
    '        "updated_at" timestamptz not null,',
    `        constraint "${table}_pkey" primary key ("id")`,
  ];
  const lines: string[] = [];
  lines.push(`import { Migration } from '@mikro-orm/migrations';`);
  lines.push('');
  lines.push('/**');
  lines.push(` * ${spec.name} — initial schema.`);
  lines.push(' *');
  lines.push(' * The class name is derived mechanically from the file name and is scoped by the');
  lines.push(' * owning module\'s segment, which is what keeps it unique across every module the');
  lines.push(' * platform can compose. `mikro_orm_migrations` stores that name, so renaming it');
  lines.push(' * after it has been applied makes every migrated database see it as pending.');
  lines.push(' *');
  lines.push(' * Nothing orders this migration against another module\'s except this module\'s');
  lines.push(' * manifest `dependencies`: the timestamp orders a module\'s own migrations and');
  lines.push(' * nothing else. A foreign key into another module\'s table needs that module');
  lines.push(' * declared there.');
  lines.push(' */');
  lines.push(`export class ${migrationClassOf(spec)} extends Migration {`);
  lines.push('  override async up(): Promise<void> {');
  lines.push('    this.addSql(`');
  lines.push(`      create table "${table}" (`);
  lines.push(...columns);
  lines.push('      );');
  lines.push('    `);');
  if (tenant !== null) {
    lines.push('');
    lines.push('    this.addSql(`');
    lines.push(`      create index "${table}_${tenant.column}_idx"`);
    lines.push(`        on "${table}" ("${tenant.column}");`);
    lines.push('    `);');
  }
  lines.push('  }');
  lines.push('');
  lines.push('  override async down(): Promise<void> {');
  lines.push(`    this.addSql('drop table if exists "${table}";');`);
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function migrationsIndex(spec: ModuleScaffoldSpec): string {
  const className = migrationClassOf(spec);
  const file = migrationFileOf(spec).replace(/\.ts$/, '.js');
  return `/**
 * The \`./migrations\` subpath — every migration class this module owns, as one
 * ordered \`migrations\` array.
 *
 * The array is what the platform reads when this module is **installed**: the
 * package loader takes \`exported['migrations']\` and refuses the package outright
 * when it is absent (D-168).
 *
 * Listed in ascending timestamp, which is the order of this module's own
 * migrations and of nothing else: a manifest \`dependencies\` array is the only
 * thing ordering this block against another module's.
 *
 * The **named** exports stay beside the array. A migration class name is
 * contract in a way an entity class name is not — \`mikro_orm_migrations\`
 * persists it — and the committed registry imports each class by name from this
 * specifier. A class that is in neither the array nor the barrel is a migration
 * that does not run: nothing reports it pending, and the first symptom is a
 * query against a table nobody created.
 */

import { ${className} } from './${file}';

export const migrations = [
  ${className},
];

export {
  ${className},
};
`;
}

// --- src/backend/workers/<slug>.worker.ts ----------------------------------

function worker(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  const queue = `${spec.id}.maintenance`;
  return `import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type { Redis } from 'ioredis';

/**
 * ${spec.name} — its queue consumer (Principle X).
 *
 * The worker is **constructed** here and **registered** through \`ctx.worker\` in
 * \`../index.ts\`. That split matters: the registration seam is what puts the
 * worker in the module's own registry, which is what lets the platform stop it
 * when an operator switches the module off. A \`new Worker\` whose value goes
 * nowhere is a queue consumer nothing in the platform can pause, and
 * \`check:subscribe-seam\` reports one.
 *
 * The processor runs inside \`enterSystemScope\`, because a job has no request to
 * inherit a tenant scope from and every non-HTTP entry point establishes its own.
 */
export interface ${pascal}JobData {
  /** Why this sweep was enqueued, for the log line that reports it. */
  readonly reason: string;
}

export interface ${pascal}JobResult {
  readonly scanned: number;
}

export const ${segmentOf(spec.id).toUpperCase()}_QUEUE_NAME = ${quote(queue)};

export function create${pascal}Queue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<${pascal}JobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1_000 },
    },
    ...overrides,
  };
  return new Queue<${pascal}JobData>(${segmentOf(spec.id).toUpperCase()}_QUEUE_NAME, options);
}

export function create${pascal}Worker(
  redis: Redis,
  processor: Processor<${pascal}JobData, ${pascal}JobResult>,
  overrides?: Partial<WorkerOptions>,
): Worker<${pascal}JobData, ${pascal}JobResult> {
  const options: WorkerOptions = {
    connection: redis,
    concurrency: 1,
    ...overrides,
  };
  return new Worker<${pascal}JobData, ${pascal}JobResult>(
    ${segmentOf(spec.id).toUpperCase()}_QUEUE_NAME,
    (job) => enterSystemScope(${quote(`${spec.id}: maintenance sweep`)}, () => processor(job)),
    options,
  );
}
`;
}

// --- src/ports/index.ts ----------------------------------------------------

function ports(spec: ModuleScaffoldSpec): string {
  const pascal = pascalOf(spec.id);
  const shape = spec.layers.entities
    ? `/** One row as this module hands it out: never the managed entity itself. */
export interface ${pascal}Record {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface ${portInterfaceOf(spec)} {
  list(): Promise<readonly ${pascal}Record[]>;
}
`
    : `/** What this module reports about itself. */
export interface ${pascal}Status {
  readonly module: string;
  readonly name: string;
}

export interface ${portInterfaceOf(spec)} {
  status(): ${pascal}Status;
}
`;
  return `/**
 * ${spec.name} — the contract surface other modules resolve.
 *
 * **Type-only, and that is the whole design of this subpath.** A module package
 * whose \`./ports\` module exports no runtime binding is contract surface (D-171):
 * a consumer's \`import type\` from it is not a cross-module boundary reach, so
 * publishing an interface here is what turns a coupling into a declaration.
 * Adding a \`const\`, a class or a function to this file takes that back, in the
 * same run.
 *
 * The container name is contract too: this interface is registered under
 * \`${portNameOf(spec)}\`, and that literal is what a consumer writes in
 * \`lazyPort<${portInterfaceOf(spec)}>(ctx, '${portNameOf(spec)}')\`. A consumer that
 * resolves it declares this module in its manifest \`dependencies\`, which is what
 * makes the edge real to the lifecycle and to an operator switching this module
 * off.
 *
 * No method here is optional. Feature detection through a port is impossible by
 * construction — the resolution proxy answers every property with a function, so
 * \`if (port.maybe)\` is always true and the forward throws when the provider has
 * none.
 */

${shape}`;
}

// --- i18n/{en,pl}.json -----------------------------------------------------

/** `open-widgets` → `Open widgets`, the mechanical default label for an action. */
function titleOfActionId(actionId: string): string {
  const words = actionId.split('-').filter((part) => part.length > 0);
  const first = words[0] ?? actionId;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

/**
 * The keys a bundle carries, in the two namespaces a module's own bundle mixes.
 *
 * `actions.*` is **module-relative** — the palette resolves it under this
 * module's own namespace. `adminRoles.permission.<code>` is **platform-global**
 * and is written into this module's bundle anyway, because a package cannot
 * write into the platform's `_i18n` bundle at all. The split is invisible from
 * the file, which is why it is stated here.
 *
 * Both languages carry the same keys. The Polish values are the author's own
 * English text: a translation is a human judgement and this command does not
 * invent one — it names `i18n/pl.json` in its next steps instead.
 */
export function bundleEntries(spec: ModuleScaffoldSpec): readonly (readonly [string, string])[] {
  const entries: Array<readonly [string, string]> = [['module.name', spec.name]];
  for (const permission of spec.permissions) {
    entries.push([`adminRoles.permission.${permission.code}`, permission.label]);
  }
  for (const action of spec.actions) {
    const key = camelOfActionId(action.id);
    entries.push([`actions.${key}.label`, titleOfActionId(action.id)]);
    entries.push([`actions.${key}.description`, spec.description]);
  }
  return entries;
}

function bundle(spec: ModuleScaffoldSpec): string {
  return flatJson(bundleEntries(spec));
}

// --- test/unit/manifest.test.ts --------------------------------------------

function manifestTest(spec: ModuleScaffoldSpec): string {
  return `import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from '../../src/manifest.js';

/**
 * What a module manifest can be wrong about without anything else noticing.
 *
 * Every assertion here is a rule the platform enforces at a moment that is too
 * late to be useful: the id disagreement is diagnosed at boot, a missing
 * permission label renders as a raw key on /admin-roles, a nested i18n bundle is
 * *logged and skipped* by the boot reconciler so the palette renders raw keys
 * with no error anywhere, and an action key that resolves in one language and not
 * the other is invisible until somebody switches language.
 */

const packageDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(\`\${packageDir}/\${relative}\`, 'utf8')) as Record<string, unknown>;
}

const packageManifest = readJson('package.json');
const bundles = {
  en: readJson('i18n/en.json'),
  pl: readJson('i18n/pl.json'),
};

describe('${spec.id} manifest', () => {
  it('agrees with the package and the directory about its own id', () => {
    const endora = packageManifest['endora'] as { id?: unknown } | undefined;

    expect(manifest.id).toBe(${quote(spec.id)});
    expect(endora?.id).toBe(manifest.id);
    expect(basename(packageDir)).toBe(manifest.id);
  });

  it('declares an activation control or says why it has none', () => {
    const activation = manifest.activation;

    expect(activation).toBeDefined();
    if (activation !== undefined && 'nonDeactivatable' in activation) {
      expect(activation.reason.length).toBeGreaterThan(0);
    } else {
      expect(activation).toMatchObject({ default: expect.any(Boolean) });
    }
  });

  it('ships flat bundles in both languages', () => {
    for (const [language, entries] of Object.entries(bundles)) {
      expect(Object.keys(entries).length, language).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(entries)) {
        expect(typeof value, \`\${language}:\${key}\`).toBe('string');
      }
    }
  });

  it('has a label for every permission it declares, in both languages', () => {
    for (const permission of manifest.permissions ?? []) {
      for (const [language, entries] of Object.entries(bundles)) {
        expect(entries[\`adminRoles.permission.\${permission.code}\`], \`\${language}\`).toEqual(
          expect.any(String),
        );
      }
    }
  });

  it('resolves every palette action key in both languages', () => {
    for (const action of manifest.actions ?? []) {
      for (const [language, entries] of Object.entries(bundles)) {
        expect(entries[action.labelKey], \`\${language}:\${action.id}\`).toEqual(expect.any(String));
        if (action.descriptionKey !== undefined) {
          expect(entries[action.descriptionKey], \`\${language}:\${action.id}\`).toEqual(
            expect.any(String),
          );
        }
      }
    }
  });
});
`;
}
