/**
 * `endora new instance`, run as a command — the exit codes, the guarantee that
 * it cannot hang, and the tree it actually writes.
 *
 * ## Why this is spawned and the file beside it is not
 *
 * Three things are only true of a **process**, and every one of them is
 * invisible to a unit test of the same functions:
 *
 *   * **The exit code.** `instance-tree.md` §4 maps eight refusal classes onto
 *     three codes; the class is a field on an error and the code is what the
 *     argv layer does with it. A test of the error asserts half the contract.
 *   * **The non-interactive guarantee** (`cli-product.md` R2.5c). Its own
 *     rule says it: *"this is proved by spawning each command with pipes rather
 *     than by testing a predicate"*, because the failure it prevents is a
 *     **hang**, and a hang is only observable from outside the process. Every
 *     plausible way of getting it wrong leaves the predicate correct.
 *   * **R2.2 — it runs outside any checkout of this repository.** The target
 *     here is under `os.tmpdir()` with no `pnpm-workspace.yaml`, no `.git` and
 *     no `node_modules` of ours above it, which is `cli-product.md` §1's
 *     measured starting point and the state both existing scaffolds refuse in.
 *
 * ## The install is a fixture, and that is the honest shape
 *
 * The command reads `node_modules/<scope>` beside the target — R2.3's *"the
 * packages installed beside the target directory"* — so the fixture writes one.
 * It is what a client's `pnpm add` produces, and it is what
 * `acceptance:package-schema` already does rather than reaching into this
 * checkout. The full-population run against this repository's real 77 packages
 * is reported separately; it is not asserted here, because a test whose answer
 * moves every time a module package is added asserts nothing stable.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

const ENDORA = fileURLToPath(new URL('../dist/bin/endora.js', import.meta.url));

/**
 * How long a run gets before it is called hung.
 *
 * The assertion is not about speed: a run that has not exited by here is
 * waiting for an answer nobody can give it, which is the defect.
 */
const TIMEOUT_MS = 60_000;

/**
 * …and vitest is told about it, because otherwise it never happens.
 *
 * The base configuration's `testTimeout` is **10 s** and every test in this file
 * spawns between one and four processes, so vitest's own clock fires first and
 * the 60 s hang detector above could never reach a verdict — the assertion this
 * file exists to make was unreachable by construction. It is a flake under load
 * rather than a silent pass, which is how it surfaced: three tests here timed
 * out in a full `pnpm --filter '!backend' run test` and every one of them passed
 * on its own seconds later.
 *
 * The slack is one hang's worth beyond the detector, not four: a test whose four
 * runs all hang is red either way, and the only thing that changes is which
 * clock says so.
 */
vi.setConfig({ testTimeout: TIMEOUT_MS + 10_000 });

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

interface SpawnResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Run with pipes on both descriptors, and **close stdin at once**.
 *
 * Closing it is what makes a hang a hang rather than a slow test: a `readline`
 * over a closed pipe resolves with an empty line, so a command that prompted
 * anyway would spin on the re-ask and still be here when the timeout fires.
 */
