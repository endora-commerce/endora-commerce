/**
 * What `endora new module --entities` writes for an **overlay** module is a
 * module this platform accepts (`specs/190-overlay-full-modules/` T103, FR-055).
 *
 * The CLI's own suite holds the emitted text. Whether that text *works* is this
 * repository's to answer, because the three judges are here: the composer's
 * overlay validation (#1850 — one classification, `/legacy` imports, filename
 * and class agreement, the module-scoped name), the overlay type-check program
 * (`tsconfig.apps.json`, `erasableSyntaxOnly`), and the platform's own runtime
 * readers, which discover an overlay's entities and migrations from a
 * deployment root. An application may depend on a tool, so the scaffold is
 * driven from here — once per tenant scope, since each emits a different
 * decorator and a different tenant column.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildScaffoldSpec,
  emitOverlayModuleFiles,
  type EmittedFile,
  type TenantScope,
} from '@endora-commerce/cli';
import { configuredEntitiesFrom, discoverConfiguredMigrations } from '@endora-commerce/platform/db';

import { collectEntities, collectMigrations, coreSources } from '../../../scripts/generate-composer.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';

const BACKEND_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DEPLOYMENT = 'scaffold_probe';
const SCOPES: readonly TenantScope[] = ['org-scoped', 'customer-scoped', 'global'];

const probes = SCOPES.map((tenantScope) => {
  const spec = buildScaffoldSpec({
    id: `scaffold_probe_${tenantScope.replace('-scoped', '')}`,
    name: 'Scaffold probe',
    description: 'An overlay module with a table, as the CLI writes it.',
    dependencies: ['settings'],
    entities: true,
    tenantScope,
    now: new Date(Date.UTC(2026, 10, 26, 10, 15, 0)),
  });
  return { spec, files: emitOverlayModuleFiles(spec, '@endora-commerce/') };
});

/** `apps/<deployment>/modules/<id>/<path>` — the key the composer's walk gives an overlay file. */
const keyOf = (id: string, file: EmittedFile): string =>
  `apps/${DEPLOYMENT}/modules/${id}/${file.path}`;

describe('the composer’s overlay validation accepts it, and emits none of it', () => {
  it.each(probes.map((probe) => [probe.spec.tenantScope, probe] as const))('%s', (_scope, probe) => {
    const sources = coreSources(
      Object.fromEntries(probe.files.map((file) => [keyOf(probe.spec.id, file), file.content])),
    );
    expect(collectEntities(sources)).toEqual([]);
    expect(collectMigrations(sources)).toEqual([]);
  });

  it('and the validation is reading it: a second tenancy decorator is refused', () => {
    const probe = probes[0]!;
    const entity = probe.files.find((file) => file.path.startsWith('entities/'))!;
    const doubled = entity.content
      .replace('@OrgScoped()', '@OrgScoped()\n@GlobalEntity()')
      .replace('import { OrgScoped }', 'import { GlobalEntity, OrgScoped }');
    expect(() =>
      collectEntities(coreSources({ [keyOf(probe.spec.id, entity)]: doubled })),
    ).toThrow(/overlay module's entity file/);
  });
});

describe('the overlay type-check program accepts it', () => {
  it('under tsconfig.apps.json’s options, `erasableSyntaxOnly` included', () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(BACKEND_ROOT, 'tsconfig.apps.json'),
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
    );
    expect(parsed).toBeDefined();
    expect(parsed!.options.erasableSyntaxOnly).toBe(true);

    // Virtual files where the program's own sources sit, so module resolution
    // walks up to the backend's `node_modules` as an overlay's does. Nothing is
    // written into `src/apps`.
    const virtual = new Map<string, string>();
    for (const probe of probes) {
      for (const file of probe.files) {
        if (!file.path.endsWith('.ts')) continue;
        virtual.set(join(BACKEND_ROOT, 'src', keyOf(probe.spec.id, file)), file.content);
      }
    }
    const virtualDirs = new Set([...virtual.keys()].flatMap((path) => {
      const dirs: string[] = [];
      for (let dir = dirname(path); dir.startsWith(BACKEND_ROOT); dir = dirname(dir)) dirs.push(dir);
      return dirs;
    }));
    const host = ts.createCompilerHost(parsed!.options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (path) => virtual.has(path) || ts.sys.fileExists(path);
    host.readFile = (path) => virtual.get(path) ?? ts.sys.readFile(path);
    host.directoryExists = (path) => virtualDirs.has(path) || ts.sys.directoryExists(path);
    host.getSourceFile = (path, language, ...rest) => {
      const text = virtual.get(path);
      return text === undefined
        ? getSourceFile(path, language, ...rest)
        : ts.createSourceFile(path, text, language, true);
    };

    const program = ts.createProgram({
      rootNames: [...virtual.keys()],
      options: { ...parsed!.options, noEmit: true },
      host,
    });
    const diagnostics = [...virtual.keys()].flatMap((path) => {
      const source = program.getSourceFile(path)!;
      return [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
    });
    expect(
      diagnostics.map((d) =>
        `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      ),
    ).toEqual([]);
  }, 120_000);
});

describe('the platform discovers it from a deployment root', () => {
  let root: string;
  const env = { ...process.env, DEPLOYMENT };

  beforeAll(() => {
    // Under `backend/` so its bare specifiers resolve through the backend's
    // `node_modules`, as an instance's do through its own.
    root = mkdtempSync(join(BACKEND_ROOT, 'test', '.overlay-scaffold-probe-'));
    for (const probe of probes) {
      for (const file of probe.files) {
        const path = join(root, keyOf(probe.spec.id, file));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.content, 'utf8');
      }
    }
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('registers each entity, classified', async () => {
    const entities = await configuredEntitiesFrom({ coreEntities: [], env, deploymentRoot: root });
    const names = entities.map((cls) => cls.name);
    for (const name of ['ScaffoldProbeOrgItem', 'ScaffoldProbeCustomerItem', 'ScaffoldProbeGlobalItem']) {
      expect(names).toContain(name);
    }
  }, 120_000);

  it('orders each first migration as the overlay module’s own', async () => {
    const configured = await discoverConfiguredMigrations(
      { coreEntries: MIGRATION_REGISTRY, manifests: DISCOVERED_MANIFESTS },
      env,
      root,
    );
    const overlay = configured.overlays.map((contribution) => ({
      id: contribution.id,
      migrations: contribution.migrations.map((entry) => entry.cls.name),
    }));
    // Contributions come in id order (`overlay-schema-discovery.md` §1).
    expect(overlay).toEqual(
      [...probes].sort((a, b) => a.spec.id.localeCompare(b.spec.id)).map((probe) => ({
        id: probe.spec.id,
        migrations: [
          `Migration20261126T101500${probe.spec.id
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('')}Init`,
        ],
      })),
    );
  }, 120_000);
});
