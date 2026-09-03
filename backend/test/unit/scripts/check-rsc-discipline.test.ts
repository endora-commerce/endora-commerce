import { describe, expect, it } from 'vitest';

import {
  checkRscDiscipline,
  ledgerKey,
  shardOf,
  vacuousReason,
  type ClientFetchLedger,
  type ClientSourceFile,
  type ComposedPackage,
  type RscDisciplineFindingKind,
} from '../../../scripts/check-rsc-discipline.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';

/**
 * Companion test for `check-rsc-discipline`
 * (`specs/098-storefront-ssr-seo-a11y-suite/contracts/rsc-discipline-check.md`,
 * FR-020…FR-022).
 *
 * Every proof enters at the **top** of the analysis, as component **source
 * text** — the one input a real run reads (issue #130). The predicate is a
 * three-clause conjunction decided by a TypeScript AST walk: the `'use client'`
 * marker, a render that branches on a state variable, and a `useEffect` that
 * writes that state while calling something the file imported. A fixture
 * handing in a pre-classified component record would prove the reporter and
 * leave all three clauses unproven, which is the whole of the analysis.
 *
 * The **discrimination** proofs are asserted beside the reds and carry as much
 * weight, because a predicate that reports everything looks exactly as green as
 * a correct one on a repaired tree. `ProductCard`'s shape — a client component
 * that takes its data as a prop and holds no state — is contract §3's named
 * discrimination, and FR-022's deferred content is the second: a drawer body
 * behind `if (!isOpen) return null` fetches on open and is correct.
 */

const STOREFRONT: ComposedPackage = {
  name: 'storefront',
  shard: 'storefront',
  root: 'storefront',
  composed: false,
};

const CMS_COMPONENTS: ComposedPackage = {
  name: '@endora-commerce/cms-components',
  shard: 'cms-components',
  root: 'packages/cms-components/src',
  composed: true,
};

const PAGE_BUILDER_CORE: ComposedPackage = {
  name: '@endora-commerce/page-builder-core',
  shard: 'page-builder-core',
  root: 'packages/page-builder-core/src',
  composed: true,
};

const PACKAGES: readonly ComposedPackage[] = [STOREFRONT, CMS_COMPONENTS, PAGE_BUILDER_CORE];

function file(path: string, text: string): ClientSourceFile {
  return { path, text };
}

/**
 * The shape contract §3 works through, reduced to its three clauses and
 * nothing else. It is `ProductGrid.tsx`'s: `isLoading` initialises `true`, an
 * effect calls an imported fetch helper and clears it, and the render returns a
 * skeleton while it is set.
 */
const PRODUCT_GRID = `'use client';
import { useEffect, useState } from 'react';
import { fetchProductsList } from '../utils/catalog-fetch.js';
import { ProductGridSkeleton } from './catalog/CatalogSkeletons.js';

export function ProductGrid({ limit }: { limit: number }) {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const list = await fetchProductsList({ limit });
      setProducts(list);
      setIsLoading(false);
    })();
  }, [limit]);

  if (isLoading) {
    return <ProductGridSkeleton count={limit} />;
  }
  return <ul>{products.map((p) => <li key={p.slug}>{p.name}</li>)}</ul>;
}
`;

/**
 * Contract §3's discrimination. It fails clauses 1 and 3 — no state, no effect,
 * the product arrives as a prop — and it is a `'use client'` file in the same
 * package as the defect, so a predicate keyed on the directory or the marker
 * alone reports it.
 */
const PRODUCT_CARD = `'use client';
import { BoxStyled } from './box-styles.js';

export function ProductCard({ product }: { product: CmsProductSummary }) {
  if (!product.price) return null;
  return <BoxStyled><span>{product.name}</span></BoxStyled>;
}
`;

/** FR-022: a body reachable only after an interaction. */
const DEFERRED_DRAWER = `'use client';
import { useEffect, useState } from 'react';
import { fetchCart } from '../lib/cart.js';

export function CartDrawer({ isOpen }: { isOpen: boolean }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    void (async () => setLines(await fetchCart()))();
  }, [isOpen]);

  if (!isOpen) return null;
  if (lines.length === 0) return <p>Your cart is empty</p>;
  return <ul>{lines.map((l) => <li key={l.id}>{l.name}</li>)}</ul>;
}
`;

