import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BINARY_EXTENSIONS,
  BINARY_FILENAMES,
  checkNulBytes,
  extensionOf,
  findNulBytes,
  GIT_BINARY_WINDOW,
  isScannablePath,
  NUL_BYTES_ALLOWED,
  SKIPPED_DIRECTORIES,
  SKIPPED_PATH_PREFIXES,
  type ScannedFile,
} from '../../../scripts/check-nul-bytes.js';
import {
  createNulBytesFixture,
  type NulBytesFixture,
} from '../../helpers/nul-bytes-check-fixture.js';

/**
 * Companion test for `check-nul-bytes` (issue #190).
 *
 * The check exists because the artefact that would have revealed its defect is
 * the diff itself: a NUL makes git call the file binary, and a binary file has
 * no reviewable diff. So the shapes asserted here are the ones a narrowing of
 * the check would quietly stop seeing — a NUL past git's own 8000-byte window,
 * a file type nobody thought to list, a file with no extension at all — plus
 * the two exclusions, which are proven as *discriminations* so that widening
 * them by accident shows up as a red test rather than as a smaller number.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A file whose NUL sits past the window git reads before deciding binary. */
function nulPastGitWindow(path: string): ScannedFile {
  const padding = '// padding\n'.repeat(Math.ceil((GIT_BINARY_WINDOW + 64) / 11));
  return { path, bytes: bytes(`${padding}const key = \`a\0b\`;\n`) };
}

/**
 * The synthetic repository lives in `test/helpers/nul-bytes-check-fixture.ts`,
 * because the inventory's red proof of the issue #248 exclusions needs the same
 * on-disk tree: a `ScannedFile` record enters *below* the walk, and a directory
 * exclusion is a decision the walk takes.
 */
let fixture: NulBytesFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

function fixtureRepository(): NulBytesFixture {
  fixture = createNulBytesFixture();
  return fixture;
}

