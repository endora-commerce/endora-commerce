/**
 * The block SSR floor — the analysis.
 *
 * Normative contract: `specs/098-storefront-ssr-seo-a11y-suite/contracts/block-ssr-floor.md`
 * (FR-001…FR-005). The claim it enforces:
 *
 * > Every block the storefront composes into a page-builder palette produces server HTML that
 * > is not a loading state.
 *
 * A loading state served to a crawler is a promise of content that server rendering will never
 * keep. The block is not slow; it is empty, permanently, for every reader that does not execute
 * JavaScript (Constitution VII).
 *
 * Everything here is a pure function over values the caller supplies, so a red proof can enter
 * at the top of the analysis rather than as a pre-classified record (issue #130). The live run
 * is `blocks.test.tsx`; the red proofs are `block-ssr-floor.test.tsx`.
 */

/** A block as the composed palette carries it. Only the fields the floor reads. */
export type PaletteBlock = {
  defaultProps?: Record<string, unknown> | undefined;
};

/**
 * The composed palette, in the shape `@measured/puck`'s `Config` presents, plus
 * the names a **second author** claims are blocks.
 *
 * **The second author changed with feature 096 and the reason is the design.**
 * It was the `categories[*].components` drawer taxonomy — a hand-written map in
 * `@endora-commerce/cms-components` — and that map is gone: a palette section is
 * declared by the module whose blocks occupy it and is served, merged across the
 * present modules, by `GET /api/v1/admin/cms/page-builder/config` (FR-009). A
 * storefront SSR test reaches no server and depends on no module package, so it
 * cannot read the declarations, and continuing to read `categories` would have
 * left the reconciliation comparing the components map to an empty set — every
 * block a disagreement, and the run refused.
 *
 * The author that replaced it is available and is genuinely a second program's
 * answer: **the React components the package exports**. The `components` map is
 * written by hand in `index.ts`; the barrel's `export * from './components/X.js'`
 * lines are written by hand beside them, for a different purpose. A key with no
 * component and a component in no key are exactly the two disagreements the
 * drawer taxonomy used to catch.
 */
export type Palette = {
  components?: Record<string, PaletteBlock> | undefined;
  /** Block names the second author claims. See the type's own note. */
  secondAuthor?: readonly string[] | undefined;
};

/**
 * The states in which a green would be vacuous. Contract §5: each of these is a refusal, not a
 * finding — the run stops rather than reporting on what is left.
 */
export type RefusalKind =
  | 'palette-unreadable'
  | 'empty-palette'
  | 'no-loading-state-markers'
  | 'nothing-rendered'
  | 'block-threw'
  | 'population-disagreement-beyond-the-ledger';

export class BlockSsrFloorRefusal extends Error {
  constructor(
    readonly kind: RefusalKind,
    message: string,
  ) {
    super(`[block-ssr-floor] refused (${kind}): ${message}`);
    this.name = 'BlockSsrFloorRefusal';
  }
}

// ---------------------------------------------------------------------------
// The recogniser, derived from the skeleton components themselves (contract §4)
// ---------------------------------------------------------------------------

/** What a skeleton's own server HTML says about itself. */
export type LoadingStateMarkers = {
  /** At least one skeleton announces itself with `aria-busy="true"`. */
  readonly ariaBusy: boolean;
  /** Class tokens **every** skeleton render carries. */
  readonly classTokens: readonly string[];
};

export type RenderedSkeleton = { readonly name: string; readonly html: string };

