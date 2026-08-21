import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  coverageToken,
  parseReadSize,
  readSizeLine,
  readSizeRefusal,
  SELF_REPORTED,
} from '../../../scripts/lib/read-size.js';
import {
  modulePopulationCoverage,
  vacuousModulePopulation,
} from '../../../scripts/lib/module-population.js';
import { readSizeBounds, READ_SIZE_SLACK } from '../../helpers/check-read-sizes.js';

/**
 * The companion test for `scripts/lib/read-size.ts` and its shell twin
 * (issue #244).
 *
 * The shared reporter is now the one place twenty-seven checks say what they
 * read, so it inherits the property the checks it serves are held to: **a
 * fixture enters at the top of the analysis**, which here is the record a check
 * hands in, never a formatted string or a pre-computed verdict (issue #130).
 *
 * One proof per shape it claims to refuse — nothing read, an expectation of
 * zero, and a walk shorter than its expectation — because a single proof would
 * let two of the three go blind behind the third's red. The bash half is driven
 * through `bash -c`, over the same three shapes, because a second
 * implementation is a second chance to write the predicate backwards and the
 * two must refuse identically.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Runs a snippet against the sourced shell helper; returns status + output.
 *
 * `cwd` is the repository root because that is where both callers run it from:
 * `check-naming.sh` and `check-language.sh` `cd "$REPO_ROOT"` before sourcing
 * anything, and the module coverage below relates an index path to a listing
 * that `git ls-files` emits relative to that directory.
 */
