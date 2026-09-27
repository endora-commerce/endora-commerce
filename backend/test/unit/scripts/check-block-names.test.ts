import { describe, expect, it } from 'vitest';
import {
  BLOCKS_WITHOUT_A_RENDERER,
  PREFIX,
  absentModuleRefusal,
  parseAbsentModules,
} from '../../../scripts/check-block-names.js';
import {
  blockNameFindings,
  blockNameFindingsOfKind,
  blockNameParseFailure,
  blockNameRefusalOf,
  nodeLiteralSource,
  rendererMapSource,
  rendererSwitchSource,
} from '../../helpers/block-name-fixture.js';

/**
 * `check:block-names` — feature 096, T704.
 * Contract: `specs/096-page-builder-block-ownership/contracts/block-name-check.md` §7.
 *
 * **Eight red proofs, three discrimination proofs, two vacuous-pass proofs**, and
 * every one enters at the top of the analysis with *source text plus a manifest
 * set* — never a pre-classified record (issue #130). The builder is shared with
 * the inventory's own proofs, so the two cannot come to disagree about what a
 * fixture means.
 */

const CMS_DECLARES_HERO = {
  id: 'cms',
  blocks: [{ name: 'cms.Hero', category: 'content', contexts: ['cms'] }],
  categories: [{ key: 'content', contexts: ['cms'] }],
};

/** The renderer half, so `declared-without-renderer` does not fire incidentally. */
const HERO_RENDERER = {
  key: 'packages/cms-components/src/index.ts',
  text: rendererMapSource(['cms.Hero']),
};

describe('check:block-names — what it is', () => {
  it('prints under its own prefix and lands with an empty ledger', () => {
    // §4: `BLOCKS_WITHOUT_A_RENDERER` is the only ledger this check has and it
    // is empty on arrival, because at the moment it lands every declared block
    // has a first-party renderer. Never add an entry to make a run pass — an
    // entry says a block's renderer chain is the theme's, which is F7's work.
    expect(PREFIX).toBe('[block-names]');
    expect(Object.keys(BLOCKS_WITHOUT_A_RENDERER)).toEqual([]);
  });
});