/** Every class token in a fragment of server HTML, in document order, de-duplicated. */
export function classTokensOf(html: string): string[] {
  const tokens = new Set<string>();
  for (const match of html.matchAll(/\sclass="([^"]*)"/g)) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * Renders every component a skeleton module exports.
 *
 * The population is the module's own exports, so a skeleton added beside the others is covered
 * with no edit here, and a skeleton renamed is a skeleton the recogniser follows rather than one
 * it stops seeing (contract §4).
 */
export function renderSkeletonModule(
  skeletonModule: Record<string, unknown>,
  render: (component: unknown) => string,
): RenderedSkeleton[] {
  const rendered: RenderedSkeleton[] = [];
  for (const [name, exported] of Object.entries(skeletonModule)) {
    if (typeof exported !== 'function') continue;
    rendered.push({ name, html: render(exported) });
  }
  return rendered;
}

/**
 * Derives the loading-state recogniser from the rendered skeletons.
 *
 * The class half is the **intersection**: a token every skeleton carries. The union would be
 * wrong in the direction that matters — a skeleton's root reuses its real component's own class
 * (`cmsc-pb-product-grid`, `cmsc-pb-category-list`), so a union recogniser would report a
 * correctly repaired block rendering real content as a loading state.
 *
 * Refuses an empty recogniser, because a recogniser that matches nothing reports every block
 * clean.
 */
export function deriveLoadingStateMarkers(
  skeletons: readonly RenderedSkeleton[],
): LoadingStateMarkers {
  if (skeletons.length === 0) {
    throw new BlockSsrFloorRefusal(
      'no-loading-state-markers',
      'the skeleton module exported no component to derive a recogniser from',
    );
  }

  const ariaBusy = skeletons.some((skeleton) => skeleton.html.includes('aria-busy="true"'));

  let shared: string[] = classTokensOf(skeletons[0]?.html ?? '');
  for (const skeleton of skeletons.slice(1)) {
    const tokens: string[] = classTokensOf(skeleton.html);
    shared = shared.filter((token: string) => tokens.includes(token));
  }
  const classTokens = [...shared].sort();

  if (!ariaBusy && classTokens.length === 0) {
    throw new BlockSsrFloorRefusal(
      'no-loading-state-markers',
      `no marker is shared by all ${skeletons.length} skeleton renders — the recogniser would match nothing`,
    );
  }

  return { ariaBusy, classTokens };
}

/** The predicate. Negative and structural: is this server HTML a loading state? */
export function isLoadingState(html: string, markers: LoadingStateMarkers): boolean {
  if (markers.ariaBusy && html.includes('aria-busy="true"')) return true;
  if (markers.classTokens.length === 0) return false;
  const tokens = new Set(classTokensOf(html));
  return markers.classTokens.some((token) => tokens.has(token));
}

// ---------------------------------------------------------------------------
// The population and its second author (contract §2)
// ---------------------------------------------------------------------------

export type PopulationDisagreement = {
  readonly block: string;
  readonly kind: 'uncategorised-block' | 'unregistered-block';
};

export type Population = {
  readonly blocks: readonly string[];
  /** What the second author claims. */
  readonly secondAuthor: readonly string[];
  readonly disagreements: readonly PopulationDisagreement[];
};

/**
 * Reconciles the two authors of the block population: the `components` map the storefront
 * composes, and the names a second author claims. Two lists, written separately, about one set.
 */
export function reconcilePopulation(palette: Palette | null | undefined): Population {
  if (palette === null || palette === undefined || typeof palette !== 'object') {
    throw new BlockSsrFloorRefusal(
      'palette-unreadable',
      'the composed palette could not be read — a green over zero blocks',
    );
  }

  const blocks = Object.keys(palette.components ?? {});
  if (blocks.length === 0) {
    throw new BlockSsrFloorRefusal(
      'empty-palette',
      'the composed palette holds zero blocks',
    );
  }

  const secondAuthor = new Set(palette.secondAuthor ?? []);

  const disagreements: PopulationDisagreement[] = [];
  for (const block of blocks) {
    if (!secondAuthor.has(block)) disagreements.push({ block, kind: 'uncategorised-block' });
  }
  for (const name of secondAuthor) {
    if (!blocks.includes(name)) disagreements.push({ block: name, kind: 'unregistered-block' });
  }

  return { blocks, secondAuthor: [...secondAuthor], disagreements };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type LedgerEntry = {
  /** The loading state this block renders, named. */
  readonly state: string;
  readonly reason: string;
  /** What retires this entry. An empty one is refused. */
  readonly repairedBy: string;
};

export type DisagreementLedgerEntry = {
  readonly kind: PopulationDisagreement['kind'];
  readonly reason: string;
  readonly repairedBy: string;
};

export type Finding =
  | { readonly kind: 'loading-state'; readonly block: string }
  | { readonly kind: 'no-default-props'; readonly block: string }
  | { readonly kind: 'stale-ledger-entry'; readonly block: string }
  | { readonly kind: 'ledger-entry-without-a-retiring-condition'; readonly block: string }
  | { readonly kind: 'stale-disagreement-ledger-entry'; readonly block: string };

export type FloorResult = {
  readonly population: Population;
  readonly rendered: number;
  readonly loadingStates: readonly string[];
  readonly findings: readonly Finding[];
  readonly readLine: string;
};

export type FloorInput = {
  readonly palette: Palette | null | undefined;
  /** Renders one block of the composed palette with its own `defaultProps`. */
  readonly renderBlock: (name: string, block: PaletteBlock) => string;
  readonly markers: LoadingStateMarkers;
  readonly ledger: Readonly<Record<string, LedgerEntry>>;
  readonly disagreementLedger: Readonly<Record<string, DisagreementLedgerEntry>>;
};

export function runBlockSsrFloor(input: FloorInput): FloorResult {
  const population = reconcilePopulation(input.palette);
  const components = input.palette?.components ?? {};

  const unledgeredDisagreements = population.disagreements.filter((disagreement) => {
    const entry = input.disagreementLedger[disagreement.block];
    return entry === undefined || entry.kind !== disagreement.kind;
  });
  if (unledgeredDisagreements.length > 0) {
    throw new BlockSsrFloorRefusal(
      'population-disagreement-beyond-the-ledger',
      `the two population authors disagree beyond the ledgered set: ${unledgeredDisagreements
        .map((disagreement) => `${disagreement.block} (${disagreement.kind})`)
        .join(', ')} — the population is not what either author says`,
    );
  }

  const findings: Finding[] = [];
  const loadingStates: string[] = [];
  let rendered = 0;

  for (const name of population.blocks) {
    const block = components[name] ?? {};
    if (block.defaultProps === undefined) {
      findings.push({ kind: 'no-default-props', block: name });
      continue;
    }
    let html: string;
    try {
      html = input.renderBlock(name, block);
    } catch (error) {
      throw new BlockSsrFloorRefusal(
        'block-threw',
        `${name} threw while rendering (${(error as Error).message}) — the block is unjudged, and an unjudged block must never read as clean`,
      );
    }
    rendered += 1;
    if (isLoadingState(html, input.markers)) loadingStates.push(name);
  }

  if (rendered === 0) {
    throw new BlockSsrFloorRefusal(
      'nothing-rendered',
      `the palette imported ${population.blocks.length} block(s) and produced no assertion`,
    );
  }

  const loading = new Set(loadingStates);
  for (const name of loadingStates) {
    if (input.ledger[name] === undefined) findings.push({ kind: 'loading-state', block: name });
  }
  for (const [name, entry] of Object.entries(input.ledger)) {
    if (!loading.has(name)) {
      findings.push({ kind: 'stale-ledger-entry', block: name });
      continue;
    }
    if (entry.repairedBy.trim() === '') {
      findings.push({ kind: 'ledger-entry-without-a-retiring-condition', block: name });
    }
  }

  const disagreeing = new Set(population.disagreements.map((disagreement) => disagreement.block));
  for (const name of Object.keys(input.disagreementLedger)) {
    if (!disagreeing.has(name)) {
      findings.push({ kind: 'stale-disagreement-ledger-entry', block: name });
    }
  }

  return {
    population,
    rendered,
    loadingStates,
    findings,
    readLine: formatReadLine({
      blocks: population.blocks.length,
      rendered,
      ledgered: Object.keys(input.ledger).length,
      secondAuthor: population.secondAuthor.length,
    }),
  };
}

/**
 * The estate's `read:` grammar. `sources` is the second author — since feature
 * 096, the React components the package exports — and the shortfall in it is
 * where a reader is meant to look.
 */
export function formatReadLine(counts: {
  blocks: number;
  rendered: number;
  ledgered: number;
  secondAuthor: number;
}): string {
  return `[block-ssr-floor] read: blocks=${counts.blocks} rendered=${counts.rendered} ledgered=${counts.ledgered} sources=exported-components:${counts.secondAuthor}/${counts.blocks}`;
}

// ---------------------------------------------------------------------------
// The ledgers (contract §6)
// ---------------------------------------------------------------------------

/**
 * `BLOCKS_RENDERING_A_LOADING_STATE` — two-way, keyed by block name, and it arrives populated
 * with the blocks measured on the day this floor landed.
 *
 * Both directions fail: a block rendering a loading state with no entry is the defect this
 * whole file exists for; an entry naming a block that no longer renders one is stale, and that
 * staleness is the signal that `specs/096-page-builder-block-ownership/` drained it.
 *
 * An entry that says "this block is right to render a skeleton" means the predicate has
 * outgrown its population — narrow it, never add the entry.
 */
export const BLOCKS_RENDERING_A_LOADING_STATE: Readonly<Record<string, LedgerEntry>> = {
  'catalog.ProductGrid': {
    state: 'ProductGridSkeleton',
    reason:
      'isLoading initialises true and is cleared from a useEffect that server rendering never runs.',
    repairedBy: 'specs/096-page-builder-block-ownership/ — D-31 block `load` seam',
  },
  'catalog.ProductSlider': {
    state: 'ProductSliderSkeleton',
    reason:
      'isLoading initialises true and is cleared from a useEffect that server rendering never runs.',
    repairedBy: 'specs/096-page-builder-block-ownership/ — D-31 block `load` seam',
  },
  'catalog.CategoryList': {
    state: 'CategoryListSkeleton',
    reason:
      'isLoading initialises true and is cleared from a useEffect that server rendering never runs.',
    repairedBy: 'specs/096-page-builder-block-ownership/ — D-31 block `load` seam',
  },
  'catalog.CategoryGrid': {
    state: 'CategoryGridSkeleton',
    reason:
      'isLoading initialises true and is cleared from a useEffect that server rendering never runs.',
    repairedBy: 'specs/096-page-builder-block-ownership/ — D-31 block `load` seam',
  },
};

/**
 * `POPULATION_DISAGREEMENTS` — the two authors of the block population, reconciled.
 *
 * A disagreement is the population's health rather than the floor's subject, so a ledgered one
 * is reported and does not fail. A disagreement **beyond** this ledger refuses the run: a
 * palette that silently lost half its entries must not report a clean floor.
 */
export const POPULATION_DISAGREEMENTS: Readonly<Record<string, DisagreementLedgerEntry>> = {
  // `InsertTemplate`'s entry is gone, and its going is the staleness signal this
  // ledger's own note predicted: it was registered in the components map and
  // named by no drawer category, so an editor could not insert it, and
  // `specs/096-page-builder-block-ownership/` filed it as its D-b and repaired
  // it — `cms` declares `cms.InsertTemplate` in the `embeds` section.
  MissingComponentPlaceholder: {
    kind: 'unregistered-block',
    reason:
      'The degradation placeholder itself, and never a block: `data-model.md` §8 names it as one of the things that is not one. It is `ComponentConfig`-shaped, so the second author claims it, and it is deliberately in no palette — `makeMissingComponentConfig` builds it per unknown name at the point of failure.',
    repairedBy: 'never — it is not a block, and an entry saying so is the record',
  },
};
