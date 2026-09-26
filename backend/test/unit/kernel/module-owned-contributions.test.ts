import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

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
 *  - the five `configurationTypeRegistry` registrations (`credentials`' own two,
 *    plus `pim_ergonode`'s, `pim_akeneo`'s and `product_feeds`');
 *  - the four asset / CMS reference cross-registrations (`catalog`, `cms` and
 *    `megamenu` into `assets_library`' registry, `megamenu` into `cms`');
 *  - cluster 6, below: six pieces of module-owned machinery a root still
 *    *constructed* rather than merely registered. Same hole, one step larger —
 *    the root's instance is not gated by anything, so it kept answering with
 *    its module switched off.
 *
 * **Where a module keeps its `registerModule` is resolved, never spelled**
 * (feature 080, T040b). The three assertions over `CONTRIBUTIONS` and
 * `CLUSTER_SIX` read `src/modules/<owner>/backend.ts` literally, so the first
 * of those owners to become a package took them out with `ENOENT` — loud, but
 * it is the same derived-fact-written-down shape as `moduleFiles()` below, and
 * the loudness is an accident of `readFileSync`: a reader that answered `''`
 * would have passed. They go through `backendSourceOf`, which throws on a
 * module it cannot place.
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
    // The name and not the call's spelling: it was
    // `providePort('searchReindexPort'` until `specs/117-instance-bring-up/`
    // Phase 6 published `SearchReindexPort` and the registration took the type
    // argument its `searchQueryPort` sibling already carried. The claim here is
    // that the **module** provides the name; whether the call names its type is
    // `check:port-shape`'s question, and pinning the spelling reds this file
    // for a repair it has no opinion about.
    inBackend: "'searchReindexPort'",
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
    expect(flat(backendSourceOf(owner))).toContain(flat(call));
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
      expect(backendSourceOf(owner)).toContain('ctx.onBoot(');
    }
  });
});

describe('T143a cluster 6 — module-owned machinery is built by its module', () => {
  it.each(CLUSTER_SIX)('$owner builds $what itself', ({ owner, inBackend }) => {
    expect(flat(backendSourceOf(owner))).toContain(flat(inBackend));
  });

  it.each(CLUSTER_SIX)('no composition root builds $what', ({ what, notInRoot }) => {
    for (const [label, source] of Object.entries(ROOTS)) {
      expect(flat(source).includes(flat(notInRoot)), `${label} still builds ${what}`).toBe(false);
    }
  });
});

/**
 * Issue #108 — the rule cluster 6 wrote for the two composition roots holds for
 * **other modules** too, and that is where it was being broken.
 *
 * Cluster 6 stopped the roots from building `SalesRepAssignmentService`, and
 * left three modules building it: `organizations` (its owner), `quote_requests`
 * and `customers`. `customers`' copy omitted the class's optional third
 * argument — the feature-056 subtree deps — so every staff-authority decision
 * silently reverted to the flat pre-056 rule. Nothing could catch that: the
 * argument is optional, so `tsc` is content, and a flat scope returns plausible
 * answers, so the route tests were content too.
 *
 * The scope is a port now. This is the assertion that keeps it one.
 */
/**
 * Where a module's sources are, derived rather than spelled (feature 080, T040a).
 *
 * This used to be `backendRoot + 'src/modules'`, and both assertions below read
 * it. That is issue #215's shape one layer in: `quote_requests` became a module
 * package (T040b), so a walk of `src/modules` stopped seeing it — the offender
 * sweep would have reported clean about a tree it no longer covered, and the
 * second assertion read a path that is not there. The layout is the same
 * derivation every check uses, so a module that moves is followed instead of
 * dropped.
 */
const layout = await requireModuleLayout('[module-owned-contributions]');

/**
 * Every module's **source**, which is deliberately not every module's `.ts`.
 *
 * A module package's harness-free tests sit beside the sources they cover
 * (feature 106), so a bare `.ts` walk reads them as well — and the offender
 * sweep below matches flattened text, comments included. `customers`'
 * `sales-rep-scope-wiring.test.ts` opens by describing the defect it pins,
 * *"the module used to construct `new SalesRepAssignmentService(...)`"*, and
 * that sentence read as a second construction of the service. The subject of
 * every assertion in this file is composition — who registers, who constructs,
 * who resolves — and a test is none of those.
 */
function moduleFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
    }
  };
  for (const root of layout.moduleWalkRoots) walk(root);
  return out;
}

/** A module's `registerModule` source, wherever the module lives. */
function backendSourceOf(moduleId: string): string {
  const dir = layout.moduleDirectoryOf(moduleId);
  if (dir === null) throw new Error(`[module-owned-contributions] no such module: ${moduleId}`);
  // Two places a module keeps it: `backend.ts` in the application's tree, and
  // `src/backend/index.ts` in a package. A module that has neither is a module
  // this assertion cannot make, so it throws rather than reading '' and passing.
  for (const candidate of [join(dir, 'backend.ts'), join(dir, 'src', 'backend', 'index.ts')]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    `[module-owned-contributions] ${moduleId} has no backend entry point under ${dir}`,
  );
}

describe('issue #108 — the sales-rep scope is built once, by organizations', () => {
  it('no module but organizations constructs SalesRepAssignmentService', () => {
    const ownerDir = layout.moduleDirectoryOf('organizations')!;
    const offenders = moduleFiles().filter(
      (file) =>
        !file.startsWith(`${ownerDir}/`) &&
        flat(readFileSync(file, 'utf8')).includes(flat('new SalesRepAssignmentService(')),
    );
    expect(offenders.map((f) => layout.displayOf(f))).toEqual([]);
  });

  it('customers and quote_requests resolve the port instead', () => {
    for (const owner of ['customers', 'quote_requests']) {
      expect(backendSourceOf(owner)).toContain("'organizationSalesRepScopePort'");
    }
  });
});
