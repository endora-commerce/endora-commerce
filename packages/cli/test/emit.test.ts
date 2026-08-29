/**
 * What `endora new module` emits, asserted over the real emitted text.
 *
 * Every one of these is a rule the platform enforces somewhere else and too
 * late to help a first-time author: a layer the manifest generator refuses by
 * name, a permission literal that has to match a manifest entry exactly, a
 * migration class name persisted in `mikro_orm_migrations`, a `./ports` module
 * that stops being contract surface the moment it exports a value.
 *
 * `research.md` §2 measured eight items in the older scaffolding contract that
 * no longer describe the artefact. The `never emits` block below is that list,
 * turned into assertions, so a later author cannot reintroduce one by reading
 * the stale document.
 */
import { describe, expect, it } from 'vitest';

import { emitModuleFiles, migrationClassOf, migrationFileOf } from '../src/new-module/emit.js';
import { buildScaffoldSpec, type ScaffoldInput } from '../src/new-module/spec.js';

const NOW = new Date(Date.UTC(2026, 8, 1, 12, 0, 0));

function emit(extra: Partial<ScaffoldInput> = {}): Map<string, string> {
  const spec = buildScaffoldSpec({
    id: 'demo_widgets',
    name: 'Demo Widgets',
    description: 'A worked example of a module package.',
    now: NOW,
    ...extra,
  });
  return new Map(emitModuleFiles(spec, 3).map((file) => [file.path, file.content]));
}

const FULL: Partial<ScaffoldInput> = {
  permissions: ['demo_widgets:read=View demo widgets'],
  actions: ['open-demo-widgets=/demo-widgets'],
  entities: true,
  ports: true,
  worker: true,
  subscriber: true,
  dependencies: ['settings'],
};

describe('the file set', () => {
  it('is the layout the platform composes, for a module with every layer', () => {
    expect([...emit(FULL).keys()].sort()).toEqual([
      'i18n/en.json',
      'i18n/pl.json',
      'src/backend/entities/demo-widgets-item.entity.ts',
      'src/backend/index.ts',
      'src/backend/routes.admin.ts',
      'src/backend/services/demo-widgets.service.ts',
      'src/backend/workers/demo-widgets.worker.ts',
      'src/manifest.ts',
      'src/migrations/20260901T120000_demo_widgets_init.ts',
      'src/migrations/index.ts',
      'src/ports/index.ts',
      'test/unit/manifest.test.ts',
      'tsconfig.build.json',
      'tsconfig.json',
      'vitest.config.ts',
    ]);
  });

  it('drops the layer a flag did not ask for', () => {
    const minimal = [...emit().keys()];

    expect(minimal).not.toContain('src/migrations/index.ts');
    expect(minimal).not.toContain('src/ports/index.ts');
    expect(minimal).not.toContain('src/backend/routes.admin.ts');
    expect(minimal.some((path) => path.startsWith('src/backend/workers/'))).toBe(false);
    expect(minimal.some((path) => path.startsWith('src/backend/entities/'))).toBe(false);
  });
});

