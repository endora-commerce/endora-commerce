/**
 * `@endora-commerce/platform` — the host package (feature 080, T042a; contract
 * `specs/080-f4-real-scope/contracts/host-package.md`, D-160.1/D-160.7).
 *
 * Three properties, and each one is invisible to the checks that already run:
 *
 * 1. **The `exports` map is five enumerated subpaths, no root and no wildcard.** A
 *    wildcard publishes all 14 accidental-reach files as API — `db/index` among them,
 *    which cannot be published at all because it reaches 219 module-owned entity
 *    references and would make the host import every module (§1.4f). Nothing else in the
 *    repository would notice one being added.
 * 2. **The subpaths resolve, and the refusals hold, under `node`.** `tsc` cannot see
 *    either: it answers from the `types` condition, and §2.2 measured two of the five
 *    subpaths failing at runtime while `tsc` stayed green, because the host's declarations
 *    resolved through `paths` while its JavaScript resolved through `node_modules`.
 * 3. **The published declarations are real types, and the probe can go red.** An
 *    unresolvable import inside an emitted `.d.ts` turns every type flowing through it into
 *    `any` with no diagnostic — `skipLibCheck: true` (`tsconfig.base.json`) suppresses the
 *    error in a dependency's declarations. Properties 1 and 2 pass just as happily against
 *    an all-`any` build; so does `pnpm -r run typecheck`. The control at the bottom of this
 *    file is the only thing here that does not, and it is per **directive**: it removes
 *    `@endora-commerce/contracts` and nothing else, so the contracts-derived assertion goes
 *    unused (TS2578) while the `fastify`- and `@mikro-orm/core`-derived ones stay real.
 *
 * The consumer lives outside the workspace, in a temporary directory, and resolves the
 * host through `node_modules` and its own `exports` map — no `paths`, no source. Inside the
 * workspace `paths` answers instead of the `exports` map and the probe measures the wrong
 * thing (R4).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCheckoutRoot } from '../../../../scripts/workspace-resolution.js';

const ROOT = findCheckoutRoot(dirname(fileURLToPath(import.meta.url)));
const HOST_DIR = join(ROOT ?? '.', 'packages', 'platform');
const HOST_NAME = '@endora-commerce/platform';

interface HostManifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const PUBLISHED_SUBPATHS = ['./kernel', './http', './tenancy', './commands', './events'];

/**
 * The subpaths the map declares and no public barrel carries (D-160.14, feature
 * 109 T010; `host-package.md` §2.7).
 *
 * `./composition` is host composition surface: the 27 symbols a composition
 * root needs, reachable by a package that is not a module and nameable by no
 * module at all. `./migrations` is the frozen historical prefix an execution
 * order is computed from — the platform's own claim about its schema history,
 * which a client receives by installing the platform and a correction to which
 * arrives by `pnpm update` (`specs/110-instance-repository/`
 * `contracts/instance-migration-order.md` R1.5). Both are held to the same
 * `exports`-map shape as the five — declared, `./dist`-targeted, no wildcard —
 * and to a different rule about who may name them, which is
 * `check:platform-surface`'s `host-internal-subpath` finding and not this
 * file's.
 *
 * It is kept apart from {@link PUBLISHED_SUBPATHS} rather than appended to it
 * because the two lists answer different questions, and §2.7.5(a) is that
 * merging them is the mistake: the published list is what a *symbol* is judged
 * against, and a sixth entry there would publish `composeModules` out of
 * `kernel/compose.ts` for every reach at that file, a module's relative one
 * included.
 */
const HOST_INTERNAL_SUBPATHS = ['./composition', './migrations'];

/** Every subpath the `exports` map is required to declare, published or not. */
const DECLARED_SUBPATHS = [...PUBLISHED_SUBPATHS, ...HOST_INTERNAL_SUBPATHS];

type ExportFindingKind =
  | 'root-export'
  | 'wildcard-subpath'
  | 'unknown-subpath'
  | 'missing-subpath'
  | 'target-outside-dist';

interface ExportFinding {
  readonly kind: ExportFindingKind;
  readonly detail: string;
}