describe('check:block-names — the eight findings', () => {
  it('bare-block-name — a node literal whose type carries no owner segment', () => {
    const findings = blockNameFindings({
      sources: [
        { key: 'packages/modules/cms/src/seed.ts', text: nodeLiteralSource('Hero') },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('bare-block-name');
    expect(findings[0]!.where).toContain('packages/modules/cms/src/seed.ts');
    expect(findings[0]!.detail).toContain('`Hero`');
  });

  it('undeclared-block-name — a tree site naming a block no manifest declares', () => {
    const findings = blockNameFindings({
      sources: [
        { key: 'packages/modules/cms/src/seed.ts', text: nodeLiteralSource('cms.Nope') },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('undeclared-block-name');
    expect(findings[0]!.detail).toContain('`cms.Nope`');
  });

  it('foreign-namespace-declaration — a manifest declaring another module’s namespace', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [HERO_RENDERER],
        modules: [
          {
            id: 'cms',
            blocks: [{ name: 'catalog.ProductGrid', category: 'catalog', contexts: ['cms'] }],
            categories: [{ key: 'catalog', contexts: ['cms'] }],
          },
        ],
      },
      'foreign-namespace-declaration',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.where).toBe('manifest:cms');
    expect(findings[0]!.detail).toContain('`catalog`');
    expect(findings[0]!.detail).toContain('`cms`');
  });

  it('duplicate-block-name — two modules declaring one name', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [HERO_RENDERER],
        modules: [
          CMS_DECLARES_HERO,
          {
            id: 'blog',
            blocks: [{ name: 'cms.Hero', category: 'content', contexts: ['cms'] }],
            categories: [{ key: 'content', contexts: ['cms'] }],
          },
        ],
      },
      'duplicate-block-name',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('`cms`');
    expect(findings[0]!.detail).toContain('`blog`');
  });

  it('declared-without-renderer — a declared block no renderer map keys', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [{ key: 'packages/cms-components/src/index.ts', text: rendererMapSource(['cms.Hero']) }],
        modules: [
          {
            id: 'cms',
            blocks: [
              { name: 'cms.Hero', category: 'content', contexts: ['cms'] },
              { name: 'cms.Ghost', category: 'content', contexts: ['cms'] },
            ],
            categories: [{ key: 'content', contexts: ['cms'] }],
          },
        ],
      },
      'declared-without-renderer',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('`cms.Ghost`');
  });

  it('renderer-without-declaration — a renderer map keying a block nobody declares', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          {
            key: 'packages/cms-components/src/index.ts',
            text: rendererMapSource(['cms.Hero', 'cms.Orphan']),
          },
        ],
        modules: [CMS_DECLARES_HERO],
      },
      'renderer-without-declaration',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.where).toContain('packages/cms-components/src/index.ts');
    expect(findings[0]!.detail).toContain('`cms.Orphan`');
  });

  it('unreadable-block-name — a computed type in a node position is a finding, not a skip', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          {
            key: 'packages/modules/cms/src/seed.ts',
            text:
              'declare const kind: string;\n' +
              'export const tree = { content: [{ type: `cms.${kind}`, props: {} }] };\n',
          },
          HERO_RENDERER,
        ],
        modules: [CMS_DECLARES_HERO],
      },
      'unreadable-block-name',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('TemplateExpression');
  });

  it('category-presentation-disagreement — two modules, one section, different weights', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          {
            key: 'packages/modules/invoices/src/config.tsx',
            text: rendererMapSource(['invoices.InvoiceHeader', 'ksef.InvoiceSection']),
          },
        ],
        modules: [
          {
            id: 'invoices',
            blocks: [
              { name: 'invoices.InvoiceHeader', category: 'invoice', contexts: ['invoice'] },
            ],
            categories: [{ key: 'invoice', contexts: ['invoice'], weight: 10 }],
          },
          {
            id: 'ksef',
            blocks: [{ name: 'ksef.InvoiceSection', category: 'invoice', contexts: ['invoice'] }],
            categories: [{ key: 'invoice', contexts: ['invoice'], weight: 20 }],
          },
        ],
      },
      'category-presentation-disagreement',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.where).toBe('section:invoice/invoice');
    expect(findings[0]!.detail).toContain('`invoices` (weight=10)');
    expect(findings[0]!.detail).toContain('`ksef` (weight=20)');
  });
});