/**
 * The same drawer, with an openness gate whose initial value the analysis
 * cannot decide. It is reported rather than excused: an undecidable gate taken
 * for "deferred" excuses everything (contract §3, FR-022).
 */
const UNDECIDABLE_DRAWER = `'use client';
import { useEffect, useState } from 'react';
import { fetchCart } from '../lib/cart.js';
import { initialDrawerState } from '../lib/drawer.js';

export function CartDrawer() {
  const [isOpen] = useState(initialDrawerState());
  const [lines, setLines] = useState([]);

  useEffect(() => {
    void (async () => setLines(await fetchCart()))();
  }, []);

  if (!isOpen) return null;
  if (lines.length === 0) return <p>Your cart is empty</p>;
  return <ul>{lines.map((l) => <li key={l.id}>{l.name}</li>)}</ul>;
}
`;

const GRID_PATH = 'packages/cms-components/src/components/ProductGrid.tsx';
const CARD_PATH = 'packages/cms-components/src/components/ProductCard.tsx';
const DRAWER_PATH = 'storefront/components/CartDrawer.tsx';

/** A ledger that records nothing, so every finding of a run is visible. */
const EMPTY_LEDGER: ClientFetchLedger = {};

function findingsOf(
  files: readonly ClientSourceFile[],
  kind: RscDisciplineFindingKind,
  ledger: ClientFetchLedger = EMPTY_LEDGER,
): readonly string[] {
  return checkRscDiscipline({ files, composedPackages: PACKAGES, ledger })
    .findings.filter((finding) => finding.kind === kind)
    .map((finding) => `${finding.path}#${finding.state ?? ''}`);
}

describe('check-rsc-discipline — the predicate', () => {
  it('reports a client component whose first-paint render is gated on state an effect fetches', () => {
    expect(findingsOf([file(GRID_PATH, PRODUCT_GRID)], 'client-fetch-on-first-paint')).toEqual([
      `${GRID_PATH}#isLoading`,
      `${GRID_PATH}#products`,
    ]);
  });

  // The discrimination. Without it the predicate can be trivially over-broad —
  // "a `'use client'` file in a package the storefront composes" — and still
  // look green on a repaired tree.
  it('does not report a client component that takes its content as a prop', () => {
    const result = checkRscDiscipline({
      files: [file(CARD_PATH, PRODUCT_CARD)],
      composedPackages: PACKAGES,
      ledger: EMPTY_LEDGER,
    });
    expect(result.findings).toEqual([]);
    // ...and it *was* judged: the file is in the population and was read as a
    // client component, so the empty finding list is a verdict rather than a
    // file the walk skipped.
    expect(result.clientFiles).toEqual([CARD_PATH]);
  });

  // Both shapes in one run, which is the state of the real tree: a predicate
  // narrow enough to clear the card and wide enough to catch the grid.
  it('separates the two shapes in one run', () => {
    const result = checkRscDiscipline({
      files: [file(GRID_PATH, PRODUCT_GRID), file(CARD_PATH, PRODUCT_CARD)],
      composedPackages: PACKAGES,
      ledger: EMPTY_LEDGER,
    });
    expect([...new Set(result.findings.map((finding) => finding.path))]).toEqual([GRID_PATH]);
  });

  it('does not report a server component that fetches, marker absent', () => {
    expect(
      findingsOf(
        [file(GRID_PATH, PRODUCT_GRID.replace("'use client';\n", ''))],
        'client-fetch-on-first-paint',
      ),
    ).toEqual([]);
  });

  it('does not report a client component whose effect writes no state the render branches on', () => {
    const tracker = `'use client';
import { useEffect, useState } from 'react';
import { reportPageView } from '../lib/analytics.js';

export function PageViewTracker({ path }: { path: string }) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    void reportPageView(path).then(() => setSent(true));
  }, [path]);
  return <span data-sent={sent} />;
}
`;
    expect(
      findingsOf([file('storefront/components/PageViewTracker.tsx', tracker)], 'client-fetch-on-first-paint'),
    ).toEqual([]);
  });

  it('does not report a render gate whose state no effect writes', () => {
    const toggle = `'use client';
import { useState } from 'react';
import { Panel } from './Panel.js';

export function DetailsToggle({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);
  if (collapsed) return <button onClick={() => setCollapsed(false)}>Show</button>;
  return <Panel>{children}</Panel>;
}
`;
    expect(
      findingsOf([file('storefront/components/DetailsToggle.tsx', toggle)], 'client-fetch-on-first-paint'),
    ).toEqual([]);
  });
});

