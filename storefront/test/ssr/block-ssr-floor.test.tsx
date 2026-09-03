import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  deriveLoadingStateMarkers,
  isLoadingState,
  reconcilePopulation,
  renderSkeletonModule,
  runBlockSsrFloor,
  type BlockSsrFloorRefusal,
  type DisagreementLedgerEntry,
  type LedgerEntry,
  type LoadingStateMarkers,
  type Palette,
} from './block-ssr-floor.js';

/**
 * Red proofs for the block SSR floor — one per refusal of
 * `specs/098-storefront-ssr-seo-a11y-suite/contracts/block-ssr-floor.md` §5, and one per
 * direction of the §6 ledger.
 *
 * Every fixture enters at the **top** of the analysis — a palette, a render function, a
 * skeleton module — never as a pre-classified record (issue #130). A proof that entered below
 * the classification would leave the classifier itself unexercised, which is the shape that
 * made a whole check blind.
 */

const SKELETON_HTML = '<div class="skel-root skel-block" aria-busy="true"></div>';
const REAL_HTML = '<ul class="grid"><li>Widget</li></ul>';

const markers: LoadingStateMarkers = deriveLoadingStateMarkers([
  { name: 'GridSkeleton', html: SKELETON_HTML },
  { name: 'ListSkeleton', html: '<ul class="list skel-block"></ul>' },
]);

const noLedger: Record<string, LedgerEntry> = {};
const noDisagreements: Record<string, DisagreementLedgerEntry> = {};

function palette(components: Record<string, { defaultProps?: Record<string, unknown> }>,
  categories?: Palette['categories']): Palette {
  return {
    components,
    categories: categories ?? { all: { components: Object.keys(components) } },
  };
}

function renderingAll(html: string) {
  return () => html;
}

describe('the recogniser is derived from the skeleton components (contract §4)', () => {
  it('renders every component a skeleton module exports and ignores its non-components', () => {
    const rendered = renderSkeletonModule(
      {
        AlphaSkeleton: () => createElement('div', { className: 'skel-block' }),
        BetaSkeleton: () => createElement('span', { className: 'skel-block' }),
        SKELETON_MIN_MS: 300,
      },
      (component) => renderToString(createElement(component as never)),
    );

    expect(rendered.map((skeleton) => skeleton.name)).toEqual(['AlphaSkeleton', 'BetaSkeleton']);
  });

  it('takes the intersection, so a skeleton that reuses its real component class does not make that class a marker', () => {
    // `ProductGridSkeleton`'s root carries `cmsc-pb-product-grid` — the real grid's own class.
    // A union recogniser would report a correctly repaired block as a loading state.
    const derived = deriveLoadingStateMarkers([
      { name: 'GridSkeleton', html: '<ul class="grid skel-block"></ul>' },
      { name: 'ListSkeleton', html: '<ul class="list skel-block"></ul>' },
    ]);

    expect(derived.classTokens).toEqual(['skel-block']);
    expect(isLoadingState('<ul class="grid"><li>Widget</li></ul>', derived)).toBe(false);
    expect(isLoadingState('<ul class="grid skel-block"></ul>', derived)).toBe(true);
  });

  it('refuses a recogniser that would match nothing', () => {
    expect(() =>
      deriveLoadingStateMarkers([
        { name: 'A', html: '<div class="a"></div>' },
        { name: 'B', html: '<div class="b"></div>' },
      ]),
    ).toThrow(/no-loading-state-markers/);
    expect(() => deriveLoadingStateMarkers([])).toThrow(/no-loading-state-markers/);
  });
});

