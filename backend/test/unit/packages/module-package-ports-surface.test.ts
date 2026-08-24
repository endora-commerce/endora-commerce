import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import {
  backendBarrelSourceOf,
  d169PortsFindings,
  declaredEntityClassesUnder,
  emitLayoutOfBuild,
  moduleManifestsInCheckout,
  readPortsSurface,
  runtimeExportsOfEmittedModule,
  type SourceReader,
} from '../../helpers/module-package-surface.js';

/**
 * D-169, and the owner's approval of 2026-08-24 — a module package publishes its
 * `EntityManager`-taking port interfaces on a **type-only `./ports` subpath**.
 *
 * ## Why the subpath exists
 *
 * D-169 converts nine co-transactional cross-module entity-class reaches into
 * ports whose signature carries the caller's MikroORM `EntityManager`. Three
 * homes for those interfaces were measured and all three are shut:
 *
 *  - **`packages/contracts`** — `admin` and `storefront` both compile it, so a
 *    MikroORM type there enters two frontend type-checks. Its `src/` holds zero
 *    `@mikro-orm` imports, deliberately, which is why `CreditLimitPort` lives in
 *    `credit_limits/services/` and says so in its own header. `import type`
 *    erases, so the cost is at type-check time and not at runtime — still a cost
 *    worth not paying when a free alternative exists.
 *  - **A relative import into the owner's `services/`** — the status quo, and
 *    precisely the `permanent: true` ledger entry D-169 removes.
 *  - **A platform-published `EntityManager` alias** — it makes the *parameter*
 *    nameable and leaves the *interface* homeless; D-77 and D-94.5 require the
 *    provider to own it.
 *
 * ## The shape, and why it emits JavaScript for a subpath that has no values
 *
 * `"./ports": { "types": "./dist/ports/index.d.ts", "default": "./dist/ports/index.js" }`.
 * Both conditions, both resolving. A `types`-only entry would type-check and
 * then answer `ERR_PACKAGE_PATH_NOT_EXPORTED` to any consumer whose toolchain
 * emits the import — which is every consumer that does not elide it, and TS
 * elides only what it can prove is a type. `tsc` writes `export {};` for a
 * module that declares nothing else, so the runtime target is a real, empty ES
 * module and costs one file. The alternative was measured and rejected on that
 * one sentence; the `.js` is not a placeholder.
 *
 * ## What is proven here
 *
 * The analysis' red proofs enter as **source text** (issue #130), and the shape
 * itself is proven by a **real `tsc` build** of a real module package, consumed
 * under `moduleResolution: Bundler` (this repository) and under `NodeNext` (what
 * `tsc --init` writes, so what a third-party author has) — D-162's standing
 * requirement. A fixture is the honest instrument here for the reason
 * `package-dist-build.test.ts`' own ioredis control gives: no package in this
 * repository publishes `./ports` today, and a property that can only be measured
 * once one does is a property nobody has measured.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

/** A reader over an in-memory file map, so a fixture enters at the top. */
function mapReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    read: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`[d169-fixture] no such file: ${path}`);
      return text;
    },
  };
}

const ENTITY_FILE = '/pkg/src/backend/entities/quote-request.entity.ts';
const ENTITY_SOURCE = [
  "import { Entity, PrimaryKey } from '@mikro-orm/core';",
  '',
  "@Entity({ tableName: 'quote_requests' })",
  'export class QuoteRequest {',
  '  @PrimaryKey()',
  '  id!: string;',
  '}',
].join('\n');

const SOUND_PORTS = [
  "import type { EntityManager } from '@mikro-orm/postgresql';",
  '',
  '/** The apply seam a caller runs inside its own transaction (D-169). */',
  'export interface QuoteRequestApplyPort {',
  '  completeForOrder(em: EntityManager, quoteRequestId: string, orderId: string): Promise<void>;',
  '}',
  '',
  'export type QuoteRequestApplyOutcome = { readonly completed: boolean };',
].join('\n');

