import { describe, expect, it } from 'vitest';

import {
  checkOffStateCoverage,
  harnessExportedFunctions,
  harnessExportsCoverage,
  harnessSitesIn,
  locallyDeclaredModuleIds,
  OFF_STATE_COVERAGE_EXEMPT,
  vacuousOffStateCoverage,
  type ModuleUnderCheck,
  type OffStateCoverageFindingKind,
} from '../../../scripts/check-off-state-coverage.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';

/**
 * `check-off-state-coverage`, shape by shape
 * (`specs/073-lifecycle-gating-completion/contracts/off-state-coverage-ratchet.md`).
 *
 * The inventory entry in `check-inventory.test.ts` carries one red proof per
 * finding and one per exit-2 condition; this file is where each shape's
 * **detail** is asserted — which module a finding names, which subject a
 * resolver shape produces, and the discriminations that separate two states
 * that look alike.
 *
 * Every fixture enters at the top of the analysis: **source text**, a module
 * list and a ledger. Nothing here hands the check a value it normally computes
 * (issue #130) — the resolver is the whole of this check's risk, and a fixture
 * of pre-resolved subjects would prove the set arithmetic and leave the
 * resolver unproven.
 */

/** Two modules with an operator axis, and one locked — the standing population. */
const MODULES: readonly ModuleUnderCheck[] = [
  { moduleId: 'blog', activationSettingCode: 'blog.enabled' },
  { moduleId: 'seo', activationSettingCode: 'seo.enabled' },
  { moduleId: 'orders', activationSettingCode: null },
];

/** A proof of `blog`, in the shape every off-state file in the tree writes. */
const BLOG_PROOF = {
  path: 'test/integration/blog/off-state.test.ts',
  text: [
    "import { expectModuleAbsent } from '../../helpers/off-state.js';",
    "it('is absent while off', async () => {",
    "  await expectModuleAbsent(h, 'blog', { routes: ['/api/v1/admin/blog/posts'] });",
    '});',
  ].join('\n'),
};

/** A proof of `seo`, so a fixture can cover the whole population when it wants to. */
const SEO_PROOF = {
  path: 'test/integration/seo/off-state.test.ts',
  text: "await expectModuleAbsent(h, 'seo', { routes: ['/api/v1/admin/seo/sitemap'] });",
};

const kinds = (
  findings: readonly { kind: OffStateCoverageFindingKind }[],
): OffStateCoverageFindingKind[] => [...new Set(findings.map((finding) => finding.kind))].sort();

