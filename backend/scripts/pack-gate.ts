/**
 * `pack-gate` — every publishable package packs into a tarball a consumer can
 * actually use.
 *
 * The subject is the **artefact**, not the source tree, and this is the only
 * gate in this pipeline whose subject is that. `quality` type-checks sources,
 * `test:backend` runs vitest against sources, `overlay:check` renders generated
 * files from sources. Every one of the four defects
 * `backend/scripts/lib/pack-assert.ts` refuses is a property of the tarball and
 * is invisible in this checkout by construction — a workspace link resolves an
 * `exports` subpath against the *source* directory, and a `workspace:` range
 * resolves against the workspace.
 *
 * It is **not** a `check-*` script and must not become one, on the boot gate's
 * reasoning: `check-read-size.test.ts` spawns every one of those, and packing
 * every package inside a unit run is not a test. What a test *can* drive is the
 * judgement, which is why the judgement is a separate module with its own red
 * proofs (`backend/test/unit/ci/pack-gate.test.ts`).
 *
 * ## What it does
 *
 * For every **versionable** workspace member — the family/application split is
 * `classifyWorkspaceMembers`', shared with `check:release-intent`, so the two
 * cannot disagree about which members a consumer installs by version — it runs
 * `pnpm pack` into a scratch directory, lists the tarball, reads the
 * `package.json` inside it, and hands all of that to `judgePackedPackages`.
 * A package declaring a `bin` is additionally **extracted and run**, because
 * the one defect in this family that has actually shipped was a binary that was
 * present, executable, exited 0, and printed nothing.
 *
 * ## Exit codes, and the five ways it refuses
 *
 * `0` every package packs clean; `1` a finding; `2` it did not read. The
 * refusals are the states in which a `findings=0` would be a vacuous pass: a
 * workspace that produced no member at all; a **non-negated glob that produced
 * none**, which is issue #215 over this population (move `packages/` and the
 * four application manifests still answer every question `pnpm-workspace.yaml`
 * asks); no versionable member, so the gate has no subject; a `pnpm pack` that
 * produced no tarball, which must never be credited as a package with nothing
 * wrong with it; and a tarball this run could not list.
 *
 * The `read:` line's independent author is the **workspace file**:
 * `workspace-globs:<covered>/<expected>` is `pnpm-workspace.yaml`'s own answer
 * to how many entries should produce a member, against how many did — a second
 * program's derivation, since this gate finds its packages by packing them.
 *
 * ## Preconditions, and the one that bites
 *
 * `pnpm pack` packs **what is on disk**. An unbuilt workspace therefore packs
 * tarballs with no code in them, which is `no-compiled-code` and is a true
 * finding rather than a false one — but it is a finding about the run and not
 * about the tree, so this gate builds first unless `--no-build` says the caller
 * has. That is the same rule `publish:packages` follows for the same reason.
 */
/* eslint-disable no-console -- CLI gate: stdout/stderr is the interface. */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSizeRefusal, reportReadSize, type ReadCoverage } from './lib/read-size.js';
import {
  judgePackedPackages,
  binTargets,
  type BinRun,
  type PackedEntry,
  type PackedPackage,
} from './lib/pack-assert.js';
import {
  classifyWorkspaceMembers,
  nodeWorkspaceFs,
} from './lib/workspace-packages.js';

const PREFIX = '[pack-gate]';

/** Exit 2 with one sentence, never a number over a population it did not read. */
function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

/** `tar -tzvf`, parsed into `{ path, size }` with the leading `package/` stripped. */
function listTarball(tarball: string): readonly PackedEntry[] | null {
  const listed = spawnSync('tar', ['-tzvf', tarball], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) return null;
  const entries: PackedEntry[] = [];
  for (const line of listed.stdout.split('\n')) {
    // `-rw-r--r-- 0/0   1234 2026-09-05 20:00 package/dist/index.js`
    const match = /^(\S+)\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/.exec(line.trim());
    if (match === null) continue;
    const [, mode, size, path] = match;
    if (mode!.startsWith('d')) continue;
    if (!path!.startsWith('package/')) continue;
    entries.push({ path: path!.slice('package/'.length), size: Number(size) });
  }
  return entries;
}

