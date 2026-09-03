/**
 * A module package on disk, for `endora check`'s red proofs.
 *
 * **Every proof enters at a fixture package tree** rather than at a
 * pre-classified record (issue #130, and `plan.md`'s Constitution Check says so
 * in as many words: *"a red proof that enters below the layout seam proves
 * nothing about the split"*). So this builder writes a real `package.json` with
 * a real `exports` map, a real `tsconfig.build.json` and real sources, and the
 * layout derivation, the walk, the analysis and the reduction all run over it.
 *
 * It emits its own `dist` by copying, not by compiling: what the artefact-reading
 * rules need from it is a file that exists, is newer than its source, and carries
 * the manifest's declarations as text. Running `tsc` here would buy nothing and
 * make every proof depend on a compile.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface FixtureFile {
  /** Package-relative, POSIX separators. */
  readonly path: string;
  readonly content: string;
}

export interface PackageFixtureOptions {
  readonly moduleId?: string;
  readonly name?: string;
  /** `exports` subpaths → targets, as written. Defaults to a root plus `./backend`. */
  readonly exports?: Readonly<Record<string, string>>;
  /** Extra `endora` block fields — `checkLedger`, for instance. */
  readonly endora?: Readonly<Record<string, unknown>>;
  /** Source files, package-relative. */
  readonly files?: readonly FixtureFile[];
  /** Emitted files, package-relative. Written after the sources, so they are newer. */
  readonly emitted?: readonly FixtureFile[];
  /** Omit `tsconfig.build.json` — a source-shipping package. */
  readonly noBuildConfig?: boolean;
}

export interface PackageFixture {
  readonly dir: string;
  readonly cleanup: () => void;
}

const DEFAULT_EXPORTS: Readonly<Record<string, string>> = {
  '.': './dist/manifest.js',
  './backend': './dist/backend/index.js',
};

function write(root: string, path: string, content: string): string {
  const full = join(root, ...path.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

export function createPackageFixture(options: PackageFixtureOptions = {}): PackageFixture {
  const dir = mkdtempSync(join(tmpdir(), 'endora-check-'));
  const moduleId = options.moduleId ?? 'acme_loyalty';
  const exportsMap = options.exports ?? DEFAULT_EXPORTS;

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: options.name ?? `@acme/mod-${moduleId}`,
        version: '1.2.3',
        private: true,
        type: 'module',
        endora: { type: 'module', id: moduleId, ...(options.endora ?? {}) },
        exports: Object.fromEntries(
          Object.entries(exportsMap).map(([subpath, target]) => [
            subpath,
            { types: target.replace(/\.js$/, '.d.ts'), default: target },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  if (options.noBuildConfig !== true) {
    writeFileSync(
      join(dir, 'tsconfig.build.json'),
      `${JSON.stringify({ compilerOptions: { rootDir: './src', outDir: './dist' } }, null, 2)}\n`,
    );
  }

  const sources = options.files ?? [
    { path: 'src/manifest.ts', content: "export const manifest = { id: 'acme_loyalty' };\n" },
    { path: 'src/backend/index.ts', content: 'export function registerModule(): void {}\n' },
  ];
  const written: string[] = [];
  for (const file of sources) written.push(write(dir, file.path, file.content));

  // The emitted half is written second, and its mtime is pushed forward, so an
  // artefact-reading rule sees a build that is current. A proof about staleness
  // moves the *source* forward instead.
  const emitted =
    options.emitted ??
    sources.map((file) => ({
      path: file.path.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '.js'),
      content: file.content,
    }));
  const future = Date.now() / 1000 + 60;
  for (const file of emitted) {
    const full = write(dir, file.path, file.content);
    utimesSync(full, future, future);
  }

  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Push a file's mtime past its artefact's — the staleness proof's whole input. */
export function touchIntoTheFuture(path: string): void {
  const future = Date.now() / 1000 + 3600;
  utimesSync(path, future, future);
}