/**
 * Everything wrong with the host's `exports` map. Pure — the input is the parsed manifest,
 * which is what lets each red proof below enter above the predicate instead of being handed
 * a finding somebody already computed (issue #130).
 */
export function exportMapFindings(manifest: HostManifest): ExportFinding[] {
  const findings: ExportFinding[] = [];
  const entries = Object.entries(manifest.exports ?? {});
  const seen = new Set<string>();

  for (const [subpath, target] of entries) {
    if (subpath === '.') {
      findings.push({ kind: 'root-export', detail: subpath });
      continue;
    }
    if (subpath.includes('*')) {
      findings.push({ kind: 'wildcard-subpath', detail: subpath });
      continue;
    }
    if (subpath === './package.json') continue;
    if (!DECLARED_SUBPATHS.includes(subpath)) {
      findings.push({ kind: 'unknown-subpath', detail: subpath });
      continue;
    }
    seen.add(subpath);
    const conditions = (typeof target === 'object' && target !== null ? target : {}) as Record<
      string,
      unknown
    >;
    for (const [condition, value] of Object.entries(conditions)) {
      if (typeof value === 'string' && !value.startsWith('./dist/')) {
        findings.push({
          kind: 'target-outside-dist',
          detail: `${subpath} [${condition}] -> ${value}`,
        });
      }
    }
  }

  for (const subpath of DECLARED_SUBPATHS) {
    if (!seen.has(subpath)) findings.push({ kind: 'missing-subpath', detail: subpath });
  }

  return findings;
}

const MANIFEST: HostManifest =
  ROOT === null
    ? {}
    : (JSON.parse(readFileSync(join(HOST_DIR, 'package.json'), 'utf8')) as HostManifest);

describe('the host package `exports` map', () => {
  it('is a checkout of this repository, with the host package in it', () => {
    expect(ROOT).not.toBeNull();
    expect(MANIFEST.name).toBe(HOST_NAME);
  });

  describe('exportMapFindings refuses each shape it names', () => {
    const sound: HostManifest = {
      name: HOST_NAME,
      exports: {
        ...Object.fromEntries(
          DECLARED_SUBPATHS.map((subpath) => [
            subpath,
            {
              types: `./dist/${subpath.slice(2)}/index.d.ts`,
              default: `./dist/${subpath.slice(2)}/index.js`,
            },
          ]),
        ),
        './package.json': './package.json',
      },
    };

    it('passes the sound map', () => {
      expect(exportMapFindings(sound)).toEqual([]);
    });

    it('refuses a root export', () => {
      const exports = { ...sound.exports, '.': { types: './dist/index.d.ts' } };
      expect(exportMapFindings({ ...sound, exports }).map((f) => f.kind)).toEqual(['root-export']);
    });

    it('refuses a wildcard subpath', () => {
      // The one that matters: a wildcard publishes `./db`, and with it the ORM config's
      // 219 module-owned entity references.
      const exports = { ...sound.exports, './*': { types: './dist/*.d.ts' } };
      expect(exportMapFindings({ ...sound, exports }).map((f) => f.kind)).toEqual([
        'wildcard-subpath',
      ]);
    });

    it('refuses a subpath the classification does not publish', () => {
      const exports = { ...sound.exports, './db': { types: './dist/db/index.d.ts' } };
      expect(exportMapFindings({ ...sound, exports }).map((f) => f.kind)).toEqual([
        'unknown-subpath',
      ]);
    });

    it('refuses a published subpath that is gone', () => {
      const exports = { ...sound.exports };
      delete (exports as Record<string, unknown>)['./events'];
      expect(exportMapFindings({ ...sound, exports })).toEqual([
        { kind: 'missing-subpath', detail: './events' },
      ]);
    });

    // The same refusal over the half of the map that is *not* public API. A
    // `./composition` that quietly disappeared would leave the test kit and the
    // host's own composition root with no supported specifier and this file
    // reporting a sound map (D-160.14); a `./migrations` that did would leave
    // the ORM configuration computing an execution order with an empty frozen
    // prefix, which is the state `specs/110-instance-repository/` Phase 4a
    // exists to end.
    it('refuses a host-internal subpath being gone', () => {
      for (const subpath of HOST_INTERNAL_SUBPATHS) {
        const exports = { ...sound.exports };
        delete (exports as Record<string, unknown>)[subpath];
        expect(exportMapFindings({ ...sound, exports }), subpath).toEqual([
          { kind: 'missing-subpath', detail: subpath },
        ]);
      }
    });

    it('refuses a subpath pointing at source', () => {
      const exports = {
        ...sound.exports,
        './kernel': { types: './src/kernel/index.ts', default: './src/kernel/index.ts' },
      };
      expect(exportMapFindings({ ...sound, exports }).map((f) => f.kind)).toEqual([
        'target-outside-dist',
        'target-outside-dist',
      ]);
    });
  });

  it('declares the five published subpaths, the two host-internal ones, the manifest, and nothing else', () => {
    expect(exportMapFindings(MANIFEST)).toEqual([]);
  });

  it('declares the singleton peers rather than depending on them', () => {
    // §3: a second copy of the ORM registers the package's entity and then drops it from
    // discovery, silently, exit 0; a second copy of the host throws `MetadataError:
    // Duplicate entity names are not allowed` at boot. A `dependencies` entry permits both
    // by construction, which is why these four are peers.
    const peers = MANIFEST.peerDependencies ?? {};
    expect(Object.keys(peers).sort()).toEqual([
      '@mikro-orm/core',
      '@mikro-orm/postgresql',
      'fastify',
      'zod',
    ]);
    for (const name of Object.keys(peers)) {
      expect(MANIFEST.dependencies ?? {}).not.toHaveProperty(name);
    }
  });
});