function bash(snippet: string, cwd: string = REPO_ROOT): { status: number; output: string } {
  try {
    const output = execFileSync(
      'bash',
      ['-c', `source "${REPO_ROOT}scripts/lib/read-size.sh"\n${snippet}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd },
    );
    return { status: 0, output };
  } catch (error: unknown) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

describe('the read line', () => {
  it('prints files, the finer population and the derivations that corroborate them', () => {
    expect(
      readSizeLine({
        prefix: '[entry-scope]',
        files: 1459,
        sites: 47,
        coverage: [
          { source: 'manifest-index', expected: 65, covered: 65 },
          { source: 'package-scripts', expected: 18, covered: 18 },
        ],
      }),
    ).toBe(
      '[entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18',
    );
  });

  it('says `self-reported` rather than omitting the token', () => {
    // The distinction this file exists for, one level down: an omitted token
    // and "no independent derivation" would read the same, and only one of
    // them is a statement somebody made.
    expect(coverageToken([])).toBe(SELF_REPORTED);
    expect(readSizeLine({ prefix: '[nul-bytes]', files: 8288 })).toBe(
      '[nul-bytes] read: files=8288 sources=self-reported',
    );
  });

  it('omits `sites` for a check whose unit is the file', () => {
    expect(readSizeLine({ prefix: '[container-imports]', files: 1373 })).not.toContain('sites=');
  });

  it('round-trips through the parser the ratchet uses', () => {
    const line = readSizeLine({
      prefix: '[port-shape]',
      files: 1427,
      sites: 505,
      coverage: [{ source: 'manifest-index', expected: 65, covered: 65 }],
    });
    expect(parseReadSize(`noise\n${line}\nmore noise`)).toEqual({
      prefix: 'port-shape',
      files: 1427,
      sites: 505,
      coverage: [{ source: 'manifest-index', expected: 65, covered: 65 }],
      selfReported: false,
    });
  });

  it('reports the absence of a read line rather than inventing one', () => {
    expect(parseReadSize('[port-shape] ports=109 violations=0')).toBeNull();
  });
});

describe('what the reporter refuses', () => {
  it('refuses a walk that opened nothing', () => {
    expect(readSizeRefusal({ prefix: '[x]', files: 0 })?.kind).toBe('read-nothing');
  });

  it('refuses a derivation that expects nothing', () => {
    // "The index registers no module" and "the index did not load" would
    // otherwise be the same answer, and the second turns the floor off while
    // looking like a normal run.
    expect(
      readSizeRefusal({
        prefix: '[x]',
        files: 1459,
        coverage: [{ source: 'manifest-index', expected: 0, covered: 0 }],
      })?.kind,
    ).toBe('no-expectation');
  });

  it('refuses a walk that came back short of its expectation', () => {
    // Issue #215's predicate, generalised: 1354 files is not an empty walk, and
    // an emptiness test is green on exactly this input.
    const refusal = readSizeRefusal({
      prefix: '[subscribe-seam]',
      files: 1354,
      coverage: [{ source: 'manifest-index', expected: 65, covered: 61 }],
    });
    expect(refusal?.kind).toBe('short-walk');
    expect(refusal?.message).toContain('61 of the 65');
  });

  it('accepts a walk that covered its expectation', () => {
    expect(
      readSizeRefusal({
        prefix: '[x]',
        files: 1459,
        coverage: [{ source: 'manifest-index', expected: 65, covered: 65 }],
      }),
    ).toBeNull();
  });
});

describe('the module-index coverage the module walks report', () => {
  // The numbers printed on the read line are the ones the floor already
  // enforced, from one derivation rather than two — a second count of the same
  // thing is a copy that goes stale, which is what D-100 was written about.
  const registered = ['blog', 'catalog', 'orders'];

  it('counts the modules the walk produced a file for', () => {
    expect(
      modulePopulationCoverage({
        registered,
        files: ['modules/blog/backend.ts', 'modules/catalog/services/x.ts'],
      }),
    ).toEqual({ source: 'manifest-index', expected: 3, covered: 2 });
  });

  it('takes exclusions out of the expectation, not out of the coverage', () => {
    expect(
      modulePopulationCoverage({
        registered,
        files: ['modules/blog/backend.ts', 'modules/catalog/services/x.ts'],
        excluded: ['orders'],
      }),
    ).toEqual({ source: 'manifest-index', expected: 2, covered: 2 });
  });

  it('agrees with the refusal it is derived beside', () => {
    const short = { registered, files: ['modules/blog/backend.ts'] };
    expect(vacuousModulePopulation(short)).not.toBeNull();
    const coverage = modulePopulationCoverage(short);
    expect(coverage.covered).toBeLessThan(coverage.expected);
  });
});

describe('the band the ratchet applies', () => {
  it('gives a large population a percentage', () => {
    expect(readSizeBounds(1459)).toEqual({ min: 1313, max: 2189 });
  });

  it('gives a small population absolute slack, so it does not round to zero', () => {
    // Six generated artefacts cannot move by 10% of themselves; a percentage
    // band would fail on the seventh arriving and pass on four of them going.
    expect(readSizeBounds(6)).toEqual({ min: 6 - READ_SIZE_SLACK, max: 9 });
  });

  it('accepts a population that stood still', () => {
    const bounds = readSizeBounds(287);
    expect(287).toBeGreaterThanOrEqual(bounds.min);
    expect(287).toBeLessThanOrEqual(bounds.max);
  });
});

describe('the shell half refuses the same three shapes', () => {
  it('prints the same grammar as the TypeScript half', () => {
    const { status, output } = bash("read_size_report '[naming]' 5216 - manifest-index:65/65");
    expect(status).toBe(0);
    expect(output.trim()).toBe('[naming] read: files=5216 sources=manifest-index:65/65');
    // The ratchet parses one shape for both languages, so the proof is that the
    // TypeScript parser reads the shell output.
    expect(parseReadSize(output)).toEqual({
      prefix: 'naming',
      files: 5216,
      sites: null,
      coverage: [{ source: 'manifest-index', expected: 65, covered: 65 }],
      selfReported: false,
    });
  });

  it('exits 2 on a walk that opened nothing', () => {
    const { status, output } = bash("read_size_report '[naming]' 0 - self-reported");
    expect(status).toBe(2);
    expect(output).toContain('opened no file at all');
  });

  it('exits 2 on a derivation that expects nothing', () => {
    const { status, output } = bash("read_size_report '[naming]' 12 - manifest-index:0/0");
    expect(status).toBe(2);
    expect(output).toContain('expects nothing');
  });

  it('exits 2 on a walk that came back short', () => {
    const { status, output } = bash("read_size_report '[naming]' 105 - manifest-index:3/65");
    expect(status).toBe(2);
    expect(output).toContain('covered 3 of the 65');
  });

  it('derives the expectation from the manifest index rather than a number', () => {
    // Enters at the top: a file list on stdin and the real index, which is what
    // a run hands it. A fixture that passed `covered/expected` straight in would
    // prove the formatting and leave the derivation — the part #215 is about —
    // unexercised.
    const index = `${REPO_ROOT}backend/src/modules/_lifecycle/manifest-index.generated.ts`;
    const { output } = bash(
      `printf 'backend/src/modules/blog/backend.ts\\nbackend/src/kernel/x.ts\\n' | ` +
        `read_size_module_coverage '${index}'`,
    );
    const [covered, expected] = output.trim().split('/').map(Number);
    expect(covered).toBe(1);
    expect(expected).toBeGreaterThan(60);
  });

  it('reads the module root off the index rather than a path written into it', () => {
    // Feature 080, T012. The coverage used to `grep` for `backend/src/modules/`
    // and would have answered `0/1` for the tree below — a refusal, on a
    // repository whose only fault was that its modules had moved. The root is
    // the index's own grandparent, so the expectation moves with the tree.
    const moved = mkdtempSync(join(tmpdir(), 'read-size-root-'));
    try {
      const index = join(moved, 'backend/src/domain_modules/_lifecycle/manifest-index.generated.ts');
      mkdirSync(dirname(index), { recursive: true });
      writeFileSync(
        index,
        "import { manifest as manifest0 } from '../orders/manifest.js';\n",
        'utf8',
      );

      const { output } = bash(
        `printf 'backend/src/domain_modules/orders/x.ts\\nbackend/src/kernel/x.ts\\n' | ` +
          `read_size_module_coverage '${index}'`,
        moved,
      );

      expect(output.trim()).toBe('1/1');
    } finally {
      rmSync(moved, { recursive: true, force: true });
    }
  });

  it('fails rather than answering when the index is not there', () => {
    const { status } = bash(
      "printf 'x\\n' | read_size_module_coverage /nowhere/manifest-index.generated.ts",
    );
    expect(status).not.toBe(0);
  });
});