describe('the predicate: the argument of an expectModuleAbsent call', () => {
  it('covers a module named by a string literal', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF, SEO_PROOF],
    });
    expect(result.findings).toEqual([]);
    expect([...result.covered].sort()).toEqual(['blog', 'seo']);
    // The locked module is outside the population, not covered-by-exception.
    expect(result.population).toEqual(['blog', 'seo']);
  });

  it('reports a module in the population that no call names', () => {
    const result = checkOffStateCoverage({ modules: MODULES, files: [BLOG_PROOF] });
    expect(kinds(result.findings)).toEqual(['uncovered-module']);
    expect(result.findings.map((finding) => finding.moduleId)).toEqual(['seo']);
  });

  it('does not accept a bare withModuleOff as coverage — that is the tiering', () => {
    // The distinction the whole contract turns on. `withModuleOff` is a state
    // seam a palette test, a consumer's fail-closed test and an exemption test
    // all use; only `expectModuleAbsent` asserts item 6's five things at once.
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        BLOG_PROOF,
        {
          path: 'test/integration/_admin_surfaces/palette.test.ts',
          text: "await withModuleOff('seo', 'deactivated', async () => {});",
        },
      ],
    });
    expect(kinds(result.findings)).toEqual(['uncovered-module']);
    expect(result.findings[0]?.moduleId).toBe('seo');
    // …and the site is still walked: it is what `sites` and the harness-export
    // floor are computed over.
    expect(result.sites).toHaveLength(2);
  });

  it('credits a proof that sits in another module’s directory', () => {
    // `payments` is named by six files and none of them is under `payments/`.
    // A path predicate is the defect this check exists to replace.
    const result = checkOffStateCoverage({
      modules: [{ moduleId: 'payments', activationSettingCode: 'payments.enabled' }],
      files: [
        {
          path: 'test/integration/payu/payments-off.test.ts',
          text: "await expectModuleAbsent(h, 'payments', { routes: ['/api/v1/admin/payments'] });",
        },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(result.covered).toEqual(['payments']);
  });

  it('does not credit a module merely because the file sits in its directory', () => {
    const result = checkOffStateCoverage({
      modules: [
        { moduleId: 'payu', activationSettingCode: 'payu.enabled' },
        { moduleId: 'payments', activationSettingCode: 'payments.enabled' },
      ],
      files: [
        {
          path: 'test/integration/payu/payments-off.test.ts',
          text: "await expectModuleAbsent(h, 'payments', { routes: ['/api/v1/admin/payments'] });",
        },
      ],
    });
    expect(result.findings.map((finding) => finding.moduleId)).toEqual(['payu']);
  });
});

describe('the resolver', () => {
  const subjectsOf = (text: string): string[] =>
    harnessSitesIn({ path: 'test/f.test.ts', text }).flatMap((site) => [...site.subjects]);

  it('reads a file-local const alias', () => {
    expect(
      subjectsOf(["const MODULE = 'blog';", "await withModuleOff(MODULE, 'deactivated', f);"].join('\n')),
    ).toEqual(['blog']);
  });

  it('prefers the nearest binding when an alias is shadowed', () => {
    // `off-state-harness.test.ts` declares `CORE = 'audit_logs'` at file scope
    // and shadows it with `CORE = 'fixture_non_deactivatable'` inside a second
    // `describe`. A file-wide map answers one of them for both call sites.
    const text = [
      "const CORE = 'audit_logs';",
      "describe('outer', () => {",
      "  it('a', () => withModuleOff(CORE, 'platform-unavailable', f));",
      '});',
      "describe('inner', () => {",
      "  const CORE = 'fixture_non_deactivatable';",
      "  it('b', () => withModuleOff(CORE, 'platform-unavailable', f));",
      '});',
    ].join('\n');
    expect(subjectsOf(text)).toEqual(['audit_logs', 'fixture_non_deactivatable']);
  });

  it('reads an it.each table through a member of its object literals', () => {
    // The sixteen `_admin_surfaces/batch-*-palette-off-state.test.ts` files.
    // Without this shape those nine sites resolve to nothing and the check
    // reports nine `unresolvable-subject` findings that are not there.
    const text = [
      'const SUBJECTS = [',
      "  { module: 'seo', axis: 'deactivated' },",
      "  { module: 'megamenu', axis: 'deactivated' },",
      '];',
      "it.each(SUBJECTS)('$module', async (subject) => {",
      '  await withModuleOff(subject.module, subject.axis, async () => {});',
      '});',
    ].join('\n');
    expect(subjectsOf(text)).toEqual(['seo', 'megamenu']);
  });

  it('reads describe.each, forEach, map and for…of over the same table', () => {
    const table = "const SUBJECTS = [{ module: 'a' }, { module: 'b' }];";
    expect(
      subjectsOf(
        [table, "describe.each(SUBJECTS)('$module', (s) => withModuleOff(s.module, 'x', f));"].join(
          '\n',
        ),
      ),
    ).toEqual(['a', 'b']);
    expect(
      subjectsOf([table, "SUBJECTS.forEach((s) => withModuleOff(s.module, 'x', f));"].join('\n')),
    ).toEqual(['a', 'b']);
    expect(
      subjectsOf([table, "SUBJECTS.map((s) => withModuleOff(s.module, 'x', f));"].join('\n')),
    ).toEqual(['a', 'b']);
    expect(
      subjectsOf(
        [table, 'for (const s of SUBJECTS) { withModuleOff(s.module, "x", f); }'].join('\n'),
      ),
    ).toEqual(['a', 'b']);
  });

  it('reads a loop over string literals', () => {
    expect(
      subjectsOf("for (const id of ['blog', 'seo']) { withModuleOff(id, 'deactivated', f); }"),
    ).toEqual(['blog', 'seo']);
  });

  it('covers every module a table names, not only the first', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        {
          path: 'test/integration/_admin_surfaces/batch.test.ts',
          text: [
            "const SUBJECTS = [{ module: 'blog' }, { module: 'seo' }];",
            "it.each(SUBJECTS)('$module', async (subject) => {",
            '  await expectModuleAbsent(h, subject.module, { routes: [r] });',
            '});',
          ].join('\n'),
        },
      ],
    });
    expect(result.findings).toEqual([]);
    expect([...result.covered].sort()).toEqual(['blog', 'seo']);
  });

  it('refuses a subject it cannot read rather than skipping it', () => {
    // Issue #113: treating an unreadable subject as "some module is covered" is
    // the direction that agrees with the defect.
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        BLOG_PROOF,
        SEO_PROOF,
        {
          path: 'test/integration/x/computed.test.ts',
          text: 'await expectModuleAbsent(h, idFor(row), { routes: [r] });',
        },
      ],
    });
    expect(kinds(result.findings)).toEqual(['unresolvable-subject']);
    expect(result.findings[0]?.detail).toContain('idFor(row)');
    expect(result.findings[0]?.line).toBe(1);
  });

  it('refuses a table whose members it cannot read in full', () => {
    // Partial resolution is the worst of both: it credits the members it read
    // and says nothing about the ones it did not.
    const sites = harnessSitesIn({
      path: 'test/f.test.ts',
      text: [
        "const SUBJECTS = [{ module: 'blog' }, { module: computed() }];",
        "it.each(SUBJECTS)('$module', (s) => withModuleOff(s.module, 'x', f));",
      ].join('\n'),
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.subjects).toEqual([]);
    expect(sites[0]?.resolved).toBe(false);
  });

  it('does not read an ordinary function parameter as a subject', () => {
    // `off-state.ts`'s own `withModuleOff(moduleId, …)` is this shape. The
    // harness is excluded from the caller walk, and any other file writing it
    // is a finding rather than a silent skip.
    const sites = harnessSitesIn({
      path: 'test/f.test.ts',
      text: 'export async function go(moduleId) { await withModuleOff(moduleId, "x", f); }',
    });
    expect(sites[0]?.subjects).toEqual([]);
  });

  it('counts one site per call, whatever the enclosing shape', () => {
    const sites = harnessSitesIn({
      path: 'test/f.test.ts',
      text: [
        "const SUBJECTS = [{ module: 'a' }, { module: 'b' }, { module: 'c' }];",
        "it.each(SUBJECTS)('$module', (s) => withModuleOff(s.module, 'x', f));",
      ].join('\n'),
    });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.subjects).toHaveLength(3);
  });
});