describe('d169PortsFindings refuses each shape it names', () => {
  const kinds = (files: Readonly<Record<string, string>>, entities: readonly string[] = []) =>
    d169PortsFindings(readPortsSurface('/pkg/src/ports/index.ts', mapReader(files)), entities).map(
      (finding) => finding.kind,
    );

  it('passes a type-only barrel carrying an EntityManager-taking interface', () => {
    expect(kinds({ '/pkg/src/ports/index.ts': SOUND_PORTS })).toEqual([]);
  });

  it('refuses an exported class', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': `${SOUND_PORTS}\n\nexport class QuoteRequestApplyService {}\n`,
      }),
    ).toEqual(['runtime-export']);
  });

  it('refuses an exported const', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': `${SOUND_PORTS}\n\nexport const QUOTE_PORT_NAME = 'quoteRequestApplyPort';\n`,
      }),
    ).toEqual(['runtime-export']);
  });

  it('refuses an exported function', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': `${SOUND_PORTS}\n\nexport function isApplied(): boolean {\n  return true;\n}\n`,
      }),
    ).toEqual(['runtime-export']);
  });

  it('refuses a value re-export', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts':
          `${SOUND_PORTS}\n\nexport { OPEN_STATUSES } from '../backend/statuses.js';\n`,
        '/pkg/src/backend/statuses.ts': "export const OPEN_STATUSES = ['draft'];\n",
      }),
    ).toEqual(['runtime-export']);
  });

  it('refuses a star re-export, which carries whatever the target holds', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': `${SOUND_PORTS}\n\nexport * from '../backend/statuses.js';\n`,
        '/pkg/src/backend/statuses.ts': "export const OPEN_STATUSES = ['draft'];\n",
      }),
    ).toEqual(['runtime-export', 'runtime-export']);
  });

  it('accepts a type-only star re-export of a type-only module', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': "export type * from './apply-port.js';\n",
        '/pkg/src/ports/apply-port.ts': SOUND_PORTS,
      }),
    ).toEqual([]);
  });

  it('refuses an entity class re-exported as a type — the door D-168 shut on ./backend', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts':
          `${SOUND_PORTS}\n\nexport type { QuoteRequest } from '../backend/entities/quote-request.entity.js';\n`,
        [ENTITY_FILE]: ENTITY_SOURCE,
      }),
    ).toEqual(['named-entity-export']);
  });

  it('refuses an entity class re-exported under an alias', () => {
    const findings = d169PortsFindings(
      readPortsSurface(
        '/pkg/src/ports/index.ts',
        mapReader({
          '/pkg/src/ports/index.ts':
            `${SOUND_PORTS}\n\nexport type { QuoteRequest as QuoteRow } from '../backend/entities/quote-request.entity.js';\n`,
          [ENTITY_FILE]: ENTITY_SOURCE,
        }),
      ),
      [],
    );
    expect(findings.map((finding) => finding.kind)).toEqual(['named-entity-export']);
    expect(findings[0]?.detail).toContain('QuoteRow');
  });

  it('refuses an entity name the declared-classes oracle knows and the walk did not resolve', () => {
    // The second, independent source. Here the barrel declares the interface
    // locally and exports a name that happens to be an entity class of the same
    // package — nothing for the resolution walk to follow, and still that
    // entity's name on the subpath.
    expect(
      kinds(
        {
          '/pkg/src/ports/index.ts':
            "export type QuoteRequest = { readonly id: string };\nexport type Other = string;\n",
        },
        ['QuoteRequest'],
      ),
    ).toEqual(['named-entity-export']);
  });

  it('reports a re-export it cannot follow rather than passing it', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts':
          `${SOUND_PORTS}\n\nexport type { Something } from '@endora-commerce/contracts';\n`,
      }),
    ).toEqual(['unresolvable-reexport']);
  });

  it('reads exports as syntax, not as prose', () => {
    expect(
      kinds({
        '/pkg/src/ports/index.ts': [
          '// An author asked whether `export class Thing {}` belongs here and was',
          "// told no; so does `export const NAME = 'x'`.",
          "const sql = \"export * from './everything.js'\";",
          SOUND_PORTS,
          'export type Sql = typeof sql;',
        ].join('\n'),
      }),
    ).toEqual([]);
  });
});

