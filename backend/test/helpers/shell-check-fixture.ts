import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A synthetic repository for the two toolchain-free checks
 * (`scripts/check-naming.sh`, `scripts/check-language.sh`).
 *
 * Each script derives its root from its own location, so a copy placed in a
 * temp directory scans that directory and nothing else — the fixture is
 * therefore hermetic with respect to the working checkout.
 *
 * **git is faked.** The backend suite runs in `node:22.18-slim`, which ships no
 * git; that is why `quality:static` has an image of its own. A shim on `PATH`
 * answers the three questions the scripts ask, which also makes the
 * empty-listing case a one-line fixture instead of a `.gitignore` trick.
 *
 * Paths derive from `import.meta.url` — a literal path passes on the machine it
 * was typed on and fails in CI.
 */
const SCRIPTS_DIR = fileURLToPath(new URL('../../../scripts', import.meta.url));

const FAKE_GIT = `#!/bin/sh
sub="$1"
shift
case "$sub" in
  rev-parse)
    case "$1" in
      --is-inside-work-tree) exit "\${FAKE_GIT_IN_WORKTREE:-0}" ;;
      # Whether the base ref is fetched. Both scripts degrade --diff to a full
      # scan when it is not, so a diff-mode test is impossible without this
      # answer — and diff mode is where the empty-population carve-out lives.
      --verify) exit "\${FAKE_GIT_HAS_BASE_REF:-1}" ;;
      *) exit 1 ;;
    esac
    ;;
  ls-files|diff)
    if echo "$@" | grep -q 'docs/docs'; then
      cat "$FAKE_GIT_DOCS_LIST"
    else
      cat "$FAKE_GIT_FILE_LIST"
    fi
    ;;
  *) exit 1 ;;
esac
`;

/** The one module source every full-mode listing carries — see `lists`. */
export const BASELINE_MODULE_SOURCE = 'backend/src/modules/orders/order-service.ts';

/** Where the fixture's generated manifest index lives, as both scripts read it. */
const MANIFEST_INDEX = 'backend/src/manifest-index.generated.ts';

/**
 * The generated index, in the shape the composer emits and the shape
 * `lib/module-root.sh` reads (feature 080, T040a).
 *
 * The specifier lines are kept because that is what the file really looks like;
 * the **entry array** is what the ids are read from, because a specifier is
 * relative today and becomes a bare package name the moment a module ships as
 * one.
 */
function manifestIndexSource(ids: readonly string[]): string {
  const imports = ids.map((id, i) => `import { manifest as manifest${i} } from '../${id}/manifest.js';`);
  const entries = ids.map((id, i) => `  { id: '${id}', manifest: manifest${i} },`);
  return `${[...imports, 'export const DISCOVERED_MANIFESTS = [', ...entries, '];'].join('\n')}\n`;
}

/** Where a pdfmake install sits: pnpm's hoisted store, or a plain top-level one. */
export type PdfmakeLayout = 'hoisted' | 'top-level';

/**
 * Which of the two markers git writes at the root of a checkout.
 *
 * `git worktree add` writes a `.git` **file** holding `gitdir: <path>`; a clone
 * and a submodule have a `.git` **directory**. Both mean the same thing to the
 * rule — this directory is a checkout of its own and is not the source of the
 * repository the walk started in.
 */
export type NestedCheckoutKind = 'worktree' | 'clone';

export interface ShellRunResult {
  readonly status: number | null;
  readonly output: string;
}

