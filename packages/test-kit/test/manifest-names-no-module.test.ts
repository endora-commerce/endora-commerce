import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * R1.2 — the kit declares **no module package** in any dependency field.
 *
 * ## Why this is a test and not a review note
 *
 * The whole of the kit's value is that a module package's server-bound test can
 * reach it. A kit that depended on one module would be a kit no *other* module
 * could install without installing that one; a kit that depended on the
 * two dozen a composition needs would be
 * `research.md` §4's Option B — the workspace-internal kit, which is cheaper and
 * delivers no third-party capability at all. Both failures are one `pnpm add`
 * away and neither shows up in a type-check, in a lint or in any other check in
 * the estate: `check:module-boundary` reads **import specifiers**, and a
 * dependency a manifest declares and no source imports is invisible to it.
 *
 * ## Why it reads the manifest on disk
 *
 * Because that is the file `pnpm install` reads and the file a tarball would
 * carry. The acceptance criterion asks the same question of the *published*
 * tarball (§9, A1); this asks it of the workspace, which is where it is cheap
 * enough to ask on every run.
 *
 * ## The predicate, and the one thing it is not
 *
 * A module package is `@endora-commerce/mod-<id>`, which is the scope plus the
 * prefix `manifests:generate` renders — derived from the naming rule rather
 * than from a list of the modules that happen to exist today, so the sixty-eighth
 * module fails this on the day it is added. It is deliberately **not** a check
 * that the kit names no module *id*: that is `kit-names-a-module`'s job
 * (contract §7, T052) and its subject is a string literal in a source file, not
 * a manifest key.
 */

const MODULE_PACKAGE_PREFIX = '@endora-commerce/mod-';

const DEPENDENCY_FIELDS = [
  'dependencies',
  'peerDependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

interface Manifest {
  readonly name?: string;
  readonly private?: boolean;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

function kitManifest(): Manifest {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as Manifest;
}

describe('the test kit declares no module package', () => {
  it('names no module package in any dependency field', () => {
    const manifest = kitManifest();
    const offenders: string[] = [];
    let fieldsRead = 0;
    for (const field of DEPENDENCY_FIELDS) {
      const declared = manifest[field];
      if (declared === undefined) continue;
      expect(typeof declared).toBe('object');
      fieldsRead += 1;
      for (const name of Object.keys(declared as Record<string, string>)) {
        if (name.startsWith(MODULE_PACKAGE_PREFIX)) offenders.push(`${field}: ${name}`);
      }
    }
    // Exit-2's shape, as an assertion: a manifest with no dependency field at
    // all satisfies "names no module package" vacuously, and this test would
    // then be green over nothing.
    expect(fieldsRead).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('is private, and publishes the subpaths the contract declares', () => {
    const manifest = kitManifest();
    expect(manifest.name).toBe('@endora-commerce/test-kit');
    // Nothing here is published (D-160.5); the acceptance criterion uses
    // tarballs.
    expect(manifest.private).toBe(true);
    const subpaths = Object.keys(manifest.exports ?? {});
    // R1.1 — and **no root export**: a caller names the seam it wants, so that
    // `./server` and `./database` can be resolved by tests that need only one.
    expect(subpaths).not.toContain('.');
    expect(subpaths).toEqual(
      expect.arrayContaining(['./server', './database', './support', './package.json']),
    );
  });
});
