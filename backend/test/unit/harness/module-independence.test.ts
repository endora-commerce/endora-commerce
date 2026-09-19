/**
 * The harness names no module package — feature 134 T012, over
 * `specs/109-backend-test-kit/` Phases 2 and 3.
 *
 * `backend/test/helpers/test-server.ts` is imported by most of the server-bound
 * test tree, and it names module packages three ways: by **specifier** (60
 * declarations into 39 packages, every one of them `import type`, so none of it
 * is visible at runtime), by **type reference** (12 members of
 * `BackendServerOptions` and 29 of `BackendServerHandle`) and by **table name**
 * (the wipe list). While any of the three is true, this repository does not
 * compile without every module's sources — which is the one compile-time hard
 * stop in front of the module extraction (`specs/134-paid-module-extraction/`
 * §2.4), and the reason this file is a ratchet rather than a one-off count.
 *
 * Each direction is held against a **draining ledger** in
 * `./harness-module-residue.ts`, two-way: a coupling that is not ledgered fails,
 * and a ledgered coupling that has gone fails too. The end state of all three
 * ledgers is the empty array.
 *
 * The refusals are proven rather than asserted about: `readHarnessIndependence`
 * throws where a softer instrument would report a clean harness for the reason
 * that it read nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  HarnessIndependenceError,
  modulePackagePopulation,
  moduleOwnedTables,
  readHarnessIndependence,
} from '../../helpers/harness-module-independence.js';
import {
  LEDGERED_MODULE_SPECIFIERS,
  LEDGERED_MODULE_TABLE_NAMES,
  LEDGERED_MODULE_TYPE_REFERENCES,
} from './harness-module-residue.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const reading = readHarnessIndependence(repoRoot);

const subjectsOf = (kind: string): string[] =>
  reading.residue.filter((entry) => entry.kind === kind).map((entry) => entry.subject).sort();

const temporaries: string[] = [];
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-independence-'));
  temporaries.push(root);
  return root;
}
afterAll(() => {
  for (const root of temporaries) rmSync(root, { recursive: true, force: true });
});

describe('what this instrument read', () => {
  it('discloses its population, so a clean reading can be told from an empty walk', () => {
    // The estate's grammar. Printed rather than only asserted, because the
    // numbers are the evidence a later reader needs to know the walk was not
    // silently narrowed.
    // eslint-disable-next-line no-console
    console.log(
      `[harness-independence] read: harness=${reading.read.harness} ` +
        `lines=${reading.read.harnessLines} module-packages=${reading.read.modulePackages} ` +
        `owned-tables=${reading.read.ownedTables} imports=${reading.read.importDeclarations} ` +
        `string-literals=${reading.read.stringLiterals} ` +
        `host-bindings=${reading.hostBindings.length} ` +
        `options=${reading.interfaces.BackendServerOptions.total}` +
        `(${reading.interfaces.BackendServerOptions.moduleTyped.length} module-typed) ` +
        `handle=${reading.interfaces.BackendServerHandle.total}` +
        `(${reading.interfaces.BackendServerHandle.moduleTyped.length} module-typed)`,
    );
    expect(reading.read.modulePackages).toBeGreaterThan(0);
    expect(reading.read.ownedTables).toBeGreaterThan(0);
    expect(reading.read.importDeclarations).toBeGreaterThan(0);
    expect(reading.read.stringLiterals).toBeGreaterThan(0);
  });
});

describe('direction 1 — the harness names no module package by specifier', () => {
  it('has only the specifiers the ledger records, and every ledgered one is still there', () => {
    expect(subjectsOf('module-specifier')).toEqual([...LEDGERED_MODULE_SPECIFIERS].sort());
  });
});

describe('direction 2 — neither god-object has a member typed by a module package', () => {
  it('has only the members the ledger records, and every ledgered one is still there', () => {
    expect(subjectsOf('module-type-reference')).toEqual(
      [...LEDGERED_MODULE_TYPE_REFERENCES].sort(),
    );
  });

  it('keeps both interfaces, so the classification cannot lose its subject quietly', () => {
    // Feature 109 R2.3 — the names are kept for the test files that stay. An
    // interface that has been renamed away is a refusal, not a clean reading,
    // and `readHarnessIndependence` has already thrown by the time this runs.
    expect(reading.interfaces.BackendServerOptions.total).toBeGreaterThan(0);
    expect(reading.interfaces.BackendServerHandle.total).toBeGreaterThan(0);
  });
});

describe('direction 3 — the harness writes down no module-owned table name', () => {
  it('has only the tables the ledger records, and every ledgered one is still there', () => {
    expect(subjectsOf('module-table-name')).toEqual([...LEDGERED_MODULE_TABLE_NAMES].sort());
  });
});

describe('the refusals — every derivation exits rather than answering emptily', () => {
  it('refuses a tree with no module package rather than reporting an independent harness', () => {
    const root = temporaryRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'empty' }));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    expect(() => modulePackagePopulation(root)).toThrow(HarnessIndependenceError);
  });

  it('refuses when the generated manifest index is not there to reconcile against', () => {
    const root = temporaryRoot();
    // A tree whose workspace walk succeeds — the real one — but whose second
    // author is missing. Proved by pointing the walk at this repository's
    // packages through a workspace file and leaving `backend/src` empty.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'half' }));
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      `packages:\n  - '${repoRoot}/packages/modules/*'\n`,
    );
    expect(() => modulePackagePopulation(root)).toThrow(HarnessIndependenceError);
  });

  it('refuses a tree with no harness rather than reporting nothing found', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'backend/test/helpers'), { recursive: true });
    expect(() => readHarnessIndependence(root)).toThrow(HarnessIndependenceError);
  });

  it('claims module-owned tables, so direction 3 cannot pass by knowing of none', () => {
    // The other half of the refusal above: the real map is non-empty, measured
    // rather than assumed, so an empty `module-table-name` set means the harness
    // holds none and not that the graph does.
    expect(moduleOwnedTables(repoRoot).size).toBeGreaterThan(0);
  });
});
