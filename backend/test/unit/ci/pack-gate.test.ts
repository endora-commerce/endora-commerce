/**
 * Companion test for the pack gate's judgement
 * (`backend/scripts/lib/pack-assert.ts`).
 *
 * The gate itself packs 79 packages and runs a binary; that is a CI job and not
 * a test, which is why the judgement is a module of its own. Every fixture here
 * enters at the **top** of that judgement — a tarball's entry list, the
 * `package.json` inside it, and the run's output — never a pre-classified
 * verdict, so the predicates under proof are the ones a real run evaluates
 * (issue #130).
 *
 * One red proof per shape the gate claims to refuse, each asserting the
 * finding's **kind**, so five of six cannot go blind behind the sixth's red;
 * plus the discriminations, because a judgement that reported every package
 * would be satisfied by half of these on its own.
 */
import { describe, expect, it } from 'vitest';

import {
  binTargets,
  exportTargets,
  judgePackedPackage,
  judgePackedPackages,
  workspaceRanges,
  type PackedPackage,
} from '../../../scripts/lib/pack-assert.js';

/** A package that packs correctly. Every proof below is one mutation of it. */
const HEALTHY: PackedPackage = {
  name: '@fx/alpha',
  dir: 'packages/alpha',
  entries: [
    { path: 'package.json', size: 400 },
    { path: 'dist/index.js', size: 1200 },
    { path: 'dist/index.d.ts', size: 300 },
  ],
  manifestText: JSON.stringify({
    name: '@fx/alpha',
    version: '0.7.0',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    },
    peerDependencies: { zod: '^4' },
  }),
  binRun: null,
};

/** {@link HEALTHY} with `mutate` applied to the packed manifest. */
function packedAs(mutate: (manifest: Record<string, unknown>) => void): PackedPackage {
  const manifest = JSON.parse(HEALTHY.manifestText!) as Record<string, unknown>;
  mutate(manifest);
  return { ...HEALTHY, manifestText: JSON.stringify(manifest) };
}

const kinds = (packed: PackedPackage): readonly string[] =>
  judgePackedPackage(packed).findings.map((finding) => finding.kind);

describe('pack-gate — the discrimination', () => {
  /**
   * The one that has to hold, or every proof below is satisfied by a judgement
   * that reports everything. A tarball with compiled code, no `workspace:`
   * range and every `exports` target present is not a finding.
   */
  it('reports nothing for a tarball a consumer can use', () => {
    expect(judgePackedPackage(HEALTHY).findings).toEqual([]);
  });

  /** And it counted what it looked at, which is what the gate's `sites=` sums. */
  it('counts the decisions it took inside one tarball', () => {
    // the manifest, two export targets (`./package.json` is the third), one
    // dependency range, no bin.
    expect(judgePackedPackage(HEALTHY).sites).toBe(5);
  });
});

describe('pack-gate — a tarball with nothing in it', () => {
  /**
   * The failure `build:packages` not having run produces, and the one a
   * source-tree check cannot see: the type-check is what would have written the
   * files it is being asked about.
   */
  it('reports a tarball carrying no compiled code', () => {
    expect(
      kinds({
        ...HEALTHY,
        entries: [{ path: 'package.json', size: 400 }],
        manifestText: JSON.stringify({ name: '@fx/alpha', version: '0.7.0' }),
      }),
    ).toContain('no-compiled-code');
  });

  /**
   * A file that is **there** and is nothing. Its own finding rather than a
   * clause inside the one above, because it passes every presence test — the
   * export target resolves, the entry list is long, and the module a consumer
   * imports is empty.
   */
  it('reports an emitted file at zero bytes', () => {
    expect(
      kinds({
        ...HEALTHY,
        entries: [
          { path: 'package.json', size: 400 },
          { path: 'dist/index.js', size: 0 },
          { path: 'dist/index.d.ts', size: 300 },
        ],
      }),
    ).toContain('empty-artefact');
  });

  /**
   * The discrimination for it: a zero-byte file that is not compiled output is
   * not this gate's business. An empty `i18n/pl.json` is
   * `check:bundle-pairing`'s `empty-bundle`, and answering it here as well
   * would be two derivations of one rule waiting to disagree.
   */
  it('does not report a zero-byte file that is not compiled output', () => {
    expect(
      kinds({
        ...HEALTHY,
        entries: [...HEALTHY.entries, { path: 'i18n/pl.json', size: 0 }],
      }),
    ).not.toContain('empty-artefact');
  });
});