function run(args: readonly string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENDORA, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // The inherited environment may already carry `CI`, which would satisfy
      // one of R3.1's conditions for whichever reason the host had. Cleared, so
      // the case below tests the TTY condition it names.
      env: { ...process.env, CI: '', GITLAB_CI: '', GITHUB_ACTIONS: '' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end();
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

/** A client's install, as `pnpm add` leaves it: packages under `node_modules`. */
function installFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ni-cmd-'));
  scratch.push(root);
  const scopeDir = join(root, 'node_modules', '@endora-commerce');

  const write = (name: string, manifest: unknown, source: string): void => {
    const dir = join(scopeDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    writeFileSync(join(dir, 'manifest.js'), source, 'utf8');
  };

  write(
    'platform',
    {
      name: '@endora-commerce/platform',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'platform' },
      exports: { '.': { default: './manifest.js' } },
      peerDependencies: {
        '@mikro-orm/core': '^6',
        '@mikro-orm/postgresql': '^6',
        fastify: '^5',
        zod: '^4',
      },
      dependencies: { ioredis: '^5.10.1' },
    },
    'export {};\n',
  );
  write(
    'mod-settings',
    {
      name: '@endora-commerce/mod-settings',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'settings' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'settings', dependencies: [], activation: { nonDeactivatable: true, reason: 'settings is too important to be absent from a deployment' } };\n`,
  );
  write(
    'mod-blog',
    {
      name: '@endora-commerce/mod-blog',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'blog' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'blog', dependencies: ['settings'] };\n`,
  );
  return root;
}

describe('endora new instance, as a process', () => {
  it('R2.5c — it never blocks on a prompt nobody can answer', async () => {
    const root = installFixture();
    const result = await run(['new', 'instance', join(root, 'acme-shop')], root);
    // The assertion is **that the process exited**; the code is what it exited
    // with. A hang leaves `timedOut` true and a SIGKILL signal.
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(result.code).toBe(0);
  });

  it('R2.2 — it runs outside any checkout, and writes the tree there', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(['new', 'instance', target], root);
    expect(result.code).toBe(0);

    // What the contract says the tree contains.
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      name: string;
      private: boolean;
      dependencies: Record<string, string>;
      engines: { node: string };
    };
    // R1.2 — the `dependencies` are the module list, and there is no other.
    expect(manifest.name).toBe('acme-shop');
    expect(manifest.private).toBe(true);
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@endora-commerce/mod-settings',
      '@endora-commerce/platform',
    ]);
    // R2.3 — `engines.node` is the CLI's own declaration, not a value it chose.
    expect(manifest.engines.node).toBe(
      (
        JSON.parse(
          readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
        ) as { engines: { node: string } }
      ).engines.node,
    );

    // R5.4 — one workspace, and the members it declares are the ones on disk.
    //
    // Derived in both directions rather than compared to a list: which members
    // this run writes depends on what resolved (§2.4, §2.4a), so a literal here
    // would be a second declaration of the member set — the one thing R5.4 is
    // about. The **files** at the root are named, because those are §2.1's and
    // do not move.
    const workspace = readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('- backend');
    const declared = [...workspace.matchAll(/^\s+-\s+(\S+)$/gm)].map((match) => match[1]!);
    expect(declared).toContain('backend');
    for (const member of declared) {
      expect(existsSync(join(target, member, 'package.json')), `${member} is declared`).toBe(true);
    }
    const entries = readdirSync(target).sort();
    expect(entries.filter((entry) => !declared.includes(entry))).toEqual([
      '.env.example',
      '.gitignore',
      'README.md',
      'apps',
      // §2.7 — the example deployment files, which a scaffolded instance was
      // handed none of until feature 122. `deploy/` is not a workspace member:
      // an example that deploys the admin is not the admin project's file.
      'deploy',
      'package.json',
      'pnpm-workspace.yaml',
      'tsconfig.json',
    ]);

    // §2.2 — the deployment directory, defaulting to the workspace name.
    expect(readFileSync(join(target, 'apps/acme-shop/divergence.ts'), 'utf8')).toContain(
      'omittedModules: []',
    );
    expect(readdirSync(join(target, 'apps/acme-shop/modules'))).toEqual(['.gitkeep']);

    // R5.5 / R1.3 — no copy of anything R2.2 there forbids, and no `.npmrc`
    // without `--registry`.
    expect(readdirSync(target)).not.toContain('.npmrc');
    expect(readdirSync(target)).not.toContain('storefront');

    // R3.3 — none of the four backend registries.
    expect(readdirSync(join(target, 'backend/src')).sort()).toEqual([
      'index.ts',
      'migrate.ts',
      'mikro-orm.config.ts',
      'module-commands',
      'worker.ts',
    ]);

    // R2.5a — the provenance line, on the operator's own terminal.
    expect(result.stdout).toContain('defaulted=0');
    // R3.4 — the second command, learned from the first.
    expect(result.stdout).toContain('endora new storefront');
  });

  it('R5.3 — `--dry-run` reports the plan and writes nothing', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(['new', 'instance', target, '--dry-run'], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('dry run, nothing written');
    expect(result.stdout).toContain('would write backend/src/index.ts');
    expect(readdirSync(root)).not.toContain('acme-shop');
    // NFR-002 — nothing is copied, so nothing is rewritten. A rewrite line in
    // this output would be evidence that something was copied.
    expect(result.stdout).not.toMatch(/ -> /);
  });

  it('F1…F4 exit 1', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'mine.txt'), 'x', 'utf8');

    const occupied = await run(['new', 'instance', target], root);
    expect(occupied.code).toBe(1);
    expect(occupied.stderr).toContain('[F1]');

    const unknownModule = await run(
      ['new', 'instance', join(root, 'other'), '--module', 'nope'],
      root,
    );
    expect(unknownModule.code).toBe(1);
    expect(unknownModule.stderr).toContain('[F3]');

    const badDeployment = await run(
      ['new', 'instance', join(root, 'other'), '--deployment', 'Not A Name'],
      root,
    );
    expect(badDeployment.code).toBe(1);
    expect(badDeployment.stderr).toContain('[F4]');
  });

  it('F5…F8 exit 2, and never 1', async () => {
    const root = installFixture();

    const badRegistry = await run(
      ['new', 'instance', join(root, 'acme-shop'), '--registry', 'not-a-url'],
      root,
    );
    expect(badRegistry.code).toBe(2);
    expect(badRegistry.stderr).toContain('[F5]');

    // F6 — a directory with no platform installed beside it. This is the state
    // a client who has installed nothing yet is in, and a scaffold written from
    // values it could not read would be worse than no scaffold.
    const empty = mkdtempSync(join(tmpdir(), 'ni-empty-'));
    scratch.push(empty);
    const noPlatform = await run(['new', 'instance', join(empty, 'acme-shop')], empty);
    expect(noPlatform.code).toBe(2);
    expect(noPlatform.stderr).toContain('[F6]');
    expect(noPlatform.stderr).toContain('@endora-commerce/platform');
  });

  it('§3.2 — with no `--module` it writes the smallest set that composes', async () => {
    const root = installFixture();
    const result = await run(['new', 'instance', join(root, 'acme-shop'), '--dry-run'], root);
    // The fixture locks exactly one module, so the derivation is visible: the
    // number is not written anywhere and un-locking it would change this run.
    expect(result.stdout).toContain('[modules] 1 in the set');
    expect(result.stdout).toContain('the modules the platform cannot run without');
  });

  it('§3.1 — a named set is unioned with its own closure', async () => {
    const root = installFixture();
    const result = await run(
      ['new', 'instance', join(root, 'acme-shop'), '--module', 'blog', '--dry-run'],
      root,
    );
    expect(result.stdout).toContain('[modules] 2 in the set');
    expect(result.stdout).toContain('added by closure: settings');
  });

  it('R5.7 — `--registry` writes an `.npmrc` naming the scope, and never a token', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(
      ['new', 'instance', target, '--registry', 'https://registry.example.com/api/v4/'],
      root,
    );
    expect(result.code).toBe(0);
    const npmrc = readFileSync(join(target, '.npmrc'), 'utf8');
    expect(npmrc).toContain('@endora-commerce:registry=https://registry.example.com/api/v4/');
    expect(npmrc).toContain('${ENDORA_NPM_TOKEN}');
    // The file is committable by construction: no literal credential in it.
    expect(npmrc).not.toMatch(/_authToken=[^$\n]/);
  });

  it('R2.4 — an unknown subject names this build\'s three generators', async () => {
    const root = installFixture();
    const result = await run(['new', 'nonsense'], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('new instance');
  });
});