describe('the five refusals (contract §5)', () => {
  it('refuses a palette it could not import', () => {
    for (const unimportable of [null, undefined]) {
      const refusal = (() => {
        try {
          reconcilePopulation(unimportable);
          return null;
        } catch (error) {
          return error as BlockSsrFloorRefusal;
        }
      })();
      expect(refusal?.kind).toBe('palette-unreadable');
    }
  });

  it('refuses a palette that holds zero blocks', () => {
    try {
      reconcilePopulation({ components: {}, categories: {} });
      expect.unreachable('an empty palette must refuse');
    } catch (error) {
      expect((error as BlockSsrFloorRefusal).kind).toBe('empty-palette');
    }
  });

  it('refuses a run in which zero blocks were rendered', () => {
    try {
      runBlockSsrFloor({
        palette: palette({ Alpha: {}, Beta: {} }),
        renderBlock: renderingAll(REAL_HTML),
        markers,
        ledger: noLedger,
        disagreementLedger: noDisagreements,
      });
      expect.unreachable('a palette that produced no assertion must refuse');
    } catch (error) {
      expect((error as BlockSsrFloorRefusal).kind).toBe('nothing-rendered');
    }
  });

  it('refuses a block that threw rather than reading it as clean', () => {
    try {
      runBlockSsrFloor({
        palette: palette({ Alpha: { defaultProps: {} } }),
        renderBlock: () => {
          throw new Error('window is not defined');
        },
        markers,
        ledger: noLedger,
        disagreementLedger: noDisagreements,
      });
      expect.unreachable('a block that threw must refuse');
    } catch (error) {
      expect((error as BlockSsrFloorRefusal).kind).toBe('block-threw');
      expect((error as Error).message).toContain('Alpha');
    }
  });

  it('refuses a population whose two authors disagree beyond the ledger', () => {
    try {
      runBlockSsrFloor({
        palette: palette({ Alpha: { defaultProps: {} }, Orphan: { defaultProps: {} } }, {
          all: { components: ['Alpha', 'Ghost'] },
        }),
        renderBlock: renderingAll(REAL_HTML),
        markers,
        ledger: noLedger,
        disagreementLedger: noDisagreements,
      });
      expect.unreachable('an unledgered disagreement must refuse');
    } catch (error) {
      expect((error as BlockSsrFloorRefusal).kind).toBe(
        'population-disagreement-beyond-the-ledger',
      );
      expect((error as Error).message).toContain('Orphan (uncategorised-block)');
      expect((error as Error).message).toContain('Ghost (unregistered-block)');
    }
  });

  it('does not refuse a disagreement the ledger records, and reports it', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Alpha: { defaultProps: {} }, Orphan: { defaultProps: {} } }, {
        all: { components: ['Alpha'] },
      }),
      renderBlock: renderingAll(REAL_HTML),
      markers,
      ledger: noLedger,
      disagreementLedger: {
        Orphan: { kind: 'uncategorised-block', reason: 'measured', repairedBy: 'somewhere' },
      },
    });

    expect(result.population.disagreements).toEqual([
      { block: 'Orphan', kind: 'uncategorised-block' },
    ]);
    expect(result.findings).toEqual([]);
  });
});

describe('the ledger is two-way (contract §6)', () => {
  it('fails a block that renders a loading state with no entry', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Alpha: { defaultProps: {} }, Skeletal: { defaultProps: {} } }),
      renderBlock: (name) => (name === 'Skeletal' ? SKELETON_HTML : REAL_HTML),
      markers,
      ledger: noLedger,
      disagreementLedger: noDisagreements,
    });

    expect(result.findings).toEqual([{ kind: 'loading-state', block: 'Skeletal' }]);
  });

  it('fails an entry naming a block that no longer renders one', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Repaired: { defaultProps: {} } }),
      renderBlock: renderingAll(REAL_HTML),
      markers,
      ledger: {
        Repaired: { state: 'GridSkeleton', reason: 'measured', repairedBy: 'feature 096' },
      },
      disagreementLedger: noDisagreements,
    });

    expect(result.findings).toEqual([{ kind: 'stale-ledger-entry', block: 'Repaired' }]);
  });

  it('refuses an entry with no retiring condition', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Skeletal: { defaultProps: {} } }),
      renderBlock: renderingAll(SKELETON_HTML),
      markers,
      ledger: { Skeletal: { state: 'GridSkeleton', reason: 'measured', repairedBy: '  ' } },
      disagreementLedger: noDisagreements,
    });

    expect(result.findings).toEqual([
      { kind: 'ledger-entry-without-a-retiring-condition', block: 'Skeletal' },
    ]);
  });

  it('fails a disagreement entry that no longer describes a disagreement', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Alpha: { defaultProps: {} } }),
      renderBlock: renderingAll(REAL_HTML),
      markers,
      ledger: noLedger,
      disagreementLedger: {
        Gone: { kind: 'uncategorised-block', reason: 'measured', repairedBy: 'feature 096' },
      },
    });

    expect(result.findings).toEqual([{ kind: 'stale-disagreement-ledger-entry', block: 'Gone' }]);
  });

  it('reports a block that declares no defaultProps rather than skipping it', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Alpha: { defaultProps: {} }, Bare: {} }),
      renderBlock: renderingAll(REAL_HTML),
      markers,
      ledger: noLedger,
      disagreementLedger: noDisagreements,
    });

    expect(result.findings).toEqual([{ kind: 'no-default-props', block: 'Bare' }]);
  });
});

describe('the read: line (contract §5)', () => {
  it('prints the block count, the render count, the ledger size and the second author', () => {
    const result = runBlockSsrFloor({
      palette: palette({ Alpha: { defaultProps: {} }, Orphan: { defaultProps: {} } }, {
        all: { components: ['Alpha'] },
      }),
      renderBlock: renderingAll(REAL_HTML),
      markers,
      ledger: noLedger,
      disagreementLedger: {
        Orphan: { kind: 'uncategorised-block', reason: 'measured', repairedBy: 'somewhere' },
      },
    });

    expect(result.readLine).toBe(
      '[block-ssr-floor] read: blocks=2 rendered=2 ledgered=0 sources=drawer-taxonomy:1/2',
    );
  });
});