describe('a subject the manifest index does not register', () => {
  it('is a finding — a proof of absence for a module that does not exist', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        BLOG_PROOF,
        SEO_PROOF,
        {
          path: 'test/integration/x/renamed.test.ts',
          text: "await expectModuleAbsent(h, 'no_such_module', { routes: [r] });",
        },
      ],
    });
    expect(kinds(result.findings)).toEqual(['unknown-subject']);
    expect(result.findings[0]?.moduleId).toBe('no_such_module');
  });

  it('is not a finding when the file declares that module itself', () => {
    // The derivation that keeps synthetic fixtures out without a path
    // exclusion. `off-state-harness.test.ts` builds `fixture_gated` and
    // `shipments/carrier-module-off.test.ts` builds `demo_carrier`; both put
    // the id into the registry cache in the same file, which is what makes it
    // a module for the length of that file and nowhere else.
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        BLOG_PROOF,
        SEO_PROOF,
        {
          path: 'test/unit/_lifecycle/off-state-harness.test.ts',
          text: [
            "const GATED = 'fixture_gated';",
            'registryCache.__setEnabledForTesting([GATED]);',
            'await expectModuleAbsent({ app }, GATED, { routes: [r] });',
          ].join('\n'),
        },
      ],
    });
    expect(result.findings).toEqual([]);
  });

  it('is a finding again when the seeding goes through a name it cannot read', () => {
    // Fail closed: the exemption is a fact the file states in literals, not an
    // assumption about anything that happens to mention the registry.
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [
        BLOG_PROOF,
        SEO_PROOF,
        {
          path: 'test/unit/x.test.ts',
          text: [
            'registryCache.__setEnabledForTesting(idsFromSomewhere());',
            "await expectModuleAbsent({ app }, 'fixture_gated', { routes: [r] });",
          ].join('\n'),
        },
      ],
    });
    expect(kinds(result.findings)).toEqual(['unknown-subject']);
  });

  it('is not a finding for a per-deployment overlay module', () => {
    // `example_overlay` exists and is switchable, and its own off-state case
    // drives `withModuleOff` against it. It is absent from the *generated
    // manifest index* by design — that artefact is bare core under every value
    // of `DEPLOYMENT` (D-104) — so "does this module exist" takes the
    // deployments' answer beside the index's.
    const overlayFile = {
      path: 'test/integration/overlay/overlay-module-composition.test.ts',
      text: "await withModuleOff('example_overlay', 'deactivated', async () => {});",
    };
    expect(
      checkOffStateCoverage({
        modules: MODULES,
        files: [BLOG_PROOF, SEO_PROOF, overlayFile],
      }).findings.map((finding) => finding.kind),
    ).toEqual(['unknown-subject']);
    expect(
      checkOffStateCoverage({
        modules: MODULES,
        files: [BLOG_PROOF, SEO_PROOF, overlayFile],
        deploymentModules: ['example_overlay'],
      }).findings,
    ).toEqual([]);
  });

  it('does not put an overlay module into the population it judges', () => {
    // The other direction, and the one that would be wrong to get backwards:
    // an overlay module owing a proof to a run that composes none of them
    // would be a finding every bare-core pipeline reports and nobody can fix.
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF, SEO_PROOF],
      deploymentModules: ['example_overlay'],
    });
    expect(result.population).toEqual(['blog', 'seo']);
    expect(result.findings).toEqual([]);
  });

  it('reads an id seeded beside a spread of the real baseline', () => {
    expect([
      ...locallyDeclaredModuleIds({
        path: 'test/f.test.ts',
        text: [
          "const CARRIER_MODULE = 'demo_carrier';",
          'registryCache.__setEnabledForTesting([...baseline, CARRIER_MODULE]);',
        ].join('\n'),
      }),
    ]).toEqual(['demo_carrier']);
  });
});