describe('check-rsc-discipline — FR-022, deferred content', () => {
  it('does not report a body reachable only behind an openness prop', () => {
    expect(findingsOf([file(DRAWER_PATH, DEFERRED_DRAWER)], 'client-fetch-on-first-paint')).toEqual(
      [],
    );
  });

  it('does not report a body behind openness state that initialises falsy', () => {
    const closed = DEFERRED_DRAWER.replace(
      'export function CartDrawer({ isOpen }: { isOpen: boolean }) {',
      'export function CartDrawer() {\n  const [isOpen, setIsOpen] = useState(false);',
    );
    expect(findingsOf([file(DRAWER_PATH, closed)], 'client-fetch-on-first-paint')).toEqual([]);
  });

  // The gate is real and open on first paint, so the content behind it is
  // first-paint content whatever the binding is called.
  it('reports a body behind openness state that initialises truthy', () => {
    const open = DEFERRED_DRAWER.replace(
      'export function CartDrawer({ isOpen }: { isOpen: boolean }) {',
      'export function CartDrawer() {\n  const [isOpen, setIsOpen] = useState(true);',
    );
    expect(findingsOf([file(DRAWER_PATH, open)], 'client-fetch-on-first-paint')).toEqual([
      `${DRAWER_PATH}#lines`,
    ]);
  });

  it('reports an openness gate it cannot decide rather than excusing it', () => {
    expect(findingsOf([file(DRAWER_PATH, UNDECIDABLE_DRAWER)], 'unclassifiable-render-gate')).toEqual(
      [`${DRAWER_PATH}#lines`],
    );
  });

  // One finding per (file, state), never two: an undecidable gate is the
  // *classification* of a candidate, not a second candidate.
  it('reports an undecidable gate instead of a first-paint finding, not beside it', () => {
    expect(findingsOf([file(DRAWER_PATH, UNDECIDABLE_DRAWER)], 'client-fetch-on-first-paint')).toEqual(
      [],
    );
  });
});

describe('check-rsc-discipline — the ledger', () => {
  const ledgered: ClientFetchLedger = {
    'cms-components': {
      [ledgerKey(GRID_PATH, 'isLoading')]: {
        firstPaint: true,
        reason: 'the catalogue grid renders a skeleton to a crawler',
        retiredBy: 'specs/096-page-builder-block-ownership/ — D-31 `load` seam',
      },
      [ledgerKey(GRID_PATH, 'products')]: {
        firstPaint: true,
        reason: 'the product list itself arrives after hydration',
        retiredBy: 'specs/096-page-builder-block-ownership/ — D-31 `load` seam',
      },
    },
  };

  it('suppresses a recorded finding', () => {
    expect(findingsOf([file(GRID_PATH, PRODUCT_GRID)], 'client-fetch-on-first-paint', ledgered)).toEqual(
      [],
    );
  });

  it('fails an entry that describes no finding, as stale', () => {
    expect(findingsOf([file(CARD_PATH, PRODUCT_CARD)], 'stale-ledger-entry', ledgered)).toEqual([
      `${GRID_PATH}#isLoading`,
      `${GRID_PATH}#products`,
    ]);
  });

  it('fails an entry with no reason', () => {
    const noReason: ClientFetchLedger = {
      'cms-components': {
        ...ledgered['cms-components'],
        [ledgerKey(GRID_PATH, 'isLoading')]: {
          firstPaint: true,
          reason: '   ',
          retiredBy: 'specs/096-page-builder-block-ownership/',
        },
      },
    };
    expect(
      findingsOf([file(GRID_PATH, PRODUCT_GRID)], 'ledger-entry-without-a-reason', noReason),
    ).toEqual([`${GRID_PATH}#isLoading`]);
  });

  // T106's third direction, one contract over: a debt with no retiring
  // condition is a permanent exemption written as a temporary one.
  it('fails an entry with no retiring condition', () => {
    const noRetirement: ClientFetchLedger = {
      'cms-components': {
        ...ledgered['cms-components'],
        [ledgerKey(GRID_PATH, 'products')]: {
          firstPaint: true,
          reason: 'the product list itself arrives after hydration',
          retiredBy: '',
        },
      },
    };
    expect(
      findingsOf(
        [file(GRID_PATH, PRODUCT_GRID)],
        'ledger-entry-without-a-retiring-condition',
        noRetirement,
      ),
    ).toEqual([`${GRID_PATH}#products`]);
  });

  // The shard a finding is recorded in is derived from the file's own path
  // against the composed-package roots, so a package's entries live in that
  // package's file and a cut touches one shard.
  it('shards a finding by the package or application that owns the file', () => {
    expect(shardOf(GRID_PATH, PACKAGES)).toBe('cms-components');
    expect(shardOf(DRAWER_PATH, PACKAGES)).toBe('storefront');
    expect(shardOf('packages/page-builder-core/src/client.tsx', PACKAGES)).toBe('page-builder-core');
  });

  // Keyed `(file, state name)` and never a line: an insertion above the site
  // must not red an entry that still describes it.
  it('keys an entry on the file and the state, not on a line', () => {
    const shifted = `// a comment inserted above every site\n\n${PRODUCT_GRID}`;
    expect(findingsOf([file(GRID_PATH, shifted)], 'client-fetch-on-first-paint', ledgered)).toEqual(
      [],
    );
    expect(findingsOf([file(GRID_PATH, shifted)], 'stale-ledger-entry', ledgered)).toEqual([]);
  });
});