describe('pack-gate — a range that resolves nowhere else', () => {
  /**
   * `pnpm pack` rewrites `workspace:*` to the sibling's exact version, so a
   * survivor is one pnpm could not resolve. It installs cleanly here — the
   * workspace *is* the resolution — and the consumer's installer refuses it.
   */
  it('reports a surviving `workspace:` range', () => {
    expect(
      kinds(
        packedAs((manifest) => {
          manifest['dependencies'] = { '@fx/beta': 'workspace:*' };
        }),
      ),
    ).toContain('workspace-range-survives');
  });

  /**
   * `peerDependencies` specifically, and it is the case that matters: a module
   * package declares its siblings as peers, so a reader of `dependencies` alone
   * would clear 467 of this workspace's ranges by never looking at them.
   */
  it('reads `peerDependencies`, where a module package declares its siblings', () => {
    expect(
      kinds(
        packedAs((manifest) => {
          manifest['peerDependencies'] = { '@fx/beta': 'workspace:^' };
        }),
      ),
    ).toContain('workspace-range-survives');
  });

  it('names the field and the package, not merely that something is wrong', () => {
    const found = judgePackedPackage(
      packedAs((manifest) => {
        manifest['peerDependencies'] = { '@fx/beta': 'workspace:^' };
      }),
    ).findings;
    expect(found[0]?.message).toContain('peerDependencies.@fx/beta: workspace:^');
  });

  /** And a real range is not one. */
  it('does not report a resolved version range', () => {
    expect(
      kinds(
        packedAs((manifest) => {
          manifest['dependencies'] = { '@fx/beta': '0.7.0' };
        }),
      ),
    ).not.toContain('workspace-range-survives');
  });
});

describe('pack-gate — an `exports` subpath the tarball does not carry', () => {
  /**
   * `ERR_PACKAGE_PATH_NOT_EXPORTED` at the first consumer, and silence here: in
   * this workspace the specifier resolves against the *source* directory, where
   * the file does exist.
   */
  it('reports a subpath whose target is not packed', () => {
    expect(
      kinds(
        packedAs((manifest) => {
          (manifest['exports'] as Record<string, unknown>)['./migrations'] =
            './dist/migrations/index.js';
        }),
      ),
    ).toContain('unresolvable-export');
  });

  /**
   * The map is walked whole rather than at its top level, because a subpath's
   * value nests: `types` and `default` name two files, and judging one of them
   * clears a package whose declarations the `files` list drops — the half a
   * consumer loses in their editor rather than at runtime, and therefore the
   * half nobody notices for a week.
   */
  it('resolves a condition inside a subpath, not only the subpath', () => {
    expect(exportTargets({ '.': { types: './dist/index.d.ts', default: './dist/index.js' } })).toEqual(
      ['dist/index.d.ts', 'dist/index.js'],
    );
    expect(
      kinds({
        ...HEALTHY,
        entries: [
          { path: 'package.json', size: 400 },
          { path: 'dist/index.js', size: 1200 },
        ],
      }),
    ).toContain('unresolvable-export');
  });

  /**
   * A **wildcard** subpath is skipped, and the bound is declared rather than
   * discovered: `"./i18n/*"` names a directory shape, so there is no one file
   * whose absence is a finding, and reporting the literal `dist/i18n/*` as
   * missing would be a finding about the resolver.
   */
  it('does not report a wildcard subpath as missing', () => {
    expect(exportTargets({ './i18n/*': './i18n/*' })).toEqual([]);
    expect(
      kinds(
        packedAs((manifest) => {
          (manifest['exports'] as Record<string, unknown>)['./i18n/*'] = './i18n/*';
        }),
      ),
    ).not.toContain('unresolvable-export');
  });
});