describe('the ledger', () => {
  it('lands empty', () => {
    // §7. An entry means "this module has an activation control and still owes
    // no `expectModuleAbsent` proof", which is a strong claim; the one module
    // that genuinely cannot carry a proof is outside the population by
    // derivation instead.
    expect(OFF_STATE_COVERAGE_EXEMPT).toEqual({});
  });

  it('excuses a module in the population', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF],
      ledger: { seo: 'the harness reads every body as JSON; the sitemap answers XML' },
    });
    expect(result.findings).toEqual([]);
  });

  it('reports an entry for a module that is now covered', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF, SEO_PROOF],
      ledger: { seo: 'covered since batch two' },
    });
    expect(kinds(result.findings)).toEqual(['stale-ledger-entry']);
    expect(result.findings[0]?.moduleId).toBe('seo');
  });

  it('reports an entry for an id that is not in the population', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF, SEO_PROOF],
      ledger: { orders: 'locked', gone: 'unregistered' },
    });
    expect(kinds(result.findings)).toEqual(['orphan-ledger-entry']);
    expect(result.findings.map((finding) => finding.moduleId).sort()).toEqual(['gone', 'orders']);
  });

  it('reports an entry whose reason nobody wrote', () => {
    const result = checkOffStateCoverage({
      modules: MODULES,
      files: [BLOG_PROOF],
      ledger: { seo: '   ' },
    });
    expect(kinds(result.findings)).toEqual(['ledger-entry-without-a-reason']);
  });
});