/** The consumer directory, outside the workspace, that both probes compile and run in. */
interface Consumer {
  readonly dir: string;
  /** Where the host is reached from — the real package, or the contracts-less copy. */
  readonly hostDir: string;
}

function makeConsumer(hostDir: string): Consumer {
  const dir = mkdtempSync(join(tmpdir(), 't042a-host-'));
  mkdirSync(join(dir, 'node_modules', '@endora-commerce'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  symlinkSync(hostDir, join(dir, 'node_modules', HOST_NAME));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 't042a-consumer', type: 'module', private: true }),
  );
  return { dir, hostDir };
}

/**
 * A copy of the host whose own `node_modules` has no `@endora-commerce/contracts` — the
 * control. `dist` is **copied** rather than symlinked on purpose: node and `tsc` both
 * resolve a dependency from a file's real path, so a symlinked `dist` would find the real
 * package's `node_modules` and the control would measure nothing.
 */
function makeContractsLessHost(): string {
  const dir = mkdtempSync(join(tmpdir(), 't042a-nocontracts-'));
  cpSync(join(HOST_DIR, 'dist'), join(dir, 'dist'), { recursive: true });
  cpSync(join(HOST_DIR, 'package.json'), join(dir, 'package.json'));
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  for (const entry of readdirSync(join(HOST_DIR, 'node_modules'), { withFileTypes: true })) {
    if (entry.name === '@endora-commerce') continue;
    if (entry.name.startsWith('@')) {
      mkdirSync(join(dir, 'node_modules', entry.name), { recursive: true });
      for (const scoped of readdirSync(join(HOST_DIR, 'node_modules', entry.name))) {
        symlinkSync(
          join(HOST_DIR, 'node_modules', entry.name, scoped),
          join(dir, 'node_modules', entry.name, scoped),
        );
      }
      continue;
    }
    symlinkSync(join(HOST_DIR, 'node_modules', entry.name), join(dir, 'node_modules', entry.name));
  }
  return dir;
}

/**
 * Eight assertions across five subpaths, four of them `@ts-expect-error` directives that
 * must **fire**. One per dependency family whose collapse this has to detect
 * (§5.3's dependency-completeness assertion): `@endora-commerce/contracts` through
 * `ErrorCode`, `fastify` through `ModuleContext`, `@mikro-orm/core` through a
 * `Collection`-typed property of a published entity, and `@mikro-orm/postgresql` through
 * the `EntityManager` `AuditPort.recordWithin` takes.
 */