describe('check-nul-bytes — what it refuses', () => {
  it('reports a raw NUL in a TypeScript source', () => {
    const found = findNulBytes([
      { path: 'backend/src/http/interceptors/registry.ts', bytes: bytes('const k = `a\0b`;\n') },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('backend/src/http/interceptors/registry.ts');
    expect(found[0]?.count).toBe(1);
  });

  it('locates the byte by line and column, so the report survives the unreviewable diff', () => {
    const found = findNulBytes([{ path: 'a/b.ts', bytes: bytes('one\ntwo\nthree \0 four\n') }]);
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.column).toBe(7);
    expect(found[0]?.byteOffset).toBe(14);
  });

  it('counts every NUL in the file, not just the first', () => {
    const found = findNulBytes([{ path: 'a/b.ts', bytes: bytes('`${a}\0${b}\0${c}`') }]);
    expect(found[0]?.count).toBe(2);
  });

  it('reports a NUL past the 8000-byte window git itself reads', () => {
    // `admin-actions-service.ts` carried its NUL at byte 8032, so git kept
    // diffing it as text. A rule that copied git's heuristic reads this clean.
    const found = findNulBytes([nulPastGitWindow('backend/src/x/service.ts')]);
    expect(found).toHaveLength(1);
    expect(found[0]?.byteOffset).toBeGreaterThan(GIT_BINARY_WINDOW);
    expect(found[0]?.beyondGitBinaryWindow).toBe(true);
  });

  it('reports a raw NUL in a test fixture', () => {
    // The issue #190 file the "it is a deliberate hostile fixture" argument
    // covers: a fixture builds a JavaScript string, and the escape builds the
    // same one, so a test file is in the population like any other source.
    const found = findNulBytes([
      {
        path: 'backend/test/unit/product_feeds/xml-feed-serializer.test.ts',
        bytes: bytes('const hostile = `A\0B`;\n'),
      },
    ]);
    expect(found).toHaveLength(1);
  });

  it('reports a raw NUL in a file type the deny-list never heard of', () => {
    // The reason the exclusion is a deny-list: an allow-list of known-text
    // extensions would have to be extended before it could see these.
    const found = findNulBytes([
      { path: 'backend/src/db/seed.sql', bytes: bytes("insert into t values ('\0');") },
      { path: 'tooling/config.toml', bytes: bytes('key = "\0"\n') },
    ]);
    expect(found.map((f) => f.path)).toEqual(['backend/src/db/seed.sql', 'tooling/config.toml']);
  });

  it('reports a raw NUL in a file with no extension at all', () => {
    const found = findNulBytes([{ path: 'scripts/release-notes', bytes: bytes('a\0b') }]);
    expect(found).toHaveLength(1);
  });

  it('reports a raw NUL in a dotfile, which is not an extension', () => {
    const found = findNulBytes([{ path: '.gitattributes', bytes: bytes('*.ts text\0') }]);
    expect(found).toHaveLength(1);
  });
});

describe('check-nul-bytes — what it does not refuse', () => {
  it('leaves a binary extension alone while still reporting its neighbour', () => {
    // Written as a discrimination: "no finding" cannot go red on its own, so
    // the assertion is that exactly the source file comes back. Widening the
    // extension list to swallow `.ts` turns this red rather than quiet.
    const found = findNulBytes([
      { path: 'admin/public/icons/admin-192.png', bytes: bytes('\x89PNG\0\0\0') },
      { path: 'admin/src/main.ts', bytes: bytes('const k = `a\0b`;') },
    ]);
    expect(found.map((f) => f.path)).toEqual(['admin/src/main.ts']);
  });

  it('leaves a binary file named without an extension alone', () => {
    const found = findNulBytes([
      { path: 'specs/ui/project/.thumbnail', bytes: bytes('RIFF\0\0WEBP') },
      { path: 'specs/ui/project/app.jsx', bytes: bytes('const k = `a\0b`;') },
    ]);
    expect(found.map((f) => f.path)).toEqual(['specs/ui/project/app.jsx']);
  });

  it('leaves a pruned directory alone while still reporting its neighbour', () => {
    const found = findNulBytes([
      { path: 'node_modules/some-dep/index.js', bytes: bytes('x\0y') },
      { path: 'backend/dist/index.js', bytes: bytes('x\0y') },
      { path: 'backend/src/index.ts', bytes: bytes('x\0y') },
    ]);
    expect(found.map((f) => f.path)).toEqual(['backend/src/index.ts']);
  });

  it('leaves a clean source alone', () => {
    expect(findNulBytes([{ path: 'a/b.ts', bytes: bytes('const k = `a\\0b`;\n') }])).toEqual([]);
  });

  it('treats a directory named like a pruned one only as a directory', () => {
    // `isScannablePath` reads path *segments*, so a file called `dist` or a
    // module called `build.ts` stays in the population.
    expect(isScannablePath('backend/scripts/build.ts')).toBe(true);
    expect(isScannablePath('backend/src/dist')).toBe(true);
    expect(isScannablePath('backend/dist/index.js')).toBe(false);
  });
});

describe('check-nul-bytes — the ledger', () => {
  const file: ScannedFile = { path: 'backend/src/a.ts', bytes: bytes('a\0b') };

  it('passes a ledgered file and counts it as ledgered rather than clean', () => {
    const result = checkNulBytes([file], { 'backend/src/a.ts': 'Reason.' });
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('fails an entry that no longer describes a NUL-carrying file', () => {
    const result = checkNulBytes([{ path: 'backend/src/a.ts', bytes: bytes('ab') }], {
      'backend/src/a.ts': 'Reason.',
    });
    expect(result.stale).toEqual(['backend/src/a.ts']);
  });

  it('ships empty, because every issue #190 file was repaired rather than ledgered', () => {
    expect(NUL_BYTES_ALLOWED).toEqual({});
  });

  it('gives every declared exclusion a reason', () => {
    for (const table of [
      SKIPPED_DIRECTORIES,
      SKIPPED_PATH_PREFIXES,
      BINARY_EXTENSIONS,
      BINARY_FILENAMES,
    ]) {
      for (const [key, reason] of Object.entries(table)) {
        expect(reason.length, `${key} has no reason`).toBeGreaterThan(10);
      }
    }
  });
});

describe('check-nul-bytes — extension parsing', () => {
  it('reads the extension case-insensitively and only from the basename', () => {
    expect(extensionOf('a/b/c.PNG')).toBe('.png');
    expect(extensionOf('a.b/c')).toBe('');
    expect(extensionOf('a/.gitignore')).toBe('');
    expect(extensionOf('a/b.test.ts')).toBe('.ts');
  });
});

describe('check-nul-bytes — the exit codes', () => {
  it('exits 2 on a tree with nothing to read, rather than reporting a vacuous pass', () => {
    // Issue #113: a green must never be able to mean "not looking". Nothing is
    // written into the fixture, so the walk really does read zero files — and
    // the check answers 2, which is neither "clean" nor "violations found".
    const result = fixtureRepository().run();
    expect(result.status).toBe(2);
    expect(result.output).toContain('vacuous');
  });

  it('exits 1 and names the file when a source carries a raw NUL', () => {
    const repo = fixtureRepository();
    repo.write('backend/src/modules/orders/graph.ts', bytes('const key = `a\0b`;\n'));
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('backend/src/modules/orders/graph.ts');
    expect(result.output).toContain('violations=1');
  });

  it('exits 0 on a tree whose sources spell the byte as an escape', () => {
    const repo = fixtureRepository();
    repo.write('backend/src/modules/orders/graph.ts', bytes('const key = `a\\0b`;\n'));
    repo.write('admin/public/icons/admin.png', bytes('\x89PNG\0\0\0'));
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('violations=0');
  });

  // Issue #248. These enter as a **tree on disk**, not as `ScannedFile`
  // records, because that is the only input above both consumers of an
  // exclusion: the walk, which prunes the directory, and `isScannablePath`,
  // which states the rule. A record-based proof is handed a path the walk
  // already chose to emit, so it cannot see a pruning that stopped happening.
  //
  // Each is a discrimination — a NUL in the generated tree and a NUL in a
  // source file beside it — because "the generated file was not reported" is
  // green on a check that reported nothing whatsoever.
  it.each([
    ['docs/.docusaurus/registry.js', 'a name-anchored generated tree'],
    ['backend/var/assets/ab/abcdef.xml', 'a path-anchored data tree'],
  ])('skips %s (%s) while still reporting the source beside it', (generated) => {
    const repo = fixtureRepository();
    repo.write(generated, bytes('const k = `a\0b`;\n'));
    repo.write('backend/src/modules/orders/graph.ts', bytes('const k = `a\0b`;\n'));
    const result = repo.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('violations=1');
    expect(result.output).toContain('backend/src/modules/orders/graph.ts');
    expect(result.output).not.toContain(generated);
  });

  it('counts the pruned tree out of the read size, not merely out of the findings', () => {
    // The saving is the point of issue #248 and it is a *read* count, which no
    // finding-level assertion can reach: a check that walked three thousand
    // generated files and then discarded them would pass every test above.
    const repo = fixtureRepository();
    repo.write('backend/src/modules/orders/graph.ts', bytes('const key = `a\\0b`;\n'));
    for (let index = 0; index < 20; index += 1) {
      repo.write(`docs/.docusaurus/route-${index}.json`, bytes('{"a":1}\n'));
    }
    const result = repo.run();
    expect(result.status).toBe(0);
    expect(result.output).toContain('[nul-bytes] read: files=1 ');
  });
});

describe('check-nul-bytes — the tree it guards', () => {
  const repaired = [
    'backend/src/http/interceptors/registry.ts',
    'backend/src/modules/admin_actions/services/admin-actions-service.ts',
    'backend/src/modules/orders/domain/order-status-graph.ts',
    'backend/src/modules/product_feeds/services/taxonomy-revision-identity.ts',
    'backend/test/unit/product_feeds/xml-feed-serializer.test.ts',
  ];

  it.each(repaired)('%s spells its NUL separator as an escape', (path) => {
    const content = readFileSync(join(REPO_ROOT, path));
    expect(content.indexOf(0), `${path} still carries a raw NUL`).toBe(-1);
    // The separator itself must survive the repair: the escape is what changed,
    // never the byte, so the compiled source still joins on a NUL.
    expect(content.toString('utf8')).toMatch(/\\(0|x00)/);
  });
});