describe('pack-gate — a binary that runs and says nothing', () => {
  /**
   * The defect that has actually shipped, which is why it is a finding of its
   * own and not a clause of the subpath rule: the target was **present**. An
   * entry guard comparing `import.meta.url` to `process.argv[1]` was false for
   * every installed consumer — npm links the `bin`, and the link is what
   * `argv[1]` names — so the module was imported, ran no command, printed 0
   * bytes and exited 0. Exit 0 with no output is the shape a passing run and a
   * dead binary share, so the assertion has to be on the *output*.
   */
  it('reports a packed `bin` that printed nothing', () => {
    expect(
      kinds({
        ...packedAs((manifest) => {
          manifest['bin'] = { fx: './dist/bin/fx.js' };
        }),
        entries: [...HEALTHY.entries, { path: 'dist/bin/fx.js', size: 900 }],
        binRun: { command: 'fx', target: 'dist/bin/fx.js', exitCode: 0, output: '' },
      }),
    ).toContain('silent-bin');
  });

  /** And a binary that printed its usage is not one, whatever it exited with. */
  it('does not report a `bin` that printed its usage', () => {
    expect(
      kinds({
        ...packedAs((manifest) => {
          manifest['bin'] = { fx: './dist/bin/fx.js' };
        }),
        entries: [...HEALTHY.entries, { path: 'dist/bin/fx.js', size: 900 }],
        binRun: { command: 'fx', target: 'dist/bin/fx.js', exitCode: 1, output: 'usage: fx …\n' },
      }),
    ).not.toContain('silent-bin');
  });

  /**
   * A `bin` the tarball does not carry is reported before it can be run, and as
   * an unresolvable target: npm links the command and the link points at
   * nothing, which is a `files` defect rather than a program defect.
   */
  it('reports a `bin` whose target is not packed', () => {
    expect(
      kinds(
        packedAs((manifest) => {
          manifest['bin'] = { fx: './dist/bin/fx.js' };
        }),
      ),
    ).toContain('unresolvable-export');
  });

  /**
   * Both spellings npm accepts, because a reader of the object form alone
   * classifies a correct executable as declaring none — and this gate's whole
   * subject is a package it would then never run.
   */
  it('reads `bin` written as a bare string, taking the package name', () => {
    expect(binTargets({ name: '@fx/alpha', bin: './dist/bin/fx.js' })).toEqual([
      { command: 'alpha', target: 'dist/bin/fx.js' },
    ]);
    expect(binTargets({ name: 'fx', bin: { fx: './dist/bin/fx.js' } })).toEqual([
      { command: 'fx', target: 'dist/bin/fx.js' },
    ]);
  });
});

describe('pack-gate — a tarball with no manifest', () => {
  /**
   * Reported once and judged no further, because every other rule reads that
   * file: four findings about one absence is four readers of one defect, and
   * the reader would have to work out which of them was the cause.
   */
  it('reports a tarball with no packed `package.json`', () => {
    const found = judgePackedPackage({ ...HEALTHY, manifestText: null }).findings;
    expect(found.map((finding) => finding.kind)).toEqual(['missing-packed-manifest']);
  });

  it('reports a packed `package.json` that does not parse', () => {
    const found = judgePackedPackage({ ...HEALTHY, manifestText: '{ not json' }).findings;
    expect(found.map((finding) => finding.kind)).toEqual(['missing-packed-manifest']);
  });
});

describe('pack-gate — over the whole set', () => {
  /**
   * Every package, not the first bad one. A gate that stopped would send its
   * reader to fix one package and run again, which for 79 packages is 79 runs
   * of a job that packs all of them.
   */
  it('judges every package handed in', () => {
    const result = judgePackedPackages([
      HEALTHY,
      { ...HEALTHY, name: '@fx/beta', manifestText: null },
      {
        ...HEALTHY,
        name: '@fx/gamma',
        manifestText: JSON.stringify({
          name: '@fx/gamma',
          version: '0.7.0',
          dependencies: { '@fx/alpha': 'workspace:*' },
        }),
      },
    ]);
    expect(result.findings.map((finding) => finding.subject)).toEqual(['@fx/beta', '@fx/gamma']);
    expect(result.sites).toBeGreaterThan(0);
  });

  /** The range reader itself, over all four fields `pnpm pack` rewrites. */
  it('reads a workspace range in every dependency field', () => {
    expect(
      workspaceRanges({
        dependencies: { a: 'workspace:*' },
        devDependencies: { b: 'workspace:^' },
        peerDependencies: { c: 'workspace:~' },
        optionalDependencies: { d: 'workspace:*' },
      }).map((entry) => entry.where),
    ).toEqual([
      'dependencies.a',
      'devDependencies.b',
      'peerDependencies.c',
      'optionalDependencies.d',
    ]);
  });
});