const PROBE_SOURCE = [
  "import { HttpError } from '@endora-commerce/platform/http';",
  "import type { ModuleContext, AuditPort } from '@endora-commerce/platform/kernel';",
  "import { SalesChannel, Setting, lazyPort } from '@endora-commerce/platform/kernel';",
  "import { GlobalEntity } from '@endora-commerce/platform/tenancy';",
  "import { CommandBus } from '@endora-commerce/platform/commands';",
  "import { EventBus } from '@endora-commerce/platform/events';",
  '',
  '// 1. contracts: `ErrorCode` is a union from `@endora-commerce/contracts`. If the',
  '//    declarations collapsed to `any`, this directive goes unused and `tsc` reports',
  '//    TS2578 — which is the whole point of the control.',
  '// @ts-expect-error CONTRACTS not a member of the ErrorCode union',
  "export const badCode = new HttpError(400, 'definitely-not-an-error-code', 'x');",
  '',
  '// 2. and the good one compiles, with its declared members.',
  "export const status: number = new HttpError(404, 'NOT_FOUND', 'x').statusCode;",
  '',
  '// 3. fastify: `ModuleContext` carries the Fastify-typed route seam.',
  'export function register(ctx: ModuleContext): void {',
  "  ctx.routes(async (app) => { app.log.info('probe'); });",
  '  // @ts-expect-error FASTIFY ModuleContext has no `nope`',
  '  ctx.nope();',
  '  // 7. `lazyPort` keeps its type parameter through the published declarations.',
  "  const port = lazyPort<{ ping(): void }>(ctx, 'somePort');",
  '  port.ping();',
  '  // @ts-expect-error FASTIFY the port type parameter has no `pong`',
  '  port.pong();',
  '}',
  '',
  '// 4. the decorated entity keeps its declared columns.',
  'export function channelId(channel: SalesChannel): string {',
  '  return channel.id;',
  '}',
  '// @ts-expect-error ENTITY SalesChannel has no `nope`',
  'export const noSuchColumn = (channel: SalesChannel): unknown => channel.nope;',
  '',
  '// 5. `GlobalEntity` is callable as a class decorator.',
  '@GlobalEntity()',
  'export class ProbeGlobal {}',
  '',
  '// 6. cross-directory agreement: `./commands` and `./events` resolve their own classes.',
  'export type BusRun = CommandBus[\'run\'];',
  'export type BusOn = EventBus[\'on\'];',
  '',
  '// 8. @mikro-orm/core: a `Collection`-typed property of a published entity.',
  'export const channels = (setting: Setting): SalesChannel[] => setting.salesChannels.getItems();',
  '// @ts-expect-error ORM a Collection has no `nope`',
  'export const noSuchCollection = (setting: Setting): unknown => setting.salesChannels.nope;',
  '',
  '// 9. @mikro-orm/postgresql: the EntityManager `recordWithin` takes co-transactionally.',
  '// @ts-expect-error ORM an empty object is not an EntityManager',
  "export const audited = (audit: AuditPort) => audit.recordWithin({}, { action: 'probe.run' });",
  '',
].join('\n');

function writeProbe(consumer: Consumer, source: string): void {
  writeFileSync(
    join(consumer.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022'],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: [],
      },
      include: ['src/**/*'],
    }),
  );
  writeFileSync(join(consumer.dir, 'src', 'probe.ts'), source);
}

