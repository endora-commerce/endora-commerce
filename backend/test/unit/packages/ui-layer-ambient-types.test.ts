import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { UI_LAYER_DIRECTORIES } from '../../../scripts/lib/ui-layer.js';

/**
 * No file in a module package's UI layer widens that layer's program with an
 * ambient type package (issue #566).
 *
 * `tsconfig.ui.json` sets `types: []` so a screen that reaches for `process`
 * does not compile — the layer is a browser bundle. A
 * `/// <reference types="node" />` written at the top of **one** file applies to
 * the **whole** program, so eleven admin tests that read files or set `TZ`
 * (#559) switched that refusal off for every screen in five packages, and
 * nothing said so: the type-check stayed green because it had stopped looking.
 *
 * A UI test that needs Node is type-checked in a program of its own instead —
 * `tsconfig.ui.test.json`, which the generated `typecheck` script builds
 * (`backend/scripts/lib/module-package-manifest.ts`). This is the instrument
 * that keeps the directive from coming back: the error a test author meets
 * without it is `Cannot find name 'process'`, and the directive is the
 * one-line answer that makes it go away.
 *
 * It reads the directive as **syntax** — `ts.preProcessFile`'s
 * `typeReferenceDirectives`, the list the compiler itself reads — so a comment
 * quoting it, like the one above, is out of the population by construction.
 */
function ambientTypeReferencesOf(text: string): string[] {
  return ts.preProcessFile(text, true, false).typeReferenceDirectives.map((ref) => ref.fileName);
}

function sourcesUnder(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourcesUnder(full, out);
    else if (/\.(?:ts|tsx|mts|cts)$/.test(name)) out.push(full);
  }
  return out;
}

describe('ambientTypeReferencesOf reads the directive the compiler reads', () => {
  it('finds a Node type reference at the top of a file', () => {
    expect(ambientTypeReferencesOf('/// <reference types="node" />\nexport {};\n')).toEqual(['node']);
  });

  it('is not fooled by prose quoting it', () => {
    expect(
      ambientTypeReferencesOf(
        '// Never write `/// <reference types="node" />` here.\n' +
          'const s = \'/// <reference types="node" />\';\nexport { s };\n',
      ),
    ).toEqual([]);
  });
});

describe('no module package UI-layer file widens its program with ambient types', () => {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (root === null) throw new Error('[ui-ambient-types] no repository root above the test tree');
  const packages = discoverModulePackages(root);
  const uiFiles = packages.flatMap((pkg) =>
    UI_LAYER_DIRECTORIES.flatMap((layer) => sourcesUnder(join(pkg.dir, 'src', layer))),
  );

  it('found UI-layer files at all, so the sweep is not vacuous', () => {
    expect(uiFiles.length).toBeGreaterThan(0);
  });

  it('holds none', () => {
    const offenders = uiFiles.flatMap((file) =>
      ambientTypeReferencesOf(readFileSync(file, 'utf8')).map(
        (ref) =>
          `${relative(root, file)}: /// <reference types="${ref}" /> applies to every file of ` +
          `the UI program, screens included — type-check the test in tsconfig.ui.test.json`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