/** `package/<path>` out of the tarball, as text, or `null`. */
function readFromTarball(tarball: string, path: string): string | null {
  const read = spawnSync('tar', ['-xzOf', tarball, `package/${path}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return read.status === 0 ? read.stdout : null;
}

/**
 * Where a declared dependency is installed in this checkout, or `null`.
 *
 * `node_modules/<name>` under the package's own directory first, then under the
 * repository root — pnpm writes the first for every dependency a workspace
 * member declares, and the second for the hoisted remainder. Deliberately
 * **not** `require.resolve('<name>/package.json')`, which was the first
 * spelling and is wrong for a reason worth writing down: that call honours the
 * dependency's own `exports` map, and `@endora-commerce/contracts` publishes
 * `"."` and `"./*"` with no `./package.json` subpath, so the resolution fails
 * for a package that is installed and perfectly fine. A resolver that reports a
 * present dependency as absent turns this gate's own linking into the finding.
 */
function installedPackageDir(
  sourceDir: string,
  repoRoot: string,
  name: string,
): string | null {
  for (const base of [sourceDir, repoRoot]) {
    const candidate = join(base, 'node_modules', name);
    try {
      if (statSync(candidate).isDirectory()) return realpathSync(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Extract the tarball and run its `bin`, from the extracted tree, with exactly
 * the dependencies its packed manifest declares.
 *
 * `--help` is the argument, because it is the one every command answers and the
 * one whose *silence* is the defect: a program that prints its usage has
 * demonstrably reached its argv layer. It is run with `node` explicitly rather
 * than through the shebang, so a tarball that lost the executable bit is still
 * judged on what it prints — the bit is npm's job at link time and not this
 * gate's subject.
 *
 * **The dependency linking is the load-bearing half and was measured into
 * existence.** A first version ran the binary out of a bare extraction with no
 * `node_modules` at all; `endora --help` printed a 1115-byte
 * `ERR_MODULE_NOT_FOUND` stack trace and passed, because a rule that asks only
 * for output is satisfied by a crash. So each declared runtime dependency is
 * symlinked in, resolved **from the source package's own directory** — which
 * makes the population exactly the manifest's, and therefore makes an
 * *undeclared* runtime dependency a `bin-does-not-run` finding rather than an
 * invisible one. It is a symlink and not an install because an install is a
 * network round trip: the gate must run in a job that has no registry
 * credential, and the resolution it needs is already in this checkout.
 */
function runPackedBin(
  tarball: string,
  scratch: string,
  repoRoot: string,
  sourceDir: string,
  manifest: Readonly<Record<string, unknown>>,
  command: string,
  target: string,
): BinRun {
  const into = join(scratch, 'extracted');
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const extracted = spawnSync('tar', ['-xzf', tarball, '-C', into], { encoding: 'utf8' });
  if (extracted.status !== 0) {
    return { command, target, exitCode: extracted.status ?? -1, output: '' };
  }
  const modules = join(into, 'package', 'node_modules');
  for (const field of ['dependencies', 'optionalDependencies']) {
    const block = manifest[field];
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const name of Object.keys(block as Record<string, unknown>)) {
      const resolved = installedPackageDir(sourceDir, repoRoot, name);
      // A dependency this checkout cannot place is left unlinked rather than
      // refused: the run then fails the way a consumer's would, which is the
      // verdict, and a refusal here would report the checkout instead.
      if (resolved === null) continue;
      mkdirSync(join(modules, dirname(name)), { recursive: true });
      rmSync(join(modules, name), { recursive: true, force: true });
      symlinkSync(resolved, join(modules, name), 'dir');
    }
  }
  const run = spawnSync(process.execPath, [join(into, 'package', target), '--help'], {
    encoding: 'utf8',
    // A binary that waits for input would otherwise hang the gate; there is no
    // interactivity in this CLI by contract, so an empty stdin is the honest
    // shape of "a consumer ran it".
    input: '',
    timeout: 60_000,
  });
  return {
    command,
    target,
    exitCode: run.status ?? -1,
    output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
  };
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const argv = process.argv.slice(2);
  const build = !argv.includes('--no-build');

  const { members, globCoverage } = classifyWorkspaceMembers(repoRoot, nodeWorkspaceFs());
  if (members.length === 0) {
    refuse(
      'the workspace globs matched no package at all, so there is nothing to pack — refusing ' +
        'to report a vacuous pass.',
    );
  }
  const versionable = members.filter((member) => member.family);
  if (versionable.length === 0) {
    refuse(
      'no workspace member is versionable (every entry that produced one is a literal ' +
        'directory, which is an application), so this gate has no subject.',
    );
  }

  if (build) {
    console.log(`${PREFIX} building every package first — \`pnpm pack\` packs what is on disk.`);
    const built = spawnSync('pnpm', ['run', 'build:packages'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (built.status !== 0) {
      refuse(
        '`pnpm run build:packages` failed, so every tarball this run would produce would be ' +
          'stale or empty. That is a finding about the run rather than about the tree.',
      );
    }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'endora-pack-gate-'));
  const packed: PackedPackage[] = [];
  try {
    for (const member of versionable) {
      const dir = relative(repoRoot, member.dir);
      const out = join(scratch, 'tarballs');
      mkdirSync(out, { recursive: true });
      const before = new Set(readdirSync(out));
      const result = spawnSync('pnpm', ['pack', '--pack-destination', out], {
        cwd: member.dir,
        encoding: 'utf8',
      });
      const produced = readdirSync(out).filter((name) => !before.has(name));
      if (result.status !== 0 || produced.length !== 1) {
        refuse(
          `\`pnpm pack\` in ${dir} produced ${String(produced.length)} tarball(s) and exited ` +
            `${String(result.status)}. A package that did not pack must never be credited as a ` +
            `package with nothing wrong with it.\n${result.stderr ?? ''}`,
        );
      }
      const tarball = join(out, produced[0]!);
      const entries = listTarball(tarball);
      if (entries === null) {
        refuse(
          `the tarball ${produced[0]!} could not be listed, so nothing about ${member.name} was ` +
            'read. Reporting it clean would be a verdict this run did not measure.',
        );
      }
      const manifestText = readFromTarball(tarball, 'package.json');
      let packedManifest: Record<string, unknown> = {};
      try {
        packedManifest =
          manifestText === null ? {} : (JSON.parse(manifestText) as Record<string, unknown>);
      } catch {
        // An unparseable manifest is `missing-packed-manifest`, which the
        // judgement reports; there is simply no `bin` to run.
      }
      const bin = binTargets(packedManifest)[0];
      packed.push({
        name: member.name,
        dir,
        entries,
        manifestText,
        binRun:
          bin === undefined || !entries.some((entry) => entry.path === bin.target)
            ? null
            : runPackedBin(
                tarball,
                scratch,
                repoRoot,
                member.dir,
                packedManifest,
                bin.command,
                bin.target,
              ),
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const { findings, sites } = judgePackedPackages(packed);
  const globs = [...globCoverage.keys()];
  const coverage: readonly ReadCoverage[] = [
    {
      source: 'workspace-globs',
      expected: globs.length,
      covered: globs.filter((glob) => (globCoverage.get(glob) ?? 0) > 0).length,
    },
  ];
  // The floor is part of the analysis rather than of the printing, so it holds
  // whether or not there is anything to report.
  const refusal = readSizeRefusal({ prefix: PREFIX, files: packed.length, sites, coverage });
  if (refusal !== null) refuse(refusal.message);

  for (const finding of findings) {
    console.error(`  - [${finding.kind}] ${finding.subject} ${finding.message}`);
  }
  reportReadSize({ prefix: PREFIX, files: packed.length, sites, coverage });
  console.log(
    `${PREFIX} packages=${String(packed.length)} ` +
      `bins=${String(packed.filter((entry) => entry.binRun !== null).length)} ` +
      `violations=${String(findings.length)}`,
  );
  process.exit(findings.length > 0 ? 1 : 0);
}

main();
