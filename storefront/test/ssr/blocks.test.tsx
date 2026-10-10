import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render } from '@puckeditor/core';
import { parseBlockName } from '@endora-commerce/page-builder-core';
import * as CmsComponents from '@endora-commerce/cms-components';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { CatalogPreviewProvider } from '@endora-commerce/cms-components/components/catalog-preview-context';
import * as CatalogSkeletons from '@endora-commerce/cms-components/components/catalog/CatalogSkeletons';
import {
  BLOCKS_RENDERING_A_LOADING_STATE,
  POPULATION_DISAGREEMENTS,
  deriveLoadingStateMarkers,
  renderSkeletonModule,
  runBlockSsrFloor,
  type PaletteBlock,
} from './block-ssr-floor.js';

/**
 * The block SSR floor (FR-001…FR-005).
 * Contract: `specs/098-storefront-ssr-seo-a11y-suite/contracts/block-ssr-floor.md`.
 *
 * Every block the storefront composes into its page-builder palette is server-rendered with its
 * own `defaultProps`, and its output must not be a loading state. A loading state served to a
 * crawler is a promise of content that server rendering will never keep (Constitution VII).
 *
 * The population is the **composed palette at run time**, and the fixtures are the blocks' own
 * `defaultProps`. Nothing writes a block name into this test: a name appears only in a ledger,
 * and only as a recorded defect. A block added to the palette — by this package today, by a
 * module package under F9 — is covered here with no edit.
 *
 * **Why the predicate is negative.** `ProductGrid`'s `defaultProps` carries `productSlugs: []`,
 * so a *correctly repaired* block renders its **empty** state from those defaults. Empty is
 * legitimate; a skeleton is not. "The output contains a product name" would fail every repaired
 * block and would need a hand-written fixture per block, which is the second population this
 * whole feature exists to avoid.
 *
 * **What this floor cannot see** — declared here rather than discovered later:
 *
 * 1. **A block that renders `null` while loading.** Its HTML is absent rather than skeletal, and
 *    "this block renders nothing from its defaults" is true of many correct blocks.
 *    `check:rsc-discipline` (Phase 3, FR-020) is the net for that shape.
 * 2. **A block whose loading branch its own defaults cannot reach.** The worked case was the
 *    `ProductCard` block: its `defaultProps` carry `productSlug: ''`, so the defaults render
 *    the "Select a product" placeholder whether or not a selected product would have rendered
 *    "Loading product…" to a crawler — which it did, until the block was handed its data by
 *    the page's server render. A defaults-driven population cannot see that shape by
 *    construction; `test/ssr/catalog-blocks.test.tsx` renders each catalogue block with a
 *    selection, and supplying a slug *here* would be the hand-written fixture FR-003 forbids.
 * 3. **A block that loads correctly on the server and discards the result on the client.**
 * 4. **A block whose content is real but wrong.** This is a completeness gate, not a correctness
 *    one.
 *
 * Harness: `renderToString`, `environment: 'node'`, no jsdom and no React Testing Library —
 * what a crawler receives is what a test can be wrong about.
 */

/**
 * The render path is the storefront's own: `storefront/components/PageBuilderRender.tsx` hands
 * `defaultPageBuilderConfig` to Puck's `<Render>`, so that is what is exercised here, one block
 * per document. Calling `block.render` directly instead would judge four slot-bearing blocks
 * (`Row`, `Column`, `ContentSlider`, `Slide`) on an unrendered `content: []` array, which throws
 * `Element type is invalid` — a property of the caller, not of the block.
 */
function renderTree(name: string, block: PaletteBlock) {
  const data = {
    root: { props: {} },
    content: [{ type: name, props: { id: `${name}-1`, ...(block.defaultProps ?? {}) } }],
    zones: {},
  };
  return createElement(Render as never, {
    config: defaultPageBuilderConfig as never,
    data: data as never,
  });
}

/**
 * Under the catalogue provider, because that is where the storefront renders a
 * Page Builder tree: `CatalogBlockData` resolves what the page's blocks declare
 * and mounts `CatalogPreviewProvider` with the answers. The answers here are
 * none — an empty catalogue, or a backend that did not answer — which is the
 * least a block can be given and still must not answer with a skeleton.
 */
function renderBlock(name: string, block: PaletteBlock): string {
  return renderToString(
    createElement(CatalogPreviewProvider, { data: {}, children: renderTree(name, block) }),
  );
}

/**
 * The same block with no provider above it — the editor preview's situation,
 * where there is no server and a catalogue block fetches from an effect.
 */
function renderBlockWithoutProvider(name: string, block: PaletteBlock): string {
  return renderToString(renderTree(name, block));
}