describe('the harness is read rather than assumed', () => {
  const HARNESS = [
    "export type OffStateAxis = 'deactivated' | 'platform-unavailable';",
    'export async function withModuleOff(moduleId, axis, body) {}',
    'export interface OffStateProbe { url: string }',
    'export async function expectModuleAbsent(server, moduleId, surfaces) {}',
  ].join('\n');

  it('reads the two names off the harness source', () => {
    expect(harnessExportedFunctions(HARNESS)).toEqual(['expectModuleAbsent', 'withModuleOff']);
  });

  it('counts an exported type as no assertion helper', () => {
    // `harness-exports` is a floor over the *callable* seams; counting the
    // three exported types would make it 2/5 and refuse every run.
    expect(harnessExportsCoverage(HARNESS)).toEqual({
      source: 'harness-exports',
      expected: 2,
      covered: 2,
    });
  });

  it('goes short when the harness grows a third assertion helper', () => {
    const grown = `${HARNESS}\nexport async function expectModuleDegraded(server, id) {}`;
    expect(harnessExportsCoverage(grown)).toEqual({
      source: 'harness-exports',
      expected: 3,
      covered: 2,
    });
    expect(
      readSizeRefusal({
        prefix: '[off-state-coverage]',
        files: 106,
        sites: 198,
        coverage: [harnessExportsCoverage(grown)],
      })?.kind,
    ).toBe('short-walk');
  });
});

describe('exit 2 — one per input whose absence makes the predicate vacuously clean', () => {
  const HARNESS = {
    path: 'test/helpers/off-state.ts',
    source: [
      'export async function withModuleOff(a, b, c) {}',
      'export async function expectModuleAbsent(a, b, c) {}',
    ].join('\n'),
  };
  const sound = { modules: MODULES, files: [BLOG_PROOF, SEO_PROOF], harness: HARNESS };

  it('says nothing about a run that read its inputs', () => {
    expect(vacuousOffStateCoverage(sound)).toBeNull();
  });

  it('(1) refuses a manifest index that yields no module', () => {
    expect(vacuousOffStateCoverage({ ...sound, modules: [] })?.kind).toBe('no-registered-module');
  });

  it('(2) refuses a population in which nothing declares an activation control', () => {
    expect(
      vacuousOffStateCoverage({
        ...sound,
        modules: [{ moduleId: 'orders', activationSettingCode: null }],
      })?.kind,
    ).toBe('no-activation-control');
  });

  it('(3) refuses a walk that opened no file', () => {
    expect(vacuousOffStateCoverage({ ...sound, files: [] })?.kind).toBe('no-caller-file');
  });

  it('(4) refuses a walk that resolved no expectModuleAbsent site', () => {
    // The load-bearing one. With 46 modules in the population this state is
    // reported as 46 findings — loud, and the opposite of the truth.
    const refusal = vacuousOffStateCoverage({
      ...sound,
      files: [
        {
          path: 'test/integration/x/palette.test.ts',
          text: "await withModuleOff('blog', 'deactivated', f);",
        },
      ],
    });
    expect(refusal?.kind).toBe('no-assertion-site');
    expect(refusal?.message).toContain('withModuleOff');
  });

  it('(5) refuses a harness that is not where the check looks', () => {
    expect(vacuousOffStateCoverage({ ...sound, harness: { ...HARNESS, source: null } })?.kind).toBe(
      'harness-not-found',
    );
  });

  it('(5) refuses a harness that no longer exports both names', () => {
    expect(
      vacuousOffStateCoverage({
        ...sound,
        harness: { ...HARNESS, source: 'export async function withModuleOff(a, b, c) {}' },
      })?.kind,
    ).toBe('harness-not-found');
  });

  it('(4) is decided before the findings, so a blind run never prints them', () => {
    const blind = { ...sound, files: [{ path: 'test/x.test.ts', text: 'const noop = 1;' }] };
    // Both (3) and (4) hold here; the run refuses on the first, and either way
    // it is a refusal rather than the two `uncovered-module` findings the
    // analysis would otherwise produce.
    expect(vacuousOffStateCoverage(blind)).not.toBeNull();
    expect(checkOffStateCoverage(blind).findings).toHaveLength(2);
  });
});
