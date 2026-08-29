/**
 * The argv layer's exit codes, and the one property every refusal has in
 * common: **it writes nothing** (`contracts/module-scaffold-output.md` §7 item
 * 5, asserted on the filesystem rather than on the message).
 *
 * `main` is exercised rather than a hand-built option record, so the parsing,
 * the dispatch and the error classification all run.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../src/bin/endora.js';
import { runNewModule } from '../src/new-module/index.js';
import { ScaffoldHostError } from '../src/new-module/spec.js';

/** This checkout, which is the host every in-repo run resolves. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Runs `main` with stdout and stderr captured, so a test asserts on both. */
async function run(argv: readonly string[], cwd = REPO_ROOT) {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  try {
    const code = await main(argv, cwd);
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

describe('the program', () => {
  it('prints its usage and exits 0 for --help', async () => {
    const result = await run(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('endora new module <id>');
  });

  it('exits 1 with the usage when given nothing to do', async () => {
    expect((await run([])).code).toBe(1);
  });

  it('refuses an unrecognised command by name', async () => {
    const result = await run(['doctor']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown command "doctor"');
  });

  it('refuses an unrecognised flag rather than ignoring it', async () => {
    const result = await run(['new', 'module', 'scaffold_fixtures', '--tier', 'pro']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('tier');
  });

  it('says why `check` is not in this build rather than pretending it ran', async () => {
    const result = await run(['check']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not in this build');
  });

  it('refuses a subject `new` does not generate', async () => {
    const result = await run(['new', 'theme', 'aurora']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown subject "theme"');
  });

  it('exits 1 on a refusal the author can act on', async () => {
    const result = await run(['new', 'module', 'Demo-Widgets', '--name', 'x', '--description', 'y']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not a legal module id');
  });

  it('exits 2 outside a checkout of the platform repository', async () => {
    // Not 1: nothing the author typed is wrong. The manifest derivation reads
    // three files that only exist here, and a `2` is never reported as clean.
    const elsewhere = mkdtempSync(join(tmpdir(), 'endora-outside-'));
    try {
      const result = await run(
        ['new', 'module', 'scaffold_fixtures', '--name', 'x', '--description', 'y'],
        elsewhere,
      );

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('pnpm-workspace.yaml');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('a refusal writes nothing', () => {
  it('leaves the target directory absent when the inputs are wrong', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'endora-target-'));
    const target = join(scratch, 'scaffold_fixtures');
    try {
      const result = await run([
        'new',
        'module',
        'scaffold_fixtures',
        '--name',
        'Scaffold Fixtures',
        '--description',
        'x',
        '--dir',
        target,
        '--action',
        'open-widgets=/widgets',
      ]);

      expect(result.code).toBe(1);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a target directory that exists and is not empty', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'endora-occupied-'));
    writeFileSync(join(scratch, 'README.md'), 'mine\n', 'utf8');
    try {
      await expect(
        runNewModule({
          id: 'scaffold_fixtures',
          name: 'Scaffold Fixtures',
          description: 'x',
          dir: scratch,
          cwd: REPO_ROOT,
        }),
      ).rejects.toThrow(/exists and is not empty/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a module id this workspace already claims', async () => {
    // A duplicate id is a duplicate lifecycle registration, a duplicate settings
    // namespace and a duplicate migration owner.
    await expect(
      runNewModule({
        id: 'catalog',
        name: 'Catalog',
        description: 'x',
        dir: join(mkdtempSync(join(tmpdir(), 'endora-dup-')), 'catalog'),
        cwd: REPO_ROOT,
      }),
    ).rejects.toThrow(/already the module id of|already a module/);
  });

  it('refuses a scope the workspace does not publish under', async () => {
    await expect(
      runNewModule({
        id: 'scaffold_fixtures',
        name: 'Scaffold Fixtures',
        description: 'x',
        scope: '@someone-else',
        cwd: REPO_ROOT,
      }),
    ).rejects.toThrow(/is not the scope this workspace publishes under/);
  });
});

describe('--dry-run', () => {
  it('reports the files it would write and writes none of them', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'endora-dry-'));
    const target = join(scratch, 'scaffold_fixtures');
    try {
      const result = await runNewModule({
        id: 'scaffold_fixtures',
        name: 'Scaffold Fixtures',
        description: 'A worked example.',
        dir: target,
        dryRun: true,
        cwd: REPO_ROOT,
      });

      expect(result.dryRun).toBe(true);
      expect(result.files.map((file) => file.path)).toContain('src/manifest.ts');
      expect(result.renderedManifests).toEqual([]);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('the host it refuses to guess about', () => {
  it('names the three inputs the manifest derivation reads', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'endora-host-'));
    try {
      await expect(
        runNewModule({ id: 'scaffold_fixtures', name: 'x', description: 'y', cwd: elsewhere }),
      ).rejects.toThrow(ScaffoldHostError);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