describe('runtimeExportsOfEmittedModule reads the emitted module, not the source', () => {
  const read = (text: string) =>
    runtimeExportsOfEmittedModule('/pkg/dist/ports/index.js', mapReader({ '/pkg/dist/ports/index.js': text }));

  it('answers empty for the module a type-only barrel compiles to', () => {
    expect(read('export {};\n')).toEqual([]);
  });

  it('names a binding that survived the compile', () => {
    expect(read("export const NAME = 'x';\nexport {};\n")).toEqual(['NAME']);
  });

  it('names a star re-export, whose contents it cannot see', () => {
    expect(read("export * from './apply.js';\n")).toEqual(["* from './apply.js'"]);
  });
});

/**
 * The shape, built by a real `tsc` and read by two real consumers.
 *
 * Everything above is an analysis of source text. This is the part that can tell
 * a subpath that works from one that only looks right: it emits a package with
 * the module-package build shape, resolves `<pkg>/ports` through the package's
 * own `exports` map with no `paths` anywhere, and compiles the result twice —
 * `Bundler` and `NodeNext` (D-162), the second with `skipLibCheck: false`,
 * which is the only setting under which an error inside a published `.d.ts` is
 * visible at all.
 */
describe('a real module package publishes `./ports` and a consumer type-checks against it', () => {
  const PACKAGE_NAME = '@d169/mod-fixture';

  interface BuiltFixture {
    readonly dir: string;
    readonly cleanup: () => void;
  }

  function buildFixture(portsSource: string): BuiltFixture {
    if (repoRoot === null) throw new Error('[d169] no repository root above the test tree');
    const dir = mkdtempSync(join(tmpdir(), 'd169-ports-'));
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(join(dir, 'src', 'ports'), { recursive: true });
      mkdirSync(join(dir, 'src', 'backend', 'entities'), { recursive: true });
      mkdirSync(join(dir, 'node_modules', '@mikro-orm'), { recursive: true });
      for (const name of ['core', 'postgresql']) {
        symlinkSync(
          join(repoRoot, 'backend', 'node_modules', '@mikro-orm', name),
          join(dir, 'node_modules', '@mikro-orm', name),
        );
      }
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          {
            name: PACKAGE_NAME,
            version: '0.0.0',
            private: true,
            type: 'module',
            sideEffects: false,
            endora: { type: 'module', id: 'd169_fixture' },
            files: ['dist'],
            exports: {
              './backend': { types: './dist/backend/index.d.ts', default: './dist/backend/index.js' },
              './ports': { types: './dist/ports/index.d.ts', default: './dist/ports/index.js' },
              './package.json': './package.json',
            },
            scripts: { build: 'tsc -p tsconfig.build.json' },
          },
          null,
          2,
        ),
      );
      writeFileSync(
        join(dir, 'src', 'backend', 'entities', 'fixture-row.entity.ts'),
        [
          "import { Entity, PrimaryKey } from '@mikro-orm/core';",
          '',
          "@Entity({ tableName: 'd169_fixture_rows' })",
          'export class FixtureRow {',
          '  @PrimaryKey()',
          '  id!: string;',
          '}',
          '',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'src', 'backend', 'index.ts'),
        [
          "import { FixtureRow } from './entities/fixture-row.entity.js';",
          '',
          'export const entities = [FixtureRow];',
          '',
        ].join('\n'),
      );
      writeFileSync(join(dir, 'src', 'ports', 'index.ts'), portsSource);
      writeFileSync(
        join(dir, 'tsconfig.build.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2022'],
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            isolatedModules: true,
            verbatimModuleSyntax: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            declaration: true,
            paths: {},
            rootDir: './src',
            outDir: './dist',
            noEmit: false,
            noEmitOnError: true,
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      execFileSync(join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.build.json'], {
        cwd: dir,
        encoding: 'utf8',
      });
      return { dir, cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * A consumer outside the workspace, resolving the fixture through its own
   * `exports` map, returning the diagnostics that land in the consumer's own
   * sources or inside the fixture package.
   */
  function consumerDiagnostics(
    packageDir: string,
    probe: string,
    resolution: 'Bundler' | 'NodeNext',
  ): string[] {
    if (repoRoot === null) throw new Error('[d169] no repository root above the test tree');
    const consumer = mkdtempSync(join(tmpdir(), `d169-consumer-${resolution.toLowerCase()}-`));
    try {
      mkdirSync(join(consumer, 'src'), { recursive: true });
      mkdirSync(join(consumer, 'node_modules', '@d169'), { recursive: true });
      mkdirSync(join(consumer, 'node_modules', '@mikro-orm'), { recursive: true });
      symlinkSync(packageDir, join(consumer, 'node_modules', PACKAGE_NAME));
      for (const name of ['core', 'postgresql', 'knex']) {
        symlinkSync(
          join(repoRoot, 'backend', 'node_modules', '@mikro-orm', name),
          join(consumer, 'node_modules', '@mikro-orm', name),
        );
      }
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'd169-consumer', type: 'module', private: true }),
      );
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext',
            moduleResolution: resolution,
            lib: ['ES2022'],
            strict: true,
            // The whole point of the NodeNext half: with `skipLibCheck` on, an
            // error inside the published declarations is invisible.
            skipLibCheck: false,
            noEmit: true,
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      writeFileSync(join(consumer, 'src', 'probe.ts'), probe);

      let output = '';
      try {
        execFileSync(
          join(repoRoot, 'node_modules', '.bin', 'tsc'),
          ['-p', 'tsconfig.json', '--pretty', 'false'],
          { cwd: consumer, encoding: 'utf8' },
        );
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? String(error);
      }

      // Diagnostics inside the ORM's own declarations are a property of that
      // dependency under a strict consumer, not of what this fixture publishes.
      const owned = [realpathSync(consumer) + sep, realpathSync(packageDir) + sep];
      return output
        .split('\n')
        .filter((line) => /error TS\d+/.test(line))
        .filter((line) => {
          const path = line.slice(0, line.lastIndexOf('('));
          try {
            const real = realpathSync(join(consumer, path));
            return owned.some((root) => real.startsWith(root));
          } catch {
            return false;
          }
        })
        .map((line) => line.trim());
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  }

  const PORTS_SOURCE = [
    "import type { EntityManager } from '@mikro-orm/postgresql';",
    '',
    '/**',
    " * The apply seam a caller runs inside its own transaction (D-169). The",
    ' * `EntityManager` is a required parameter and never an optional one.',
    ' */',
    'export interface FixtureApplyPort {',
    '  applyInTransaction(em: EntityManager, id: string): Promise<void>;',
    '}',
    '',
  ].join('\n');

  it('emits both conditions, and the runtime target exports nothing', () => {
    const fixture = buildFixture(PORTS_SOURCE);
    try {
      const emitted = join(fixture.dir, 'dist', 'ports', 'index.js');
      const declarations = join(fixture.dir, 'dist', 'ports', 'index.d.ts');

      // An `exports` target that resolves to nothing is the failure a `types`-only
      // entry produces, and it is invisible to every type-check.
      expect(existsSync(emitted)).toBe(true);
      expect(existsSync(declarations)).toBe(true);

      expect(runtimeExportsOfEmittedModule(emitted)).toEqual([]);
      expect(readFileSync(declarations, 'utf8')).toContain('interface FixtureApplyPort');
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it('type-checks in a consumer under `Bundler` and under `NodeNext` (D-162)', () => {
    const fixture = buildFixture(PORTS_SOURCE);
    try {
      const probe = [
        "import type { EntityManager } from '@mikro-orm/postgresql';",
        `import type { FixtureApplyPort } from '${PACKAGE_NAME}/ports';`,
        '',
        'export async function place(port: FixtureApplyPort, em: EntityManager): Promise<void> {',
        "  await port.applyInTransaction(em, 'id');",
        '}',
        '',
        '// @ts-expect-error the EntityManager is a required parameter, never optional',
        "export const bad = (port: FixtureApplyPort) => port.applyInTransaction('id');",
        '',
      ].join('\n');

      expect(consumerDiagnostics(fixture.dir, probe, 'Bundler')).toEqual([]);
      expect(consumerDiagnostics(fixture.dir, probe, 'NodeNext')).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  }, 240_000);

  it('is a real resolution: a name the subpath does not publish is refused', () => {
    // Without this the test above passes just as happily against a `./ports`
    // whose declarations degraded to `any` or resolved to nothing at all.
    const fixture = buildFixture(PORTS_SOURCE);
    try {
      const probe = [
        `import type { FixtureApplyPort, NotPublished } from '${PACKAGE_NAME}/ports';`,
        'export type A = FixtureApplyPort;',
        'export type B = NotPublished;',
        '',
      ].join('\n');
      const bundler = consumerDiagnostics(fixture.dir, probe, 'Bundler');
      expect(bundler.join('\n')).toContain('TS2305');
      expect(bundler).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it('shuts the entity door in the consumer\'s own compiler, exactly as `./backend` does', () => {
    const fixture = buildFixture(PORTS_SOURCE);
    try {
      const probe = [
        `import type { FixtureRow } from '${PACKAGE_NAME}/ports';`,
        `import type { FixtureRow as FromBackend } from '${PACKAGE_NAME}/backend';`,
        'export type A = FixtureRow;',
        'export type B = FromBackend;',
        '',
      ].join('\n');
      const diagnostics = consumerDiagnostics(fixture.dir, probe, 'Bundler');
      expect(diagnostics.filter((line) => /TS2305|TS2459/.test(line))).toHaveLength(2);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it('the guard sees an entity door a real build published', () => {
    // The guard, over a real emitted package rather than over source text: the
    // fixture publishes the entity class as a type on `./ports`, the compile
    // succeeds, and the analysis is what refuses it.
    const fixture = buildFixture(
      `${PORTS_SOURCE}export type { FixtureRow } from '../backend/entities/fixture-row.entity.js';\n`,
    );
    try {
      const surface = readPortsSurface(join(fixture.dir, 'src', 'ports', 'index.ts'));
      const findings = d169PortsFindings(
        surface,
        declaredEntityClassesUnder(join(fixture.dir, 'src')),
      );
      expect(findings.map((finding) => finding.kind)).toEqual(['named-entity-export']);
      expect(runtimeExportsOfEmittedModule(join(fixture.dir, 'dist', 'ports', 'index.js'))).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);
});

/**
 * Every module package in this checkout that declares `./ports` is held to the
 * rule.
 *
 * The population is legitimately allowed to be empty — the subpath is not part
 * of a module package's minimum shape, and no package in this repository
 * publishes one today. What must not be empty is the *scan*: a sweep that has
 * stopped finding module packages at all would report a clean `./ports` estate
 * for the same reason it would report a clean anything.
 */
describe('every module package that declares `./ports` publishes types only', () => {
  if (repoRoot === null) throw new Error('[d169] no repository root above the test tree');
  const root: string = repoRoot;
  const scanned = moduleManifestsInCheckout(root);

  it('found module packages at all, so the sweep below is not vacuous', () => {
    expect(scanned.length).toBeGreaterThan(0);
    expect(discoverModulePackages(root).length).toBeGreaterThan(0);
  });

  it('holds every declared `./ports` subpath, and can read each one', () => {
    const offenders: { package: string; findings: string[] }[] = [];
    const unreadable: string[] = [];

    for (const subject of scanned) {
      if (subject.portsTarget === null) continue;
      const barrel = backendBarrelSourceOf(
        subject.dir,
        subject.portsTarget,
        emitLayoutOfBuild(subject.dir, subject.buildScript),
      );
      if (barrel === null) {
        // A declared subpath whose source this cannot find is reported, never
        // skipped: a target that resolves to nothing is the defect, not the
        // absence of one.
        unreadable.push(`${subject.name}: ${subject.portsTarget}`);
        continue;
      }
      const findings = d169PortsFindings(
        readPortsSurface(barrel),
        declaredEntityClassesUnder(join(subject.dir, 'src')),
      );
      if (findings.length > 0) {
        offenders.push({ package: subject.name, findings: findings.map((f) => f.detail) });
      }
    }

    expect(unreadable).toEqual([]);
    expect(offenders).toEqual([]);
  });
});