describe('check:block-names — the discrimination proofs', () => {
  it('a Puck field descriptor is not a node literal — this is what the `props` sibling buys', () => {
    // Hundreds of these exist. `{ type: 'text', label: 'Gap' }` has no `props`
    // sibling, and requiring one separates a node literal from a field
    // descriptor syntactically (§2.1).
    const findings = blockNameFindings({
      sources: [
        {
          key: 'packages/modules/cms/src/fields.ts',
          text:
            "export const fields = { gap: { type: 'number', label: 'Gap' }, " +
            "align: { type: 'text', label: 'Align' } };\n",
        },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toEqual([]);
  });

  it('a block name in a comment and in a quoted example produces nothing', () => {
    // The predicate reads literal AST nodes, so a comment is out of the
    // population by construction — which is what lets the contract be quoted
    // verbatim in the tree (`check:diacritic-folds`' discipline).
    const findings = blockNameFindings({
      sources: [
        {
          key: 'packages/modules/cms/src/notes.ts',
          text:
            "// The migration renames `Row` to `cms.Row`; a stored { type: 'Row', props: {} }\n" +
            '/**\n' +
            " * Example: `{ type: 'Hero', props: { id: 'x' } }` — the pre-096 spelling.\n" +
            ' */\n' +
            'export const nothing = 1;\n',
        },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toEqual([]);
  });

  it('a joining declaration that omits weight and visible produces nothing', () => {
    // The authoring guidance's own shape (`block-definition.md` §1.1): when you
    // are joining a section another module names, omit `weight` and `visible`
    // so you cannot take a presentation you did not intend to take. A check
    // that read an omission as a value would refuse the very thing the contract
    // tells authors to write.
    const findings = blockNameFindings({
      sources: [
        {
          key: 'packages/modules/invoices/src/config.tsx',
          text: rendererMapSource(['invoices.InvoiceHeader', 'ksef.InvoiceSection']),
        },
      ],
      modules: [
        {
          id: 'invoices',
          blocks: [{ name: 'invoices.InvoiceHeader', category: 'invoice', contexts: ['invoice'] }],
          categories: [{ key: 'invoice', contexts: ['invoice'], weight: 10, visible: true }],
        },
        {
          id: 'ksef',
          blocks: [{ name: 'ksef.InvoiceSection', category: 'invoice', contexts: ['invoice'] }],
          categories: [{ key: 'invoice', contexts: ['invoice'] }],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('a tree-copy helper is not an authored name', () => {
    // `{ type: record.type, props: record.props }` carries no written name: the
    // one it moves was authored elsewhere and is judged there. Three such
    // helpers exist in this tree, and reporting them would be a permanent
    // finding with no remedy and no ledger.
    const findings = blockNameFindings({
      sources: [
        {
          key: 'packages/page-builder-core/src/editor/outline-data.ts',
          text:
            'declare const record: { type: string; props: Record<string, unknown> };\n' +
            'export const copied = { type: record.type, props: record.props };\n',
        },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toEqual([]);
  });

  it('a `case` in a switch that is not over `node.type` is not a renderer site', () => {
    // Measured: any `.type` pulls in 26 names from five files that render no
    // block — a catalog attribute kind, a promotion kind, a Stripe
    // `event.type`, two rule builders — and every one would be a
    // `renderer-without-declaration` finding with no remedy.
    const findings = blockNameFindings({
      sources: [
        {
          key: 'packages/modules/stripe/src/backend/webhook.ts',
          text:
            'export function handle(event: { type: string }): string {\n' +
            '  switch (event.type) {\n' +
            "    case 'payment_intent.succeeded':\n      return 'ok';\n" +
            "    default:\n      return '';\n  }\n}\n",
        },
        HERO_RENDERER,
      ],
      modules: [CMS_DECLARES_HERO],
    });
    expect(findings).toEqual([]);
  });

  it('a renderer `switch (node.type)` is a renderer site', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          {
            key: 'packages/email-components/src/render/render-email-html.ts',
            text: rendererSwitchSource(['cms.Hero', 'cms.Orphan']),
          },
        ],
        modules: [CMS_DECLARES_HERO],
      },
      'renderer-without-declaration',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('`cms.Orphan`');
  });
});

describe('check:block-names — the ledger is two-way', () => {
  it('a ledgered block with no renderer is not a finding', () => {
    const findings = blockNameFindings({
      sources: [{ key: 'packages/cms-components/src/index.ts', text: rendererMapSource(['cms.Hero']) }],
      modules: [
        {
          id: 'cms',
          blocks: [
            { name: 'cms.Hero', category: 'content', contexts: ['cms'] },
            { name: 'cms.Themed', category: 'content', contexts: ['cms'] },
          ],
          categories: [{ key: 'content', contexts: ['cms'] }],
        },
      ],
      ledger: {
        'cms.Themed': { reason: 'its renderer chain is the theme’s', retiredBy: 'F7' },
      },
    });
    expect(findings).toEqual([]);
  });

  it('an entry naming a block that now has a renderer is stale', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          { key: 'packages/cms-components/src/index.ts', text: rendererMapSource(['cms.Hero']) },
        ],
        modules: [CMS_DECLARES_HERO],
        ledger: { 'cms.Hero': { reason: 'measured', retiredBy: 'F7' } },
      },
      'stale-ledger-entry',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain('now has a renderer');
  });

  it('an entry with no retiring condition is a finding', () => {
    const findings = blockNameFindingsOfKind(
      {
        sources: [
          { key: 'packages/cms-components/src/index.ts', text: rendererMapSource(['cms.Hero']) },
        ],
        modules: [
          {
            id: 'cms',
            blocks: [
              { name: 'cms.Hero', category: 'content', contexts: ['cms'] },
              { name: 'cms.Themed', category: 'content', contexts: ['cms'] },
            ],
            categories: [{ key: 'content', contexts: ['cms'] }],
          },
        ],
        ledger: { 'cms.Themed': { reason: 'measured', retiredBy: '  ' } },
      },
      'ledger-entry-without-a-retiring-condition',
    );
    expect(findings).toHaveLength(1);
  });
});

describe('check:block-names — the vacuous-pass proofs', () => {
  it('zero tree sites over an intact module walk is a refusal, not a clean run', () => {
    const refusal = blockNameRefusalOf({ treeSites: 0 });
    expect(refusal?.kind).toBe('no-tree-site');
    expect(refusal?.message).toContain('refusing to report a vacuous pass');
  });

  it('a family member whose renderer map does not parse is named, not read as empty', () => {
    const failure = blockNameParseFailure({
      key: 'packages/cms-components/src/index.ts',
      text: "export const config: Config = { components: { 'cms.Hero': ,,, } };\n",
    });
    expect(failure).not.toBeNull();
    // And the well-formed twin parses, so the proof is about the syntax rather
    // than about the reader always answering "broken".
    expect(
      blockNameParseFailure({
        key: 'packages/cms-components/src/index.ts',
        text: rendererMapSource(['cms.Hero']),
      }),
    ).toBeNull();
  });

  it('refuses each of the five value-decidable ways, in the stated order', () => {
    expect(blockNameRefusalOf({ familyMembers: 0 })?.kind).toBe('no-family-member');
    expect(blockNameRefusalOf({ declaredBlocks: 0 })?.kind).toBe('no-declared-block');
    expect(blockNameRefusalOf({ declaredCategories: 0 })?.kind).toBe('no-declared-category');
    expect(blockNameRefusalOf({ rendererSites: 0 })?.kind).toBe('no-renderer-site');
    // A moved tree is named as a moved tree rather than reported as 74
    // violations: with nothing declared and nothing read, the declaration
    // refusal is what the reader is given.
    expect(blockNameRefusalOf({ declaredBlocks: 0, treeSites: 0 })?.kind).toBe('no-declared-block');
    expect(blockNameRefusalOf({})).toBeNull();
  });
});

/**
 * `--absent <id>` — the tree judged with a module **absent**, not switched off
 * (`specs/134-paid-module-extraction/` T063; `contracts/extraction-procedure.md`
 * W6). The run over the real tree is `check-block-names-absent.test.ts`; these
 * are the flag's own two rules.
 */
describe('check:block-names — the absent harness', () => {
  it('reads the flag in both spellings, repeated and comma-separated', () => {
    expect(parseAbsentModules([])).toEqual([]);
    expect(parseAbsentModules(['--absent', 'ksef'])).toEqual(['ksef']);
    expect(parseAbsentModules(['--absent=ksef,infakt'])).toEqual(['infakt', 'ksef']);
    expect(parseAbsentModules(['--absent', 'ksef', '--absent', 'ksef', '--absent=wfirma'])).toEqual([
      'ksef',
      'wfirma',
    ]);
  });

  it('refuses a flag with no module id rather than judging the whole tree', () => {
    expect(() => parseAbsentModules(['--absent'])).toThrow(/names no module/);
    expect(() => parseAbsentModules(['--absent='])).toThrow(/names no module/);
  });

  it('refuses an id the manifest index does not register', () => {
    // A typo would otherwise remove nothing and print the present tree's clean
    // line under an `absent=` label — a vacuous pass of exactly the kind W6 is
    // written against.
    expect(absentModuleRefusal(['ksef'], ['invoices', 'ksef'])).toBeNull();
    expect(absentModuleRefusal(['kseff'], ['invoices', 'ksef'])).toMatch(/`kseff`.*registers no such module/);
  });
});