export interface ShellCheckFixture {
  readonly root: string;
  /** Writes a file into the fixture repository, creating its directories. */
  write: (path: string, content: string) => void;
  /**
   * What the faked `git ls-files` answers for the source scan and the docs scan.
   *
   * {@link BASELINE_MODULE_SOURCE} is prepended unless `sources` is empty,
   * because a *full-mode* listing is the whole repository and both scripts now
   * reconcile it against the manifest index (issue #244): every registered
   * module must contribute a file, or the run is reading a residue and exits 2.
   * A test narrowing the listing to the one file its rule is about was only
   * ever realistic because nothing checked. Use {@link listsExactly} to build a
   * listing that genuinely misses a module.
   */
  lists: (sources: readonly string[], docs?: readonly string[]) => void;
  /** The listing verbatim, module coverage and all — the short-walk fixture. */
  listsExactly: (sources: readonly string[], docs?: readonly string[]) => void;
  /**
   * Deletes the generated manifest index, leaving the module tree standing.
   *
   * The two are genuinely separate since feature 080's T040b: the index is
   * host-owned under `backend/src/` (D-160.3), so removing the module tree
   * leaves one behind. "No index at all" and "an index registering modules the
   * tree no longer holds" are different refusals, and a test that wants the
   * first now has to ask for it.
   */
  removeManifestIndex: () => void;
  /**
   * Deletes `backend/src/modules`, leaving the rest of the fixture standing —
   * the module tree having moved, with the residue behind it (issue #215).
   */
  removeModuleTree: () => void;
  /**
   * Moves the module tree to `backend/src/<name>` — the layout change F4
   * performs, rather than the loss #215 measured. Returns the new root, so a
   * caller can write into it and list from it.
   *
   * The index stays where it is, and that is the real shape of the move since
   * T040b: it is the host's, not the module tree's, so a tree that relocates
   * leaves it in place and the derivation has to find the modules from it.
   *
   * The difference between this and `removeModuleTree` is the whole of T012: a
   * check that spells its root reports a clean tree here, and one that resolves
   * it goes on judging.
   */
  moveModuleTree: (name: string) => string;
  /**
   * Plants a second checkout of this same repository *inside* the fixture — a
   * complete module tree with its own generated index, under a directory
   * carrying the `.git` entry git itself writes.
   *
   * This is the normal state of a working machine here: agents run in
   * `git worktree`s created under `.claude/worktrees/`, so from the main
   * checkout the repo-wide walk finds one index per worktree plus its own.
   * `kind` picks which of the two markers git writes — `'worktree'` is the
   * gitfile `git worktree add` leaves, `'clone'` the `.git` directory a nested
   * clone or submodule has — because a rule that saw only one of them would
   * prune half the nested checkouts on this machine.
   *
   * Returns the nested module root, so a caller can plant a finding in it and
   * assert that the outer run did **not** report it.
   */
  nestCheckout: (path: string, kind?: NestedCheckoutKind) => string;
  /**
   * The perl Debian actually ships, as environment rather than as a mock.
   *
   * `perl-base` is Essential and is the only perl in `node:22.18-slim` and in
   * `debian:bookworm-slim`; the modules split lives in `perl-modules-5.36`, so
   * `PerlIO.pm` — and with it every `:encoding(...)` layer — is **absent**
   * until something pulls the full package in. `quality:static` and
   * `release:changeset` get it by accident, because `apt-get install git`
   * depends on it; `test:backend:unit` installs nothing and does not.
   *
   * Shadowing `PerlIO.pm` with one that dies reproduces that exactly, on any
   * machine and with the real perl: the layer's `require PerlIO` finds the
   * shadow first and the scanner aborts at `BEGIN`. Returns the env for
   * {@link ShellCheckFixture.run}.
   */
  withoutPerlIo: () => Record<string, string>;
  /**
   * A `perl` on `PATH` that refuses to run at all, for the floor rather than
   * the capability: whatever the reason a scan does not happen, the verdict it
   * would have produced must not be reported as a finding.
   */
  breakPerl: () => void;
  run: (
    script: string,
    args?: readonly string[],
    env?: Record<string, string>,
  ) => ShellRunResult;
  /**
   * A `pdfmake` install of `bytes` apparent size, for the footprint gate. The
   * file is sparse, so a 40 MB fixture costs no disk — `du -sb` reports the
   * apparent size, which is what the gate measures.
   *
   * `layout` picks which of the gate's two candidate paths the install lands
   * on. `hoisted` is what this repository actually has
   * (`node_modules/.pnpm/pdfmake@<version>/node_modules/pdfmake`), so a
   * candidate glob that stopped matching it would measure the fallback or exit
   * 2 — and only a fixture in that layout can tell.
   */
  installPdfmake: (bytes: number, layout?: PdfmakeLayout) => void;
  cleanup: () => void;
}

/**
 * A fixture repository holding one clean source file and one clean docs page,
 * so every red case is a single edit away from a run that passes.
 */
