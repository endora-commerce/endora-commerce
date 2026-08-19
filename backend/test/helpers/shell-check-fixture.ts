import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
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
 * **git is faked.** The backend suite runs in `node:22.17-slim`, which ships no
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

/** Where a pdfmake install sits: pnpm's hoisted store, or a plain top-level one. */
export type PdfmakeLayout = 'hoisted' | 'top-level';

export interface ShellRunResult {
  readonly status: number | null;
  readonly output: string;
}

export interface ShellCheckFixture {
  readonly root: string;
  /** Writes a file into the fixture repository, creating its directories. */
  write: (path: string, content: string) => void;
  /** What the faked `git ls-files` answers for the source scan and the docs scan. */
  lists: (sources: readonly string[], docs?: readonly string[]) => void;
  /**
   * Deletes `backend/src/modules`, leaving the rest of the fixture standing —
   * the module tree having moved, with the residue behind it (issue #215).
   */
  removeModuleTree: () => void;
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
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const name of ['check-naming.sh', 'check-language.sh', 'check-pdfmake-footprint.sh']) {
    copyFileSync(join(SCRIPTS_DIR, name), join(root, 'scripts', name));
  }

  const write = (path: string, content: string): void => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  const lists = (sources: readonly string[], docs: readonly string[] = ['docs/docs/intro.md']): void => {
    write('lists/sources.txt', sources.map((s) => `${s}\n`).join(''));
    write('lists/docs.txt', docs.map((d) => `${d}\n`).join(''));
  };

  write('backend/src/modules/orders/order-service.ts', '// English comment.\nexport const a = 1;\n');
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
    removeModuleTree: () => rmSync(join(root, 'backend/src/modules'), { recursive: true, force: true }),
    installPdfmake,
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
