/**
 * `check:class-vocabulary` — one red proof per shape it refuses, plus the
 * discriminations that keep the population honest (feature 110, T129b; owner
 * ruling D-219).
 *
 * **Every fixture enters at the top of the analysis** (issue #130): stylesheet
 * bytes and `.tsx` bytes, which is exactly what a real run reads, and none of
 * the answers a real run computes. A fixture handing in a pre-classified token
 * set would prove the reporter and leave the two predicates — the ones a
 * substring match has already got wrong once, at the cost of moving the wrong
 * third of the design system into a package — unproven.
 *
 * The refusals are proven over {@link vacuousReason}'s own inputs, which is
 * where a real run computes them.
 */
import { describe, expect, it } from 'vitest';

import { vacuousReason } from '../../../scripts/check-class-vocabulary.js';
import {
  checkClassVocabulary,
  classAttributeSites,
  declaredNamespaces,
  definedClasses,
  isVocabularyName,
  undefinedRenderKey,
  type ClassVocabularyFindingKind,
} from '../../../scripts/lib/class-vocabulary.js';

const THEME = 'packages/admin-kit/theme.css';

function findings(
  input: {
    readonly css?: string;
    readonly sources?: Record<string, string>;
    readonly unrendered?: Record<string, string>;
    readonly undefinedRenders?: Record<string, string>;
  },
  kind: ClassVocabularyFindingKind,
): readonly string[] {
  const result = checkClassVocabulary({
    stylesheets: new Map([[THEME, input.css ?? '']]),
    sources: new Map(Object.entries(input.sources ?? {})),
    unrendered: input.unrendered ?? {},
    undefinedRenders: input.undefinedRenders ?? {},
  });
  return result.findings.filter((finding) => finding.kind === kind).map((finding) => finding.token);
}

describe('P1 — what a stylesheet defines', () => {
  it('reads a class out of a rule prelude and nothing out of a comment or a URL', () => {
    const read = definedClasses(
      '/* quoting design-tokens.css and http://www.w3.org/2000/svg */\n' +
        '.b2b-btn { color: red }\n',
    );
    expect([...read.tokens]).toEqual(['b2b-btn']);
  });

  it('reads a prelude that spans lines — the miss that made 23 classes look like 22', () => {
    // §7.1's own shell command reads preludes line by line, so `.input` — which
    // is not the last selector on its line group — is lost. That undercount is
    // the difference between the shim's real 23 classes and the 22 R3.1a names.
    const read = definedClasses('.input,\n  .select,\n  .textarea {\n  width: 100%;\n}\n');
    expect([...read.tokens].sort()).toEqual(['input', 'select', 'textarea']);
  });

  it('reads a rule nested inside an at-rule', () => {
    const read = definedClasses('@media (max-width: 1023px) {\n  .b2b-sidebar { width: 0 }\n}\n');
    expect([...read.tokens]).toEqual(['b2b-sidebar']);
  });
});