function runTsc(consumer: Consumer): { status: number; output: string } {
  const tsc = join(ROOT!, 'node_modules', '.bin', 'tsc');
  try {
    execFileSync(tsc, ['-p', 'tsconfig.json'], { cwd: consumer.dir, encoding: 'utf8' });
    return { status: 0, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return { status: failure.status ?? 1, output: failure.stdout ?? String(error) };
  }
}

describe('the host package type probe', () => {
  let consumer: Consumer;

  beforeAll(() => {
    expect(
      existsSync(join(HOST_DIR, 'dist', 'kernel', 'index.d.ts')),
      'the host package is not built — run `pnpm run build:packages`',
    ).toBe(true);
    consumer = makeConsumer(HOST_DIR);
    writeProbe(consumer, PROBE_SOURCE);
  });

  afterAll(() => {
    if (consumer !== undefined) rmSync(consumer.dir, { recursive: true, force: true });
  });

  it('compiles a consumer outside the workspace, with every negative assertion firing', () => {
    const { status, output } = runTsc(consumer);
    expect(output.trim()).toBe('');
    expect(status).toBe(0);
  }, 120_000);
});

describe('the host package type probe can go red', () => {
  let host: string;
  let consumer: Consumer;

  beforeAll(() => {
    host = makeContractsLessHost();
    consumer = makeConsumer(host);
    writeProbe(consumer, PROBE_SOURCE);
  });

  afterAll(() => {
    if (consumer !== undefined) rmSync(consumer.dir, { recursive: true, force: true });
    if (host !== undefined) rmSync(host, { recursive: true, force: true });
  });

  it('reports the contracts-derived assertion as unused, and only that family', () => {
    const { status, output } = runTsc(consumer);
    expect(status).not.toBe(0);

    const unused = output
      .split('\n')
      .filter((line) => line.includes('TS2578'))
      .map((line) => Number(/\((\d+),/.exec(line)?.[1] ?? 0));
    expect(unused.length).toBeGreaterThan(0);

    // Which directive fired is the measurement, not the fact that one did: the families
    // that do not route through `@endora-commerce/contracts` must stay real, or the probe
    // is one clever line rather than an assertion per dependency. Measured against the
    // built package: exactly one diagnostic, `src/probe.ts(11,1): error TS2578`, the
    // `ErrorCode` directive. `ModuleContext`, `SalesChannel`, the `Collection` and the
    // `EntityManager` all stayed real, because none of them routes through contracts.
    const lines = PROBE_SOURCE.split('\n');
    const families = unused.map((line) => /@ts-expect-error (\w+)/.exec(lines[line - 1] ?? '')?.[1]);
    expect([...new Set(families)]).toEqual(['CONTRACTS']);
  }, 120_000);
});

describe('the host package resolves under node', () => {
  // The subpaths the map publishes, and the five refusals §2.2 measured: the three
  // platform directories that are accidental reach, a deep file that would be one, and
  // the root §2.4 argues against.
  const REFUSED = [
    `${HOST_NAME}/db`,
    `${HOST_NAME}/overlay`,
    `${HOST_NAME}/packages`,
    `${HOST_NAME}/kernel/lifecycle/plugin-helpers.js`,
    HOST_NAME,
  ];

  let consumer: Consumer;

  beforeAll(() => {
    consumer = makeConsumer(HOST_DIR);
    writeFileSync(
      join(consumer.dir, 'probe.mjs'),
      [
        'const results = {};',
        `for (const specifier of ${JSON.stringify([...DECLARED_SUBPATHS.map((s) => `${HOST_NAME}/${s.slice(2)}`), ...REFUSED])}) {`,
        '  try {',
        '    const mod = await import(specifier);',
        "    results[specifier] = { ok: true, exports: Object.keys(mod).filter((k) => k !== 'default').length };",
        '  } catch (error) {',
        '    results[specifier] = { ok: false, code: error.code ?? null };',
        '  }',
        '}',
        'process.stdout.write(JSON.stringify(results));',
      ].join('\n'),
    );
  });

  afterAll(() => {
    if (consumer !== undefined) rmSync(consumer.dir, { recursive: true, force: true });
  });

  it('resolves every declared subpath and refuses the five that are not', () => {
    const raw = execFileSync(process.execPath, ['probe.mjs'], {
      cwd: consumer.dir,
      encoding: 'utf8',
    });
    const results = JSON.parse(raw) as Record<
      string,
      { ok: boolean; exports?: number; code?: string | null }
    >;

    for (const subpath of DECLARED_SUBPATHS) {
      const specifier = `${HOST_NAME}/${subpath.slice(2)}`;
      expect(results[specifier], specifier).toEqual({
        ok: true,
        exports: expect.any(Number) as unknown as number,
      });
      expect(results[specifier]!.exports, specifier).toBeGreaterThan(0);
    }

    for (const specifier of REFUSED) {
      expect(results[specifier], specifier).toEqual({
        ok: false,
        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
      });
    }
  }, 120_000);
});