/**
 * `--topology`, as a process — feature 122 T010, T011 and T017.
 *
 * The file beside this one asserts the rendered content; what only a spawn can
 * answer is whether the flag reaches the renderer at all, what an unrecognised
 * value exits with, and whether the operator is told about the files on their
 * disk. Every assertion below is over the **tree on disk**, not over the plan:
 * the whole gap this feature closes is that a client's `deploy/` was empty.
 */
describe('endora new instance --topology, as a process', () => {
  const deployTree = (target: string): readonly string[] => {
    const walk = (dir: string, prefix: string): readonly string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`],
      );
    return [...walk(join(target, 'deploy'), '')].sort();
  };

  it('with no flag, a client gets the single-host examples on disk', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(['new', 'instance', target], root);
    expect(result.code).toBe(0);
    // The admin member is absent from this fixture — nothing installs the admin
    // shell — so this is the member-derived set with no admin artefact in it.
    expect(deployTree(target)).toEqual([
      '.env.example',
      'Dockerfile.backend',
      'README.md',
      'compose.prod.yml',
      'nginx.example.conf',
    ]);
    expect(readFileSync(join(target, 'deploy', 'compose.prod.yml'), 'utf8')).toContain(
      'services:',
    );
  });

  it('`--topology three-host` writes three per-host compose files and their `.env`s', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(['new', 'instance', target, '--topology', 'three-host'], root);
    expect(result.code).toBe(0);
    expect(deployTree(target)).toEqual([
      'Dockerfile.backend',
      'README.md',
      'three-host/.env.backend.example',
      'three-host/.env.storefront.example',
      'three-host/compose.backend.yml',
      'three-host/compose.storefront.yml',
    ]);
    // T017 — the next-steps block gains the three-host line, printed to the
    // operator rather than left to be discovered in the directory listing.
    expect(result.stdout).toContain('deploy/three-host/');
    expect(result.stdout).toContain('not interchangeable');
  });

  it('T011 — nothing the tooling reads back records the choice', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    await run(['new', 'instance', target, '--topology', 'three-host'], root);
    for (const file of ['package.json', 'pnpm-workspace.yaml']) {
      expect(readFileSync(join(target, file), 'utf8')).not.toMatch(/topolog/i);
    }
  });

  it('T011 — an unrecognised value is an operator-fixable refusal naming the vocabulary', async () => {
    const root = installFixture();
    const target = join(root, 'acme-shop');
    const result = await run(['new', 'instance', target, '--topology', 'two-host'], root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('two-host');
    expect(result.stderr).toContain('single-host | three-host');
    // R5.2 — a run that refuses has written nothing.
    expect(existsSync(target)).toBe(false);
  });

  it('`--help` names the flag and both values', async () => {
    const root = installFixture();
    const result = await run(['--help'], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--topology');
    expect(result.stdout).toContain('three-host');
  });
});