/**
 * The population's second author, since feature 096: the React components this
 * package exports.
 *
 * The drawer taxonomy that used to play this part is gone — a palette section is
 * declared by the module whose blocks occupy it and served merged by the backend
 * (FR-009), and a storefront SSR test can reach neither. The barrel's
 * `export * from './components/X.js'` lines are written by hand for a different
 * purpose from the `components` map, which is what makes them a second answer to
 * "which of these are blocks".
 *
 * Derived from the module namespace by shape — a `ComponentConfig` has `render`
 * and `fields` — so a component added beside the others is covered with no edit
 * here, exactly as `renderSkeletonModule` derives the skeletons.
 */
const EXPORTED_BLOCK_COMPONENTS: readonly string[] = Object.entries(
  CmsComponents as unknown as Record<string, unknown>,
)
  .filter(
    ([, value]) =>
      typeof value === 'object' && value !== null && 'render' in value && 'fields' in value,
  )
  .map(([name]) => name);

/**
 * The palette as the floor sees it: the composed renderer map plus the second
 * author's claim, reconciled through the block name's own local segment
 * (`parseBlockName`, the one reader of that shape).
 */
const PALETTE = {
  ...defaultPageBuilderConfig,
  secondAuthor: EXPORTED_BLOCK_COMPONENTS.map((local) => {
    const key = Object.keys(defaultPageBuilderConfig.components ?? {}).find(
      (name) => parseBlockName(name)?.local === local,
    );
    return key ?? local;
  }),
};

const markers = deriveLoadingStateMarkers(
  renderSkeletonModule(CatalogSkeletons as unknown as Record<string, unknown>, (component) =>
    renderToString(createElement(component as never)),
  ),
);

function run(
  ledger: typeof BLOCKS_RENDERING_A_LOADING_STATE,
  render: typeof renderBlock = renderBlock,
) {
  return runBlockSsrFloor({
    palette: PALETTE as never,
    renderBlock: render,
    markers,
    ledger,
    disagreementLedger: POPULATION_DISAGREEMENTS,
  });
}

describe('the block SSR floor', () => {
  it('renders every block of the composed palette without a loading state, or ledgers it', () => {
    const result = run(BLOCKS_RENDERING_A_LOADING_STATE);
    // eslint-disable-next-line no-console -- the estate's read: line, printed on every run
    console.log(result.readLine);

    expect(result.findings).toEqual([]);
  });

  it('names every unledgered block, and only the blocks that render a loading state', () => {
    // The failing assertion this floor was written from (T102), kept as the discrimination
    // proof. Its subject used to be the storefront's own render; the catalogue blocks are
    // repaired there, so the proof is taken where the loading branch still legitimately
    // exists: with no catalogue provider above the tree, which is the editor preview. There
    // the floor names exactly the blocks whose HTML is a skeleton, and `ProductCard` — whose
    // defaults select no product — is not among them. It finds a shape, not a directory.
    const result = run({}, renderBlockWithoutProvider);

    expect(result.findings.map((finding) => finding.block).sort()).toEqual([
      'catalog.CategoryGrid',
      'catalog.CategoryList',
      'catalog.ProductGrid',
      'catalog.ProductSlider',
    ]);
    expect(result.findings.every((finding) => finding.kind === 'loading-state')).toBe(true);
    expect(result.loadingStates).not.toContain('catalog.ProductCard');
  });

  it('derives its loading-state recogniser from the skeleton components themselves', () => {
    // Contract §4: a skeleton renamed is a skeleton the recogniser follows. Nothing here spells
    // a class name; the assertion is that the derivation produced a usable recogniser.
    expect(markers.ariaBusy || markers.classTokens.length > 0).toBe(true);
  });

  it('reports the two population authors and their ledgered disagreement', () => {
    const result = run(BLOCKS_RENDERING_A_LOADING_STATE);

    expect(result.population.blocks.length).toBeGreaterThan(0);
    expect(result.rendered).toBe(result.population.blocks.length);
    // The `components` map and the package's exported components are two lists,
    // written separately, about one set. They already disagree — over the
    // degradation placeholder, which is `ComponentConfig`-shaped and is never a
    // block — and the disagreement is surfaced rather than papered over.
    expect(result.population.disagreements.map((d) => `${d.block}:${d.kind}`)).toEqual(
      Object.entries(POPULATION_DISAGREEMENTS).map(([block, entry]) => `${block}:${entry.kind}`),
    );
    expect(result.readLine).toContain(
      `sources=exported-components:${result.population.secondAuthor.length}/${result.population.blocks.length}`,
    );
  });
});