export function createShellCheckFixture(): ShellCheckFixture {
  const root = mkdtempSync(join(tmpdir(), 'endora-shell-check-'));
  const binDir = join(root, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'git'), FAKE_GIT, 'utf8');
  chmodSync(join(binDir, 'git'), 0o755);
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  for (const name of ['check-naming.sh', 'check-language.sh', 'check-pdfmake-footprint.sh']) {
    copyFileSync(join(SCRIPTS_DIR, name), join(root, 'scripts', name));
  }
  // Each script sources its shared libraries from beside itself — the read-size
  // reporter (issue #244) and the module-root resolver (feature 080, T012) — so
  // the copy needs both or the run dies before its first rule, with a status
  // that looks like an ordinary red.
  for (const library of ['read-size.sh', 'module-root.sh']) {
    copyFileSync(join(SCRIPTS_DIR, 'lib', library), join(root, 'scripts', 'lib', library));
  }

  const write = (path: string, content: string): void => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  const listsExactly = (
    sources: readonly string[],
    docs: readonly string[] = ['docs/docs/intro.md'],
  ): void => {
    write('lists/sources.txt', sources.map((s) => `${s}\n`).join(''));
    write('lists/docs.txt', docs.map((d) => `${d}\n`).join(''));
  };

  const lists = (sources: readonly string[], docs?: readonly string[]): void => {
    const covered =
      sources.length === 0 || sources.includes(BASELINE_MODULE_SOURCE)
        ? sources
        : [BASELINE_MODULE_SOURCE, ...sources];
    listsExactly(covered, docs);
  };

  write(BASELINE_MODULE_SOURCE, '// English comment.\nexport const a = 1;\n');
  // The workspace member the module tree lives in. Its `package.json` is what
  // marks `backend/src` as the application's source root — the marker that
  // travels with the layout, rather than a directory name (feature 080, T040a).
  write('backend/package.json', '{ "name": "backend" }\n');
  // A module directory is the ancestor of a `manifest.ts` named after a
  // registered id, so the fixture's one module carries one. Without it the
  // resolver answers "no module directory" and every case below exits 2.
  write('backend/src/modules/orders/manifest.ts', "export const manifest = { id: 'orders' };\n");
  // The generated manifest index. Without it a full-mode run has no expectation
  // to reconcile its listing against and exits 2 rather than reporting on a
  // residue (issue #244).
  write(MANIFEST_INDEX, manifestIndexSource(['orders']));
  // A correctly module-scoped migration. `check-naming.sh`'s class-scope rule
  // reads the filesystem, not the listing, and exits 2 on a tree with no
  // migration at all — so without this file every red case above would come
  // back 2 instead of the finding it is testing for.
  write(
    'backend/src/modules/orders/migrations/20260901T000000_orders_init.ts',
    'export class Migration20260901T000000OrdersInit extends Migration {}\n',
  );
  write('docs/docs/intro.md', '# Intro\n\nEnglish prose.\n');
  lists(['backend/src/modules/orders/order-service.ts']);
  // The fixture is a checkout, so it carries the marker a checkout carries.
  // Without it the nested-checkout rule would be tested only in the direction
  // that prunes: a rule that pruned any directory holding a `.git` — the
  // repository's own root included — would find no index at all here and every
  // case above would go from its own verdict to exit 2. With it, the outer
  // root's marker is in the fixture and the rule has to step over it.
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/master\n', 'utf8');

  const nestCheckout = (path: string, kind: NestedCheckoutKind = 'worktree'): string => {
    const nestedRoot = `${path}/backend/src/modules`;
    write(`${path}/backend/package.json`, '{ "name": "backend" }\n');
    write(`${nestedRoot}/_lifecycle/manifest-index.generated.ts`, manifestIndexSource(['orders']));
    write(`${nestedRoot}/orders/manifest.ts`, "export const manifest = { id: 'orders' };\n");
    write(`${nestedRoot}/orders/order-service.ts`, '// English comment.\nexport const a = 1;\n');
    if (kind === 'worktree') {
      write(`${path}/.git`, `gitdir: ${join(root, '.git', 'worktrees', 'nested')}\n`);
    } else {
      mkdirSync(join(root, path, '.git'), { recursive: true });
      writeFileSync(join(root, path, '.git', 'HEAD'), 'ref: refs/heads/master\n', 'utf8');
    }
    return nestedRoot;
  };

  const installPdfmake = (bytes: number, layout: PdfmakeLayout = 'top-level'): void => {
    const dir =
      layout === 'hoisted'
        ? join(root, 'node_modules', '.pnpm', 'pdfmake@0.2.20', 'node_modules', 'pdfmake')
        : join(root, 'node_modules', 'pdfmake');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'build', 'pdfmake.js');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
    truncateSync(file, bytes);
  };

  return {
    root,
    write,
    lists,
    listsExactly,
    removeManifestIndex: () => rmSync(join(root, MANIFEST_INDEX), { force: true }),
    removeModuleTree: () => rmSync(join(root, 'backend/src/modules'), { recursive: true, force: true }),
    moveModuleTree: (name) => {
      renameSync(join(root, 'backend/src/modules'), join(root, 'backend/src', name));
      return `backend/src/${name}`;
    },
    nestCheckout,
    installPdfmake,
    withoutPerlIo: () => {
      const lib = join(root, 'perl5lib-without-perlio');
      mkdirSync(lib, { recursive: true });
      writeFileSync(
        join(lib, 'PerlIO.pm'),
        // The message `perl-base` itself produces, so a failure here reads the
        // way the CI log reads.
        'die "Can\'t locate PerlIO.pm in \\@INC (you may need to install the PerlIO module)";\n',
        'utf8',
      );
      return { PERL5LIB: lib };
    },
    breakPerl: () => {
      // Only the *prose scanner* dies. `lib/module-root.sh` reads the manifest
      // index with a `perl -ne` of its own and runs first, so a perl that
      // refused everything would exit 2 before the scan — the right code for
      // the wrong reason, which is not a proof of anything. The discriminator
      // is the scanner's own text rather than its flags, so it survives the
      // next person changing `-CA`.
      const real = spawnSync('sh', ['-c', 'command -v perl'], { encoding: 'utf8' }).stdout.trim();
      const shim = join(binDir, 'perl');
      writeFileSync(
        shim,
        `#!/bin/sh
case "$*" in
  *Non-English*)
    echo "fixture perl: refusing to run the prose scanner" >&2
    exit 2
    ;;
esac
exec ${real} "$@"
`,
        'utf8',
      );
      chmodSync(shim, 0o755);
    },
    run: (script, args = [], env = {}) => {
      const result = spawnSync('bash', [join(root, 'scripts', script), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
          FAKE_GIT_FILE_LIST: join(root, 'lists/sources.txt'),
          FAKE_GIT_DOCS_LIST: join(root, 'lists/docs.txt'),
          ...env,
        },
      });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
