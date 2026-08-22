import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A synthetic repository with a copy of `check-lock-claims` inside it (issue
 * #279).
 *
 * The check derives every root from its own location — `<script>/..` for the
 * backend, `<script>/../../packages/contracts/src` for the contracts package —
 * so a copy of the script at `<tmp>/backend/scripts/` reads `<tmp>` and nothing
 * else.
 *
 * It exists because the widening this fixture proves is a change to **which
 * files become sources**, and every proof the check already had enters below
 * that: they hand `checkLockClaims` a source map, which is the value
 * `collectArtifacts` produces. A proof entering there is green whether or not
 * the contracts package is in the population, so it cannot protect the
 * population — the property issue #130 is about. Only a tree on disk enters
 * above the walk, the barrel floor and the analysis at once.
 *
 * The staged tree is deliberately minimal and self-consistent: two fixture
 * modules whose manifests are the whole module population, a stub manifest
 * index registering exactly those two, one ledger shard so part 1 of the
 * population is not empty, and a contracts package that publishes itself
 * through a barrel the way the real one does. Nothing in it names a real module
 * id, so a claim the fixture writes is judged against the fixture's manifests.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX = join(REPO_ROOT, 'backend', 'node_modules', '.bin', 'tsx');
const SCRIPT = join(REPO_ROOT, 'backend', 'scripts', 'check-lock-claims.ts');
/** The libraries the check imports by relative path. */
const LIBS: readonly string[] = [
  'module-population.ts',
  'module-roots.ts',
  'read-size.ts',
  'switchable-modules.ts',
  'workspace-packages.ts',
];

/** The module the fixture manifests declare `nonDeactivatable`. */
export const FIXTURE_LOCKED = 'fixture_locked';
/** The module the fixture manifests give an activation control. */
export const FIXTURE_SWITCHABLE = 'fixture_switchable';

/** Where a contract the fixture writes lands, repository-relative. */
export const CONTRACT_DIRECTORY = 'packages/contracts/src';

const STUB_INDEX = [
  '// Fixture stand-in for the generated manifest index.',
  'export const DISCOVERED_MANIFESTS = [',
  `  { id: '${FIXTURE_LOCKED}', manifest: { id: '${FIXTURE_LOCKED}', ` +
    "activation: { nonDeactivatable: true, reason: 'the platform has no off state for it' } } },",
  `  { id: '${FIXTURE_SWITCHABLE}', manifest: { id: '${FIXTURE_SWITCHABLE}', ` +
    `activation: { settingCode: '${FIXTURE_SWITCHABLE}.enabled', default: true } } },`,
  '];',
  '',
].join('\n');

export interface LockClaimsFixture {
  readonly root: string;
  /** Writes a contract under `packages/contracts/src`, barrel unchanged. */
  writeContract(name: string, source: string): void;
  /** Deletes a contract the barrel still re-exports — a short walk. */
  removeContract(name: string): void;
  /** Replaces the barrel, so a proof can stage one that declares nothing. */
  writeBarrel(source: string): void;
  run(args?: readonly string[]): { status: number | null; output: string };
  cleanup(): void;
}

/**
 * The tree, with one clean contract in it.
 *
 * `published.ts` carries a claim that **agrees** with the fixture manifests, so
 * an untouched fixture exits 0 and every red below is the file the proof wrote
 * rather than the fixture itself.
 */
export function createLockClaimsFixture(): LockClaimsFixture {
  const root = mkdtempSync(join(tmpdir(), 'lock-claims-check-'));
  const scripts = join(root, 'backend', 'scripts');
  const contracts = join(root, CONTRACT_DIRECTORY);
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  mkdirSync(join(scripts, 'ledgers'), { recursive: true });
  mkdirSync(contracts, { recursive: true });
  copyFileSync(SCRIPT, join(scripts, 'check-lock-claims.ts'));
  for (const lib of LIBS) {
    copyFileSync(join(REPO_ROOT, 'backend', 'scripts', 'lib', lib), join(scripts, 'lib', lib));
  }
  // Without it tsx compiles the copy as CommonJS and its dynamic import of the
  // stub index dies at transform time — a failure that looks like a red proof
  // and proves nothing.
  writeFileSync(
    join(root, 'backend', 'package.json'),
    `${JSON.stringify({ name: 'lock-claims-fixture', type: 'module', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(scripts, 'ledgers', 'fixture-shard.ts'),
    "export const FIXTURE_LEDGER: Record<string, string> = {};\n",
    'utf8',
  );
  // The fixture is a pnpm workspace, because that is what the module-root
  // resolver derives from since feature 080's T040a: the globs say which
  // directories are members, and the member holding the generated index is the
  // application whose source root the module directories are looked for under.
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - backend\n  - packages/*\n',
    'utf8',
  );
  writeFileSync(
    join(contracts, '..', 'package.json'),
    `${JSON.stringify({ name: '@b2b/contracts', private: true }, null, 2)}\n`,
    'utf8',
  );
  const modules = join(root, 'backend', 'src', 'modules');
  mkdirSync(join(modules, '_lifecycle'), { recursive: true });
  writeFileSync(join(modules, '_lifecycle', 'manifest-index.generated.ts'), STUB_INDEX, 'utf8');
  for (const id of [FIXTURE_LOCKED, FIXTURE_SWITCHABLE]) {
    mkdirSync(join(modules, id), { recursive: true });
    writeFileSync(
      join(modules, id, 'manifest.ts'),
      `export const manifest = { id: '${id}' };\n`,
      'utf8',
    );
  }

  const fixture: LockClaimsFixture = {
    root,
    writeContract: (name, source) => {
      const full = join(contracts, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source, 'utf8');
    },
    removeContract: (name) => rmSync(join(contracts, name), { force: true }),
    writeBarrel: (source) => writeFileSync(join(contracts, 'index.ts'), source, 'utf8'),
    run: (args = []) => {
      const result = spawnSync(TSX, [join(scripts, 'check-lock-claims.ts'), ...args], {
        encoding: 'utf8',
        cwd: join(root, 'backend'),
      });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };

  fixture.writeBarrel("export * from './published.js';\n");
  fixture.writeContract(
    'published.ts',
    [
      '/**',
      ' * A published port whose owner the fixture manifests lock.',
      ' *',
      ` * \`${FIXTURE_LOCKED}\` is non-deactivatable, so this file agrees with the`,
      ' * manifests and an untouched fixture exits 0.',
      ' */',
      'export interface PublishedPort {',
      '  read(): Promise<string>;',
      '}',
      '',
    ].join('\n'),
  );
  return fixture;
}

/**
 * 1 when a lock claim written in a **published contract** is reported, and
 * reported against that file, 0 otherwise.
 *
 * Written as a positive over the contracts path rather than as a finding count,
 * because the number alone is green on a run that found the same claim
 * somewhere else in the staged tree — and "somewhere else" is precisely the
 * population that already existed.
 */
export function reportsClaimInAPublishedContract(
  source: string,
  kind: 'stale-lock-claim' | 'stale-switchable-claim',
): number {
  const fixture = createLockClaimsFixture();
  try {
    fixture.writeContract('orders-port.ts', source);
    fixture.writeBarrel("export * from './published.js';\nexport * from './orders-port.js';\n");
    const result = fixture.run();
    if (result.status !== 1) return 0;
    if (!result.output.includes('violations=1')) return 0;
    if (!result.output.includes(kind)) return 0;
    return result.output.includes(`${CONTRACT_DIRECTORY}/orders-port.ts`) ? 1 : 0;
  } finally {
    fixture.cleanup();
  }
}
