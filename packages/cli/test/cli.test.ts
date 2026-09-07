/**
 * The argv layer's exit codes, and the one property every refusal has in
 * common: **it writes nothing** (`contracts/module-scaffold-output.md` §7 item
 * 5, asserted on the filesystem rather than on the message).
 *
 * `main` is exercised rather than a hand-built option record, so the parsing,
 * the dispatch and the error classification all run.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ESTATE } from '../src/check/index.js';
import { isDirectEntry, main } from '../src/bin/endora.js';
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

  it('carries the sidebar section --admin names all the way through argv', async () => {
    // The flag takes a value rather than being a boolean, because the one
    // judgement the layer needs — where in the operator's sidebar this belongs
    // — is not one the tool can default. A bare `--admin` is a parseArgs
    // refusal, and an unknown section is a refusal with the set named.
    const bare = await run(['new', 'module', 'scaffold_fixtures', '--admin']);
    expect(bare.code).toBe(1);

    const unknown = await run([
      'new',
      'module',
      'scaffold_fixtures',
      '--name',
      'Scaffold Fixtures',
      '--description',
      'A worked example.',
      '--permission',
      'scaffold_fixtures:read=View them',
      '--admin',
      'widgets',
    ]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('is not a sidebar section');
    expect(unknown.stderr).toContain('system');
  });

  it('refuses `check` over a directory that is not a module package, naming what it looked for', async () => {
    // Feature 101, Phase 1: `check` is in this build. What replaced the old
    // refusal is not a weaker one — the incompleteness is now *printed* per
    // rule and the run exits 2 while any rule is `pending` — so this is the
    // refusal that is left: a subject the command cannot identify. It names the
    // declaration, because a clean verdict over nothing is the failure the
    // paragraph this replaced was written against.
    const result = await run(['check'], tmpdir());

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('endora: { "type": "module"');
  });

  it('lists the whole estate, so nothing it does not run is invisible', async () => {
    const result = await run(['check', '--list-rules']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('check:nul-bytes');
    expect(result.stdout).toContain('check:doc-snippets');
    expect(result.stdout.trim().split('\n')).toHaveLength(ESTATE.length);
  });

  it('refuses a --rule the estate does not hold', async () => {
    const result = await run(['check', '--rule', 'check:invented']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--list-rules');
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

describe('the entry guard, and the install shape that made it silent', () => {
  /**
   * **The defect this covers produced no output and exit 0.** `endora --help`,
   * run from a registry install, printed nothing at all — the shape the brief
   * for feature 104 calls *"a published package that silently half-works"*, and
   * worse than a refusal because there is nothing for the reader to act on.
   *
   * The cause is entirely in how the entry is recognised. A package manager
   * does not invoke `dist/bin/endora.js` directly: pnpm writes a shim that
   * execs `node "$basedir/../@endora-commerce/cli/dist/bin/endora.js"`, a path
   * that runs through the `node_modules/@endora-commerce/cli` **symlink** into
   * the content-addressed store, and npm links the bin itself. Either way
   * `process.argv[1]` is the *linked* path, while Node's ESM loader realpaths a
   * module URL before it evaluates it — so `import.meta.url` is the store path,
   * and a comparison of the two strings is false for every installed consumer
   * and true only in the checkout that developed it.
   *
   * So the predicate compares the paths **after** resolving links, and both
   * directions are proven: the entry recognised through a link, and an
   * unrelated `argv[1]` still not recognised, which is what keeps `import
   * { main }` from running the program as a side effect.
   */
  const linkFixture = () => {
    const dir = mkdtempSync(join(tmpdir(), 'endora-entry-'));
    const target = join(dir, 'endora.js');
    const link = join(dir, 'endora-link.js');
    writeFileSync(target, 'export {};\n');
    symlinkSync(target, link);
    return { dir, target, link };
  };

  it('recognises the entry when the package manager invoked it through a link', () => {
    const { dir, target, link } = linkFixture();
    try {
      expect(isDirectEntry(link, pathToFileURL(target).href)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not recognise an unrelated entry, so importing `main` runs nothing', () => {
    const { dir, target } = linkFixture();
    try {
      expect(isDirectEntry(join(dir, 'some-other-program.js'), pathToFileURL(target).href)).toBe(
        false,
      );
      expect(isDirectEntry(undefined, pathToFileURL(target).href)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * An `argv[1]` naming nothing on disk is not the entry, and it must not be a
   * throw either: `realpath` raises `ENOENT` and an uncaught one at module load
   * would turn a wrong guess about the invocation into a crash before any
   * command has been dispatched.
   */
  it('answers no for an entry that is not on disk', () => {
    const { dir, target } = linkFixture();
    try {
      expect(isDirectEntry(join(dir, 'gone.js'), pathToFileURL(target).href)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
