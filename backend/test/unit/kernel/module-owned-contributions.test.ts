import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Descriptors are contributed by the module that owns them (feature 072, T143a).
 *
 * A composition root that pushes a module's descriptor into another module's
 * registry produces a contribution **nothing can switch off**: only a module's
 * own registration passes through the lifecycle seams, so the root's call keeps
 * the descriptor live with its module disabled. That is a Constitution XVII
 * hole, not untidiness, and it is invisible at the call site — the root's line
 * reads exactly like the module's would.
 *
 * Three clusters are pinned here. The first two are of the "push at boot"
 * shape: a module contributing a descriptor to a registry another module
 * enumerates.
 *
 *  - the four `configurationTypeRegistry` registrations (`credentials`' own two,
 *    plus `pim_ergonode`'s and `product_feeds`');
 *  - the four asset / CMS reference cross-registrations (`catalog`, `cms` and
 *    `megamenu` into `assets_library`' registry, `megamenu` into `cms`');
 *  - cluster 6, below: six pieces of module-owned machinery a root still
 *    *constructed* rather than merely registered. Same hole, one step larger —
 *    the root's instance is not gated by anything, so it kept answering with
 *    its module switched off.
 *
 * Source-level assertions, for the reason `harness-parity.test.ts` gives: the
 * property is a property of the *wiring*, and booting both roots to compare
 * them would cost two compositions per run. The behaviour each contribution
 * buys is covered where it belongs — `test/contract/credentials/*`,
 * `test/integration/assets_library/*`.
 */

const backendRoot = fileURLToPath(new URL('../../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${backendRoot}${relative}`, 'utf8');
}

/**
 * Whitespace-insensitive, because the formatter decides whether a call fits on
 * one line and a test that pins the wrapping would fail on a reformat rather
 * than on a wiring change.
 */
function flat(source: string): string {
  // The trailing comma goes with the wrapping: the formatter adds one exactly
  // when it breaks the argument list across lines.
  return source.replace(/\s+/g, '').replace(/,\)/g, ')');
}

const ROOTS: Readonly<Record<string, string>> = {
  production: read('src/composition.ts'),
  harness: read('test/helpers/test-server.ts'),
};

/** Contribution → the module whose `backend.ts` must make it. */
const CONTRIBUTIONS: ReadonlyArray<{
  readonly call: string;
  readonly owner: string;
}> = [
  { call: 'register(llmConfigurationType)', owner: 'credentials' },
  { call: 'register(emailAdapterConfigurationType)', owner: 'credentials' },
  { call: 'register(ergonodeConfigurationType)', owner: 'pim_ergonode' },
  { call: 'register(feedDeliveryConfigurationType)', owner: 'product_feeds' },
  { call: 'registerCatalogAssetReferences(', owner: 'catalog' },
  { call: 'registerCmsAssetReferences(', owner: 'cms' },
  { call: 'registerMegamenuAssetReferences(', owner: 'megamenu' },
  { call: 'registerMegamenuCmsReferences(', owner: 'megamenu' },
  // Cluster 6. The four built-in payment adapters live in `payments`, and the
  // registry that holds them is `payment_methods`'. Both roots seeded one
  // module's descriptors into the other's table, which is the same push-at-boot
  // shape as the four above.
  { call: 'builtInPaymentAdapters()', owner: 'payments' },
];

/**
 * Cluster 6 — module-owned machinery a composition root **constructed**.
 *
 * A step beyond a cross-registration: a root that builds a module's service
 * holds an instance no lifecycle seam covers, so it answers with the module
 * switched off, and — where the module builds its own too — the platform runs
 * two of them, free to disagree. Both failures were found in this cluster: the
 * root's `SearchIndexer` was a second copy of the one `searchModule` already
 * builds, and `SalesRepAssignmentService` existed once per root with *different*
 * constructor arguments.
 */
const CLUSTER_SIX: ReadonlyArray<{
  readonly what: string;
  readonly owner: string;
  /** Proof the owning module makes it: must appear in that module's `backend.ts`. */
  readonly inBackend: string;
  /** Proof no root makes it: must appear in neither composition root. */
  readonly notInRoot: string;
}> = [
  {
    what: 'the full Meilisearch reindex',
    owner: 'search',
    inBackend: "providePort('searchReindexPort'",
    notInRoot: 'new SearchIndexer(',
  },
  {
    what: 'the webhook delivery worker',
    owner: 'webhooks',
    inBackend: 'ctx.worker(',
    notInRoot: 'createWebhookWorker(',
  },
  {
    what: 'the pricing cache TTL',
    owner: 'price_lists',
    inBackend: 'DEFAULT_PRICING_CACHE_TTL_MS',
    // The assignment rather than the constant: a root writing `0` is a real
    // composition decision (the harness's), and a root handing the module back
    // its own default is the residue.
    notInRoot: 'priceListsPricingCacheTtlMs: DEFAULT_PRICING_CACHE_TTL_MS',
  },
  {
    what: 'the sales-rep assignment scope',
    owner: 'organizations',
    inBackend: 'new SalesRepAssignmentService(',
    notInRoot: 'new SalesRepAssignmentService(',
  },
  {
    what: 'social-login account creation',
    owner: 'customer_accounts',
    inBackend: 'create(CustomerAccount',
    notInRoot: 'create(CustomerAccount',
  },
];

describe('T143a — module-owned descriptors are contributed by their module', () => {
  it.each(CONTRIBUTIONS)('$owner makes the $call contribution itself', ({ call, owner }) => {
    expect(flat(read(`src/modules/${owner}/backend.ts`))).toContain(flat(call));
  });

  it.each(CONTRIBUTIONS)('no composition root makes the $call contribution', ({ call }) => {
    for (const [label, source] of Object.entries(ROOTS)) {
      expect(flat(source).includes(flat(call)), `${label} still contributes ${call}`).toBe(false);
    }
  });

  it('every contribution is pushed from a boot hook, not a registration', () => {
    // Registration declares; it never resolves. These four registries are
    // *read* by their host — the credentials type catalogue on every admin
    // request, the reference registries on every delete — so a contributor
    // pushes from `ctx.onBoot`, which runs after every module has registered
    // and before any request is served.
    for (const owner of new Set(CONTRIBUTIONS.map((entry) => entry.owner))) {
      expect(read(`src/modules/${owner}/backend.ts`)).toContain('ctx.onBoot(');
    }
  });
});

describe('T143a cluster 6 — module-owned machinery is built by its module', () => {
  it.each(CLUSTER_SIX)('$owner builds $what itself', ({ owner, inBackend }) => {
    expect(flat(read(`src/modules/${owner}/backend.ts`))).toContain(flat(inBackend));
  });

  it.each(CLUSTER_SIX)('no composition root builds $what', ({ what, notInRoot }) => {
    for (const [label, source] of Object.entries(ROOTS)) {
      expect(flat(source).includes(flat(notInRoot)), `${label} still builds ${what}`).toBe(false);
    }
  });
});