describe('never emits', () => {
  const files = emit(FULL);
  const paths = [...files.keys()];

  it('a package.json — that file has an author already', () => {
    // The scaffold writes the sources and then runs the platform's manifest
    // generator; composing the file here would be a second author for a
    // derived artefact, which is D-100's subject.
    expect(paths).not.toContain('package.json');
  });

  it('a src/contracts/ layer, which the manifest generator refuses by name', () => {
    expect(paths.some((path) => path.startsWith('src/contracts/'))).toBe(false);
  });

  it('an admin or storefront layer, or a docs fragment', () => {
    expect(paths.some((path) => path.startsWith('src/admin/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('src/storefront/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('docs/'))).toBe(false);
  });

  it('an off-state test — it needs a booted platform and an unpublished harness', () => {
    expect(paths.some((path) => path.startsWith('test/contract/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('test/integration/'))).toBe(false);
  });

  it('a licence tier, which is an owner decision and not a tool\'s', () => {
    expect(files.get('src/manifest.ts')).not.toMatch(/license/);
  });

  it('a manifest version wired to the package version', () => {
    // Two different facts: the package version is 0.0.0 for this whole family,
    // and the manifest version is what the lifecycle registry stores and the
    // admin's pending-upgrade flag compares.
    const manifest = files.get('src/manifest.ts')!;
    expect(manifest).not.toMatch(/from '\.\.\/package\.json'/);
    expect(manifest).toMatch(/version: '1\.0\.0'/);
  });

  it('a TODO in any emitted file', () => {
    // A scaffold whose output needs editing to pass has not met its acceptance
    // criterion. Where a decision is genuinely the author's, the command asks
    // for it as a flag and refuses without it.
    for (const [path, content] of files) {
      expect(content, path).not.toMatch(/\bTODO\b|\bFIXME\b/);
    }
  });
});

describe('the checklists each flag makes applicable', () => {
  it('registers routes, workers and subscribers through the module seams', () => {
    const index = emit(FULL).get('src/backend/index.ts')!;

    expect(index).toMatch(/ctx\.routes\(/);
    expect(index).toMatch(/ctx\.worker\(/);
    expect(index).toMatch(/ctx\.subscribe\(/);
    // The call, not the word: the emitted comments name these seams to say the
    // module must not reach past them, and an assertion over the prose would
    // fail on its own instruction.
    expect(index).not.toMatch(/defineModuleRoutes\(|defineModuleWorker\(|subscribeForModule\(/);
    expect(index).not.toMatch(/eventBus\.on\(/);
    expect(index).not.toMatch(/from 'awilix'/);
  });

  it('gates its admin route on the literal code its manifest declares', () => {
    const files = emit(FULL);

    expect(files.get('src/backend/routes.admin.ts')).toContain(
      "requireAdmin('demo_widgets:read')",
    );
    expect(files.get('src/manifest.ts')).toContain("code: 'demo_widgets:read'");
  });

  it('points the palette action at the route the emitted gate is on', () => {
    // `check:action-route-permissions` reconstructs the entry route as
    // `/api/v1/admin` + the target and compares its gate to the declared code.
    const files = emit(FULL);

    expect(files.get('src/manifest.ts')).toContain("targetRoute: '/demo-widgets'");
    expect(files.get('src/manifest.ts')).toContain("requiredPermission: 'demo_widgets:read'");
    expect(files.get('src/backend/routes.admin.ts')).toContain("'/api/v1/admin/demo-widgets'");
  });

  it('carries exactly one tenant-scope decorator on the persisted entity', () => {
    const entity = emit(FULL).get('src/backend/entities/demo-widgets-item.entity.ts')!;
    const decorators = ['OrgScoped', 'CustomerScoped', 'GlobalEntity', 'TransitivelyScoped', 'RuleScoped'];
    const present = decorators.filter((name) => entity.includes(`@${name}()`));

    expect(present).toEqual(['OrgScoped']);
  });

  it('takes the tenant column from the scope the author chose', () => {
    const global = emit({ ...FULL, tenantScope: 'global' });
    const entity = global.get('src/backend/entities/demo-widgets-item.entity.ts')!;

    expect(entity).toContain('@GlobalEntity()');
    expect(entity).not.toContain('organizationId');
    expect(global.get('src/migrations/20260901T120000_demo_widgets_init.ts')).not.toContain(
      'organization_id',
    );
  });

  it('names the migration class mechanically from its file, scoped by the module segment', () => {
    const spec = buildScaffoldSpec({
      id: 'demo_widgets',
      name: 'Demo Widgets',
      description: 'x',
      entities: true,
      now: NOW,
    });

    expect(migrationFileOf(spec)).toBe('20260901T120000_demo_widgets_init.ts');
    expect(migrationClassOf(spec)).toBe('Migration20260901T120000DemoWidgetsInit');
    const barrel = emit(FULL).get('src/migrations/index.ts')!;
    expect(barrel).toContain('export const migrations = [');
    expect(barrel).toContain('Migration20260901T120000DemoWidgetsInit');
  });

  it('publishes a ./ports module that exports no runtime binding', () => {
    // D-171: a subpath is contract surface exactly while its emitted module
    // exports nothing at runtime. A `const` here takes the exemption back.
    const ports = emit(FULL).get('src/ports/index.ts')!;

    expect(ports).toMatch(/export interface /);
    expect(ports).not.toMatch(/export (const|class|function|let|var) /);
  });

  it('registers that port under the container name its doc block names', () => {
    const files = emit(FULL);

    expect(files.get('src/ports/index.ts')).toContain('`demoWidgetsReadPort`');
    expect(files.get('src/backend/index.ts')).toContain("'demoWidgetsReadPort'");
    expect(files.get('src/backend/index.ts')).toContain('ctx.di.providePort<DemoWidgetsReadPort>');
  });

  it('declares every module it depends on in the manifest', () => {
    expect(emit(FULL).get('src/manifest.ts')).toContain("'settings',");
  });
});

describe('i18n', () => {
  it('ships flat maps in both languages, carrying the same keys', () => {
    const files = emit(FULL);
    const en = JSON.parse(files.get('i18n/en.json')!) as Record<string, unknown>;
    const pl = JSON.parse(files.get('i18n/pl.json')!) as Record<string, unknown>;

    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
    for (const value of Object.values(en)) expect(typeof value).toBe('string');
  });

  it('writes the action keys module-relative and the permission keys platform-global', () => {
    const en = JSON.parse(emit(FULL).get('i18n/en.json')!) as Record<string, unknown>;

    expect(en).toHaveProperty('actions.openDemoWidgets.label');
    expect(en).toHaveProperty('actions.openDemoWidgets.description');
    expect(en).toHaveProperty('adminRoles.permission.demo_widgets:read');
    expect(en).not.toHaveProperty('demo_widgets.actions.openDemoWidgets.label');
  });
});

describe('the package-owned test run', () => {
  it('ships a configuration beside the test, and merges the repository base', () => {
    // The generator refuses a package that holds a test file and declares no
    // configuration, so emitting one without the other is refused immediately.
    const files = emit(FULL);

    expect(files.has('vitest.config.ts')).toBe(true);
    expect(files.get('vitest.config.ts')).toContain('vitest.config.base.js');
    // Again the setting rather than the word: the file's own comment explains
    // why the flag is absent.
    expect(files.get('vitest.config.ts')).not.toMatch(/passWithNoTests\s*:/);
    expect(files.has('test/unit/manifest.test.ts')).toBe(true);
  });

  it('reaches the repository root from the depth it was told about', () => {
    const shallow = new Map(
      emitModuleFiles(
        buildScaffoldSpec({ id: 'demo_widgets', name: 'D', description: 'x', now: NOW }),
        1,
      ).map((file) => [file.path, file.content]),
    );

    expect(shallow.get('tsconfig.json')).toContain('"extends": "../tsconfig.base.json"');
    expect(emit().get('tsconfig.json')).toContain('"extends": "../../../tsconfig.base.json"');
  });
});

describe('the two build configurations', () => {
  const files = emit(FULL);

  it('type-checks with paths active and cannot emit', () => {
    expect(files.get('tsconfig.json')).toContain('"noEmit": true');
  });

  it('emits with paths cleared, a rootDir, and noEmitOnError', () => {
    const build = files.get('tsconfig.build.json')!;

    expect(build).toContain('"paths": {}');
    expect(build).toContain('"rootDir": "./src"');
    expect(build).toContain('"noEmit": false');
    expect(build).toContain('"noEmitOnError": true');
  });

  it('keeps test files out of the emit', () => {
    expect(files.get('tsconfig.json')).toContain('*.test.ts');
  });
});