describe('P2 — what a source renders', () => {
  it('reads a whole token in a class attribute and never a substring', () => {
    // The whole of R3.1a's error: `grep -rl 'badge--'` matches
    // `b2b-badge--success`, and that one substring produced *"11 module
    // packages render the shim"* when the honest number was zero.
    const sites = classAttributeSites(
      'export const S = () => <span className="b2b-badge b2b-badge--success" />;\n',
      'a.tsx',
    );
    expect(sites.flatMap((site) => site.tokens)).toEqual(['b2b-badge', 'b2b-badge--success']);
    expect(sites.flatMap((site) => site.tokens)).not.toContain('badge--success');
  });

  it('reads the arguments of a class helper', () => {
    const sites = classAttributeSites(
      "export const S = () => <b className={cn('b2b-tab', active && 'is-active')} />;\n",
      'a.tsx',
    );
    expect(sites.flatMap((site) => site.tokens).sort()).toEqual(['b2b-tab', 'is-active']);
  });

  it('reads a string that is not in a class-attribute position as nothing', () => {
    // 28 of the tokens the design system defines are unprefixed English words —
    // `name`, `role`, `count`, `table`. Matched in any string literal they
    // report a message catalogue and an organization member page.
    const sites = classAttributeSites("export const messages = { role: 'Role' };\n", 'a.ts');
    expect(sites).toHaveLength(0);
  });

  it('follows one hop into a file-local literal binding', () => {
    // Three `price_lists` screens are written exactly this way, and without the
    // hop `b2b-badge--info` is a definition nothing renders.
    const sites = classAttributeSites(
      "const STATUS = { scheduled: 'b2b-badge b2b-badge--info' };\n" +
        'export const S = () => <span className={STATUS.scheduled} />;\n',
      'a.tsx',
    );
    expect(sites.flatMap((site) => site.tokens)).toContain('b2b-badge--info');
  });

  it('does not follow a binding that is not a literal shape', () => {
    // `route-tabs.tsx` writes `const isActive = pathname.startsWith(`${to}/`)`
    // and renders `cn('b2b-tab', isActive && 'is-active')`. A hop that followed
    // any binding reaches that template's glued substitution and reports a
    // perfectly literal class attribute as `unresolvable-class`. Measured: four
    // such sites, all of them false.
    const sites = classAttributeSites(
      'const isActive = pathname === to || pathname.startsWith(`${to}/`);\n' +
        "export const S = () => <b className={cn('b2b-tab', isActive && 'is-active')} />;\n",
      'a.tsx',
    );
    expect(sites.every((site) => !site.computed)).toBe(true);
    expect(sites.flatMap((site) => site.tokens).sort()).toEqual(['b2b-tab', 'is-active']);
  });

  it('reads one position per class attribute, not one per helper argument', () => {
    const sites = classAttributeSites(
      "export const S = () => <b className={cn('a', 'b')} />;\n",
      'a.tsx',
    );
    expect(sites).toHaveLength(1);
  });

  it("counts a template's static chunks and not a substitution that separates them", () => {
    // `ProductsBulkEditDialog` writes this twice, and every class name in it is
    // a whole literal: the substitution's branches are `' b2b-btn--primary'`
    // and `''`, both of which separate.
    const sites = classAttributeSites(
      'export const S = () => (\n' +
        '  <b className={`b2b-btn b2b-btn--sm${on ? \' b2b-btn--primary\' : \'\'}`} />\n' +
        ');\n',
      'a.tsx',
    );
    expect(sites.every((site) => !site.computed)).toBe(true);
    expect(sites.flatMap((site) => site.tokens).sort()).toEqual([
      'b2b-btn',
      'b2b-btn--primary',
      'b2b-btn--sm',
    ]);
  });
});

describe('the namespace bound', () => {
  it('takes a first segment as a namespace only where the token has one', () => {
    const namespaces = declaredNamespaces(new Set(['b2b-btn', 'actions', 'pb-outline-item']));
    expect([...namespaces].sort()).toEqual(['b2b', 'pb']);
  });

  it('reads a BEM separator as a vocabulary name and a scale index as a utility', () => {
    // The one collision this rule declares: the page builder owns `pb-*` and
    // Tailwind spells padding-bottom `pb-4`; `col-cb` is defined here and
    // `col-span-10` is Tailwind's.
    expect(isVocabularyName('b2b-grid--cols-3')).toBe(true);
    expect(isVocabularyName('cms-page-builder__canvas')).toBe(true);
    expect(isVocabularyName('b2b-chip')).toBe(true);
    expect(isVocabularyName('pb-4')).toBe(false);
    expect(isVocabularyName('col-span-10')).toBe(false);
    expect(isVocabularyName('pb-[3px]')).toBe(false);
    expect(isVocabularyName('pb-auto')).toBe(false);
  });
});