describe('check-rsc-discipline — the refusals', () => {
  function refusalOf(files: readonly ClientSourceFile[]): string | null {
    const result = checkRscDiscipline({
      files,
      composedPackages: PACKAGES,
      ledger: EMPTY_LEDGER,
    });
    return vacuousReason(result)?.kind ?? null;
  }

  it('refuses a walk that opened no file', () => {
    expect(refusalOf([])).toBe('no-source-file');
  });

  it('refuses a walk that found no client component', () => {
    const server = `import { fetchProducts } from '../lib/api.js';
export default async function Page() {
  const products = await fetchProducts();
  return <ul>{products.map((p) => <li key={p.slug}>{p.name}</li>)}</ul>;
}
`;
    expect(refusalOf([file('storefront/app/page.tsx', server)])).toBe('no-client-component');
  });

  // #237's shape, and the one that matters: the file count stands still while
  // the syntax walk goes blind, so a healthy `files=` prints beside a cheerful
  // `findings=0` over a tree the check is no longer reading.
  it('refuses a walk that classified no effect', () => {
    expect(refusalOf([file(CARD_PATH, PRODUCT_CARD)])).toBe('nothing-classified');
  });

  // The fourth refusal is `readSizeRefusal`'s, over the
  // `storefront-deps:<covered>/<expected>` token, so #215's predicate is
  // stated once for the estate rather than re-implemented here. A composed
  // package contributing no file at all is the case: the application's own
  // files keep `files=` respectable while a 43-file package drops out.
  it('refuses a run in which a composed package contributed no file', () => {
    const result = checkRscDiscipline({
      files: [file(DRAWER_PATH, DEFERRED_DRAWER), file(GRID_PATH, PRODUCT_GRID)],
      composedPackages: PACKAGES,
      ledger: EMPTY_LEDGER,
    });
    expect(result.packagesExpected).toBe(2);
    expect(result.packagesCovered).toBe(1);
    expect(
      readSizeRefusal({
        prefix: '[rsc-discipline]',
        files: result.filesRead.length,
        sites: result.effects,
        coverage: [
          {
            source: 'storefront-deps',
            expected: result.packagesExpected,
            covered: result.packagesCovered,
          },
        ],
      })?.kind,
    ).toBe('short-walk');
  });

  it('does not refuse a run that read the whole population', () => {
    const result = checkRscDiscipline({
      files: [
        file(DRAWER_PATH, DEFERRED_DRAWER),
        file(GRID_PATH, PRODUCT_GRID),
        file('packages/page-builder-core/src/client.tsx', PRODUCT_CARD),
      ],
      composedPackages: PACKAGES,
      ledger: EMPTY_LEDGER,
    });
    expect(vacuousReason(result)).toBeNull();
    expect(result.packagesCovered).toBe(2);
    expect(
      readSizeRefusal({
        prefix: '[rsc-discipline]',
        files: result.filesRead.length,
        sites: result.effects,
        coverage: [
          {
            source: 'storefront-deps',
            expected: result.packagesExpected,
            covered: result.packagesCovered,
          },
        ],
      }),
    ).toBeNull();
  });
});