describe('the findings', () => {
  it('refuses a render in a declared namespace that nothing defines', () => {
    expect(
      findings(
        {
          css: '.b2b-badge { color: red }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="b2b-badge--muted" />;\n' },
          unrendered: { 'b2b-badge': 'unrendered here on purpose' },
        },
        'undefined-render',
      ),
    ).toEqual(['b2b-badge--muted']);
  });

  it('leaves a Tailwind utility inside a declared namespace alone', () => {
    expect(
      findings(
        {
          css: '.pb-outline-item { color: red }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="pb-4" />;\n' },
          unrendered: { 'pb-outline-item': 'unrendered here on purpose' },
        },
        'undefined-render',
      ),
    ).toEqual([]);
  });

  it('leaves a token outside every declared namespace alone', () => {
    expect(
      findings(
        {
          css: '.b2b-btn { color: red }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="flex mb-4 text-sm" />;\n' },
          unrendered: { 'b2b-btn': 'unrendered here on purpose' },
        },
        'undefined-render',
      ),
    ).toEqual([]);
  });

  it('refuses a definition no file renders', () => {
    expect(
      findings(
        {
          css: '.b2b-savebar { position: sticky }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="b2b-btn" />;\n' },
          undefinedRenders: { [undefinedRenderKey('x.tsx', 'b2b-btn')]: 'ledgered here' },
        },
        'unrendered-definition',
      ),
    ).toEqual(['b2b-savebar']);
  });

  it('refuses a computed class name rather than skipping it', () => {
    // Issue #113: read as "some class is rendered" it excuses a definition, and
    // read as "no class is rendered" it accuses a render. Neither direction can
    // be decided, so the site is the finding.
    expect(
      findings(
        {
          css: '.b2b-btn { color: red }\n',
          sources: {
            'x.tsx': 'export const S = () => <b className={`b2b-btn--${variant}`} />;\n',
          },
          unrendered: { 'b2b-btn': 'unrendered here on purpose' },
        },
        'unresolvable-class',
      ),
    ).toEqual(['(computed)']);
  });

  it('refuses an unrendered-definition entry whose class is gone', () => {
    expect(
      findings({ css: '.b2b-btn { color: red }\n', unrendered: { 'b2b-gone': 'stale' } }, 'stale-ledger-entry'),
    ).toContain('b2b-gone');
  });

  it('refuses an unrendered-definition entry whose class is now rendered', () => {
    expect(
      findings(
        {
          css: '.b2b-btn { color: red }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="b2b-btn" />;\n' },
          unrendered: { 'b2b-btn': 'stale' },
        },
        'stale-ledger-entry',
      ),
    ).toEqual(['b2b-btn']);
  });

  it('refuses an undefined-render entry the walk no longer finds', () => {
    expect(
      findings(
        {
          css: '.b2b-btn { color: red }\n',
          sources: { 'x.tsx': 'export const S = () => <b className="b2b-btn" />;\n' },
          undefinedRenders: { [undefinedRenderKey('x.tsx', 'b2b-vanished')]: 'stale' },
        },
        'stale-ledger-entry',
      ),
    ).toEqual(['b2b-vanished']);
  });

  it('reports a ledgered render and a ledgered definition as nothing', () => {
    const result = checkClassVocabulary({
      stylesheets: new Map([[THEME, '.b2b-btn { color: red }\n.b2b-savebar { top: 0 }\n']]),
      sources: new Map([
        ['x.tsx', 'export const S = () => <b className="b2b-btn b2b-badge--muted" />;\n'],
      ]),
      unrendered: { 'b2b-savebar': 'recorded for a drain' },
      undefinedRenders: { [undefinedRenderKey('x.tsx', 'b2b-badge--muted')]: 'recorded' },
    });
    expect(result.findings).toEqual([]);
  });
});

describe('the refusals', () => {
  const full = {
    designSystems: 1,
    definedClasses: 200,
    sourceFiles: 2000,
    sites: 5000,
    moduleAdminLayers: 55,
  };

  it('passes a run that read everything it judges', () => {
    expect(vacuousReason(full)).toBeNull();
  });

  it('refuses a workspace with no published design system', () => {
    expect(vacuousReason({ ...full, designSystems: 0 })).toContain('theme.css');
  });

  it('refuses a design system whose preludes named no class', () => {
    expect(vacuousReason({ ...full, definedClasses: 0 })).toContain('empty');
  });

  it('refuses a walk that opened no source file', () => {
    expect(vacuousReason({ ...full, sourceFiles: 0 })).toContain('no source file');
  });

  it('refuses a walk that read no class-attribute position', () => {
    // Issues #235/#237: the file count stands still while the syntax walk goes
    // blind, and a healthy `files=` prints beside a cheerful `findings=0`.
    expect(vacuousReason({ ...full, sites: 0 })).toContain('class-attribute position');
  });

  it('refuses a contribution registry that names no module package', () => {
    expect(vacuousReason({ ...full, moduleAdminLayers: 0 })).toContain('independent author');
  });

  it('does not refuse a workspace with no contribution registry at all', () => {
    // `null` and `0` are different answers: no artefact is nothing to be short
    // of, an artefact naming none has lost the floor's independent author.
    expect(vacuousReason({ ...full, moduleAdminLayers: null })).toBeNull();
  });
});
