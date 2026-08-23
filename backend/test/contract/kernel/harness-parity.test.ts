import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
// Comments removed by the parser rather than by an ordered pair of regexes
// (issue #241). This file is where the ordered pair was wrong: block-first, a
// `//` line ending in a route glob at `test-server.ts:1544` opened a comment
// that ran 1135 lines, and `runBootHooks(`, `errorEnvelope` and
// `resolvePreferredLanguage` were all invisible to every assertion below.
// Issue #234 fixed the order; #241 removed the order from the question.
import { codeOnly } from '../../../scripts/lib/source-text.js';
import { MODULES } from '../../../src/composition.generated.js';
// D-72 point 5 — the same manifest index `check-port-dependencies` and
// `check-port-catches` read, so "which modules the platform refuses to switch
// off" has one source in the tree rather than one per consumer.
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * The two composition roots, held to each other (feature 072, US6 / T075–T076).
 *
 * The harness is not a smaller version of production — it is a **second
 * composition root**, hand-maintained, and every difference between the two is
 * a class of bug the suite structurally cannot catch. That is a worse failure
 * than a missing test, because the suite reports green while the difference
 * exists: production wires something the harness never builds, so the code path
 * that uses it is exercised in a shape no deployment runs.
 *
 * Two properties are pinned here, and neither is "the harness is correct":
 *
 *  1. **A converted module costs no test-helper edit** (T075). The whole point
 *     of the generated composer is that adding a module is adding a file. If
 *     the harness has to be taught about each one, the sweep pays the cost 66
 *     times and the next contributor pays it again.
 *  2. **The drift is an exact ledger** (T076). Every construct production
 *     builds and the harness does not is listed below with what it costs. An
 *     entry going stale is a failure, and so is a new one appearing — the point
 *     is that the list can only be changed deliberately.
 *
 * Source-level assertions, deliberately. Booting both roots to compare them
 * would cost two compositions per run, and the property being checked is a
 * property of the *wiring*, which is what the source is.
 */

const backendSrc = fileURLToPath(new URL('../../../src/', import.meta.url));
const harnessPath = fileURLToPath(new URL('../../helpers/test-server.ts', import.meta.url));

const harness = readFileSync(harnessPath, 'utf8');
const production = readFileSync(`${backendSrc}composition.ts`, 'utf8');

/** `new Foo(` occurrences, which is how both roots build everything hand-wired. */
function constructedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bnew ([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    names.add(match[1] as string);
  }
  return names;
}

/** `fooModule(` calls — the hand-wired module factories. */
function moduleFactories(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\b([a-z][A-Za-z0-9_]*Module)\s*\(/g)) {
    names.add(match[1] as string);
  }
  return names;
}

describe('T075 — a converted module costs no test-helper edit', () => {
  it('the harness names no module from the generated composer', () => {
    // A module that has converted declares itself through `registerModule`, and
    // both roots reach it the same way: `composeModules(MODULES)`. If its id or
    // its plugin path still appears in the harness, something is wiring it
    // twice — which is the drift this feature exists to end, reintroduced one
    // module at a time.
    const named = MODULES.filter(
      (entry) =>
        harness.includes(`modules/${entry.id}/plugin.js`) ||
        harness.includes(`modules/${entry.id}/plugin.ts`),
    ).map((entry) => entry.id);

    expect(named).toEqual([]);
  });

  it('both roots compose the whole generated list, unfiltered', () => {
    // D-45 deleted `composition-passes.ts`: there is one pass, so a root that
    // wants to name a subset has to write the filter itself — and this is where
    // that shows up.
    //
    // The spelling is pinned including both **appends**: D-104's, a
    // deployment's overlay modules discovered at runtime, and T031's, the
    // instance's installed packages. Both go into this same single call, after
    // the frozen core list, which is what makes "overlay last, so a
    // deployment's decoration wins" structural rather than a property of a
    // generator's sort. Extending the array is allowed and must be spelled
    // identically in both roots; narrowing it is what this refuses, and any
    // `MODULES.filter(` would fail the exact-match below.
    //
    // The **array literal** is pinned rather than the whole call, because the
    // call is now long enough that the formatter wraps it and a pin including
    // `, {` would be a pin on prettier's line-breaking rather than on the two
    // roots agreeing.
    for (const source of [harness, production]) {
      expect(source).toContain(
        'composeModules(\n    [...MODULES, ...overlayModuleEntries, ...packageModuleEntries],',
      );
      expect(source).not.toContain('MODULES.filter(');
      expect(source).not.toContain('MODULES.slice(');
    }
  });

  it('every generated entry is composed exactly once', () => {
    // `composeModules` is called once in each root, and never a second time
    // with a hand-picked subset, which is how a root would start choosing its
    // own module set again.
    for (const source of [harness, production]) {
      const calls = [...source.matchAll(/\bcomposeModules\s*\(/g)].length;
      expect(calls).toBe(1);
    }
  });

  it('each root contributes through the window method, not by hand', () => {
    // Issue #52 — D-45's contribution slot used to be a convention: a root
    // wrote `registerValues(container, …)` and had to have written it in the
    // right place. `composedModules.contribute(…)` *is* the slot, so the two
    // roots cannot spell it differently and a contribution cannot land after
    // the boot phase without throwing.
    for (const source of [harness, production]) {
      expect(source).toContain('composedModules.contribute(');
    }
  });

  it('neither root writes the container by hand once the modules have composed', () => {
    // The half a method alone cannot enforce: `registerValues(container, …)`
    // still works after `composeModules` and silently reopens the window. It is
    // legal *above* the call — that is where a host value no module defaults is
    // registered — so this is a position check, not a ban.
    for (const [root, source] of [
      ['harness', harness],
      ['production', production],
    ] as const) {
      const composeAt = source.indexOf('= composeModules(');
      expect(composeAt, `${root} composes no modules`).toBeGreaterThan(0);
      const afterCompose = source.slice(composeAt);
      const byHand = [...afterCompose.matchAll(/registerValues\(container, /g)].length;
      expect(byHand, `${root} registers a value by hand inside the window`).toBe(0);
    }
  });

  it('each root runs the one boot phase exactly once', () => {
    // The other half of D-45: a second `runBootHooks()` would mean a root had
    // grown a second boot phase, and with it the question of which half of the
    // root's contributions a module's hook can see.
    for (const source of [harness, production]) {
      const calls = [...source.matchAll(/\.runBootHooks\s*\(/g)].length;
      expect(calls).toBe(1);
    }
  });
});

/**
 * The drift that made issue #234 unfindable, pinned (feature 083, R10 / D-137).
 *
 * Both roots wrote their own `resolvePreferredLanguage` closure. They were not
 * the same closure: production branched on `request.actor`, the harness on
 * `request.testActor` — a difference no test could see, because both were
 * wrong the same way for every non-admin actor and the suite asserted the
 * English they produced. That is the exact failure mode this file exists for:
 * a wiring difference the suite reports green over.
 *
 * The policy is one kernel function now, and each root keeps one line — the
 * admin lookup, the only rung that reads a module's table. These two
 * assertions are what stops a second spelling of the ladder growing back.
 */
describe('083 — both roots resolve a request language through one function', () => {
  it('each root constructs the shared resolver rather than writing a ladder', () => {
    for (const [root, source] of [
      ['harness', harness],
      ['production', production],
    ] as const) {
      const calls = [...codeOnly(source).matchAll(/createRequestLanguageResolver\(/g)].length;
      expect(calls, `${root} does not construct the shared request-language resolver`).toBe(1);
    }
  });

  it('the harness reads the same actor property production does', () => {
    // `registerTestAuth` mirrors every resolved actor onto `request.actor` as
    // well as onto the harness's own decoration, so the shared resolver —
    // which reads the production property — answers correctly here too. The
    // harness-only property reappearing inside the `errorEnvelope` block means
    // the two roots have started answering different questions again.
    const code = codeOnly(harness);
    const block = code.slice(code.indexOf('errorEnvelope: {'));
    const envelopeBlock = block.slice(0, block.indexOf('\n    },'));
    expect(envelopeBlock).toContain('createRequestLanguageResolver(');
    expect(envelopeBlock).not.toContain('testActor');
  });
});

/**
 * What production builds and the harness does not — **the ledger** (T076).
 *
 * Each entry says what the gap costs, because a list of names is a list nobody
 * acts on. Removing an entry means the harness now builds it; adding one means
 * a new blind spot was accepted deliberately. Both are edits to this file, which
 * is the point.
 */
const PRODUCTION_ONLY_CONSTRUCTS: Readonly<Record<string, string>> = {
  // `MinisterstwoFinansowClient` left this ledger in T138. It was never really
  // a *root* construct — both roots built the pair of VAT clients only to hand
  // them to `organizations`. That module registers them as its own default now
  // and the harness overrides the pair through `organizationsTaxIdClients`, so
  // neither root names the class and the egress seam is declared in one place
  // instead of asserted in two.
  //
  // `ViesClient` drained in T140, exactly where the T138 note said it would.
  // `customers` was the last root-built one; the module defaults to the real
  // client and the harness contributes the fake, so neither root names the
  // class and the VAT egress seam is declared once instead of asserted twice.
  // `OpenIdOAuthProvider` left this ledger in T143c, and its entry —
  // "replaced by fakeOAuthProvider — a deliberate egress seam" — was true about
  // the seam and wrong about where it belonged. Production read `MFA_OAUTH_*`
  // and built the provider *for* `mfa`, so a root decided on the module's
  // behalf whether the module had social sign-in. The module reads its own
  // environment now and defaults to the real provider; the harness contributes
  // the fake over the same name, exactly as it does for the two VAT clients
  // (T138) and `ViesClient` (T140). The seam is declared once instead of
  // asserted in two roots, and neither root names the class.
  //
  // `SearchIndexer` left this ledger in T143a. Its entry read "built inside a
  // production-only closure; the harness builds its own through searchModule",
  // which named the defect without calling it one: production held a *second*
  // indexer, ungated, beside the one the module already built. `search` provides
  // `searchReindexPort` now, so both compositions reach one instance — the
  // harness reaching it only from the module's own route, on purpose (see the
  // note on `catalogSearchReindex` in `test-server.ts`).
  //
  // `SalesRepAssignmentService` was never on this ledger and should have been
  // watched all the same: both roots built one, with *different* constructor
  // arguments — the harness's without the subtree deps, so feature 056's
  // roll-up was exercised by nothing. It is `organizationSalesRepScopePort` now.
  StorefrontRevalidator:
    'outbound revalidation to the storefront is never exercised, so a broken ' +
    'revalidation payload cannot fail the suite',
  // `WarehouseChannelReconciler` left this ledger in T143a, and its entry is
  // the clearest example of what the ledger is for. It read "the boot-time
  // reconciler never runs in tests, so a warehouse/channel drift it would
  // repair is invisible" — an accepted blind spot in a repair that exists
  // because migration 030 seeds the Default warehouse before the system
  // channel exists. It is `inventory`'s `ctx.onBoot` now, so it runs in both
  // compositions, and it stops running when that module is switched off, which
  // the root's call never did.
};

/**
 * Module factories production composes and the harness does not.
 *
 * Empty since feature 072 wave 3 (T128/T130/T134/T135). The four payment
 * gateways were the entire list, recorded as "no payment provider composes in
 * tests" — which is exactly the shape a conversion removes: each module
 * registers itself now, so both compositions get it from the same generated
 * list and neither root can forget one.
 */
const PRODUCTION_ONLY_MODULES: Readonly<Record<string, string>> = {};

describe('T076 — the drift between the roots is an exact ledger', () => {
  it('lists every construct production builds and the harness does not', () => {
    const missing = [...constructedNames(production)]
      .filter((name) => !constructedNames(harness).has(name))
      .sort();

    expect(missing).toEqual(Object.keys(PRODUCTION_ONLY_CONSTRUCTS).sort());
  });

  it('lists every module factory production composes and the harness does not', () => {
    const missing = [...moduleFactories(production)]
      .filter((name) => !moduleFactories(harness).has(name))
      .sort();

    expect(missing).toEqual(Object.keys(PRODUCTION_ONLY_MODULES).sort());
  });

  /**
   * Boot steps production performs and the harness does not — D-101's own entry.
   *
   * The other two ledgers above are computed from `new X(` and `xModule(`, so a
   * divergence that is neither cannot appear in them. This one is: production
   * calls `loadModulePresence()` before the first module registers, and the
   * harness seeds the registry cache directly instead. That is a deliberate
   * decision recorded in `test-server.ts` — the harness has no database state to
   * reconcile and wants the two axes set by hand — and it has a consequence that
   * has to be written down rather than discovered: **every refusal, reconcile
   * and derivation inside that boot step is exercised by nothing in the suite.**
   *
   * D-101's boot refusal is the newest thing behind it, which is exactly why the
   * decision put the analysis in a pure function (`assertLockedModulesPresent`)
   * and left only the call in the boot step. `test/unit/_lifecycle/locked-modules-present.test.ts`
   * is its proof, and it runs because it needs no composition at all.
   */
  const PRODUCTION_ONLY_BOOT_STEPS: Readonly<Record<string, string>> = {
    loadModulePresence:
      'The harness seeds the registry cache by hand, so the reconciler, the gating-graph ' +
      'install and D-101’s two refusals never run in a test composition. Each is proved by a ' +
      'unit test over its pure half instead; a boot-level assertion here would be green for ' +
      'the wrong reason. It drains when the harness composes presence the way production ' +
      'does, which is T073’s open half.',
  };

  it('lists every boot step production runs and the harness does not', () => {
    // Comments are stripped first, and that is not a detail: `test-server.ts`
    // *names* `loadModulePresence()` in the comment explaining why it seeds the
    // cache instead of calling it. A ledger that read the mention as a call
    // would report the divergence closed by the very sentence documenting it.
    const productionCode = codeOnly(production);
    const harnessCode = codeOnly(harness);
    for (const [step, cost] of Object.entries(PRODUCTION_ONLY_BOOT_STEPS)) {
      expect(productionCode, `production does not run ${step}`).toContain(`${step}(`);
      expect(harnessCode, `the harness runs ${step} after all — remove the entry`).not.toContain(
        `${step}(`,
      );
      expect(cost.length, `${step} has no recorded cost`).toBeGreaterThan(20);
    }
  });

  it('every ledger entry carries what the gap costs, not just a name', () => {
    // A ledger of bare names is a list nobody acts on, and this one exists to
    // be acted on: each line is either closed or justified.
    for (const [name, reason] of Object.entries({
      ...PRODUCTION_ONLY_CONSTRUCTS,
      ...PRODUCTION_ONLY_MODULES,
    })) {
      expect(reason.length, `${name} has no recorded cost`).toBeGreaterThan(20);
    }
  });
});

/**
 * The per-composition resource ceiling.
 *
 * Everything one composition holds is multiplied by the number of compositions
 * a run performs, and that number is **555** — one per test file that calls
 * `setupBackendServer`. A second Redis client is not "one more client", it is
 * 555 more; a connection pool with four extra connections is 2220. That
 * multiplier is why the root container cannot be installed as the process root
 * yet, and it is measured rather than assumed.
 */
const REDIS_CLIENTS_PER_COMPOSITION = 2;

/**
 * Subscribing costs about **10 MB per composition** — measured, not estimated:
 * arming it in every composition added ~1 GB to the suite's live set (1224 MB →
 * 2231 MB at the same point in the run) and turned the full run into a heap OOM
 * at file 182 of 940. The client is constructed everywhere, because that is
 * cheap and matches production's shape; the *subscription* is opt-in.
 */
const PUBSUB_IS_OPT_IN = true;
const ORM_INSTANCES_PER_COMPOSITION = 1;

describe('T076 — what one composition costs, before the 555× multiplier', () => {
  it('constructs the same two Redis clients production does, and no more', () => {
    // Two, not one: ioredis refuses ordinary commands on a subscribed client,
    // so the pub/sub path needs its own connection (T073). Both are
    // disconnected in `teardownBackendServer` — the number that matters is
    // concurrent connections, and files run sequentially under `singleFork`.
    const clients = [...harness.matchAll(/\bnew Redis\s*\(/g)].length;
    expect(clients).toBe(REDIS_CLIENTS_PER_COMPOSITION);
    expect([...production.matchAll(/\bnew Redis\s*\(/g)].length).toBe(
      REDIS_CLIENTS_PER_COMPOSITION,
    );
  });

  it('arms the subscription only where a test asks for it', () => {
    expect(PUBSUB_IS_OPT_IN).toBe(true);
    // **No** subscribing site is left in the harness, and that is the stronger
    // form of the property rather than a weakening of it.
    //
    // The custom-field cache moved into `custom_fields`' own `onBoot` when the
    // module was converted (feature 072, T087), which is where it belongs and
    // which is also why the guard could not follow it: a module must not know
    // it is being composed by a test harness. So the guard moved to the *input*
    // instead — the harness registers the real `redisSubscriber` only under
    // `exercisePubSub` and an inert stand-in otherwise, and the module arms
    // whichever it is handed.
    //
    // The one site that remained was the module-state channel, which dropped
    // the permission catalogue's memo. Issue #213 deleted the memo (and the
    // matching listener in `composition.ts`), so both roots subscribe to that
    // channel in exactly one place now — `registryCache.watch()`, which the
    // harness deliberately does not arm because it never populates
    // `module_registrations`.
    //
    // Two occurrences left: the registration ternary and the handle flag that
    // tells teardown whether there is anything to unsubscribe from. The flag
    // exists because `unsubscribe()` on a client that never subscribed rejects
    // asynchronously from ioredis's socket close handler, where no `try` can
    // reach it.
    const guards = [...harness.matchAll(/options\.exercisePubSub === true/g)].length;
    const subscribes = [...harness.matchAll(/\.(subscribe|start)\(redisSubscriber|redisSubscriber\.subscribe\(/g)]
      .length;
    expect(guards).toBe(2);
    expect(subscribes).toBe(0);
  });

  it('unsubscribes and drops listeners before disconnecting', () => {
    // Disconnecting a subscribed client keeps its subscription set, and ioredis
    // re-establishes it on any reconnect — one armed subscription per
    // composition is how ~1 GB of retention accumulated.
    expect(harness).toContain("removeAllListeners('message')");
    expect(harness).toContain('unsubscribe()');
  });

  it('disconnects every client it opens', () => {
    // A leaked client is not one leaked client; it is 555.
    expect(harness).toContain('h.redis.disconnect()');
    expect(harness).toContain('h.redisSubscriber.disconnect()');
  });

  it('initialises one ORM per composition', () => {
    const orms = [...harness.matchAll(/MikroORM\.init\s*\(/g)].length;
    expect(orms).toBeLessThanOrEqual(ORM_INSTANCES_PER_COMPOSITION);
  });

  it('states the multiplier next to the ceiling, so a change is costed', () => {
    // Not a behavioural assertion — a refusal to let these numbers move
    // without the reader meeting the number they are multiplied by.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).toContain('555');
  });
});

/* -------------------------------------------------------------------------- *
 * T143c — what a root still knows about a module, as a draining ledger.
 * -------------------------------------------------------------------------- */

/** The two roots, named the way the ledger and the failure messages name them. */
type RootName = 'production' | 'harness';

const ROOT_SOURCES: ReadonlyArray<readonly [RootName, string]> = [
  ['production', production],
  ['harness', harness],
];

/**
 * One binding a root imports **as a value** from `src/modules/**`.
 *
 * A *value* import is a root reaching into a module's implementation; a
 * type-only import is a root typing a contribution it makes, and is not
 * measured (restated SC-001 / SC-006). The two look alike at a glance —
 * `import type { X }`, `import { type X }` and `import { X }` where `X` is only
 * ever used in a type position all read the same in a diff — so this is parsed
 * rather than grepped.
 */
interface RootModuleImport {
  /** The module that owns the imported file, as its `src/modules/<id>` folder. */
  readonly owner: string;
  /** The roots that hold it. An asymmetry between them is itself a finding. */
  readonly roots: ReadonlyArray<RootName>;
  /**
   * Why the root still names it **and what has to happen for it to drain**.
   *
   * A reason that only restates the import ("the root needs it") is worthless:
   * every entry here is needed, or it would not compile. The reason has to name
   * the seam that does not exist yet, because that is the next piece of work.
   *
   * A `permanent` entry is the exception and is held to the opposite rule: it
   * must name **no** exit, because a permanent entry carrying one is what makes
   * the next sweep try to drain it.
   */
  readonly reason: string;
  /**
   * Whether this entry's owner declares `activation.nonDeactivatable` — D-72
   * point 5, and **derived on every run** rather than believed.
   *
   * The ledger makes two claims about every entry, and the locks answered only
   * one of them. The presence claim ("a root-built instance keeps answering
   * after an operator switches its module off") is unreachable for a locked
   * owner; the Principle I / D-52-D-53 claim ("a root that names a module's
   * internals is a root that has to be edited when that module changes") is
   * untouched by any lock and is what the entry then rests on. Writing that
   * distinction into fifteen reasons would go stale the first time somebody
   * un-locks a module — three reasons were arguing the void claim when this
   * flag was added — so it is asserted against `DISCOVERED_MANIFESTS` instead.
   * Un-lock an owner and every entry resting on it re-reds in the same run,
   * with no sweep and no memory. That is D-63's property, one file over.
   */
  readonly ownerLocked?: boolean;
  /**
   * This entry has no exit and is not waiting for one (D-72 point 1).
   *
   * A permanent entry is **excluded from the ceiling arithmetic** below, so the
   * residue means "what is still to drain" rather than "what is left" — a
   * permanent entry sitting inside a ceiling that may only be lowered is
   * exactly what makes a ledger read as stalled when it is not.
   */
  readonly permanent?: boolean;
}

/**
 * **The ledger** (T143c), and the only thing that detects a new root→module
 * value import.
 *
 * The criterion the restated SC-001 and SC-006 set is **≤ 10 import
 * declarations from `src/modules/**` per root, and zero module-owned services
 * constructed**, deliberately one threshold for both roots: a second number for
 * the harness would licence exactly the root-to-root drift this file exists to
 * close. The construction half is met and asserted below. The import half is
 * **not**, and the ceilings below record the honest residue rather than the
 * target, so that a regression fails today instead of at the moment somebody
 * finally reaches 10.
 *
 * Keyed `<owner>:<binding>` — finer than the declaration it arrives in, because
 * a declaration drains one binding at a time and a per-declaration key would
 * hide the last two names of a three-name import.
 */
const ROOT_MODULE_VALUE_IMPORTS: Readonly<Record<string, RootModuleImport>> = {
  '_i18n:ERROR_TRANSLATION_KEYS': {
    owner: '_i18n',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'D-54 moved this map out of `src/http` and into both roots on purpose: a platform peer ' +
      'may not name a module, a root may. It drains when the error-code→translation-key ' +
      'mapping is declared beside the codes in `@endora-commerce/contracts`, which is where the codes ' +
      'already live, rather than in the module that renders them.',
  },
  '_lifecycle:REGISTERED_MANIFESTS': {
    owner: '_lifecycle',
    roots: ['harness'],
    ownerLocked: true,
    reason:
      'The generated core manifest registry. Which modules a deployment ships is a root input, ' +
      'so the read is right and its location is not: the file is generated by ' +
      '`composer:generate` into a module folder. It drains when the generator emits it beside ' +
      '`composition.generated.ts`, which is D-37 A2 work (F2). ' +
      'Harness-only since feature 080 T046: production had exactly one use left — the boot ' +
      'settings reconcile — and it was the wrong value, so it now reads the resolved set ' +
      'narrowed by `deploymentShippedEntries` below. The harness keeps this one for the static ' +
      'registry it hands `_i18n` (issue #158), which is a different question and drains with ' +
      'the same D-37 A2 relocation.',
  },
  '_lifecycle:deploymentShippedEntries': {
    owner: '_lifecycle',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Feature 080 (T046) — core plus this deployment\'s overlay, never an installed package: ' +
      'the population of the boot settings reconcile, and the same function `loadModulePresence` ' +
      'narrows its first-boot insert with (D-157.6(b)). Both roots read it, and both must: an ' +
      'overlay module is converged at boot and never installed, so this reconcile is the only ' +
      'author its activation Setting can have (Principle XVII), while a package has exactly one ' +
      'author, `install`. It reads `RegisteredManifestEntry.origin`, which each discovery sets ' +
      'where the entry is built, and a root cannot re-derive it without writing a derived fact ' +
      'down twice (D-100). It was a containment test on `filePath` until feature 080 T040b, ' +
      'and no containment test can answer: a workspace module package and an installed one are ' +
      'the same directory shape, and in a deployed build both sit under `node_modules`. ' +
      'It drains with the same D-37 A2 relocation as the entries above.',
  },
  '_lifecycle:resolvedManifestEntries': {
    owner: '_lifecycle',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'The **deployment-resolved** manifest set — the core registry plus the overlay modules ' +
      'this deployment ships (D-104). Same standing as `REGISTERED_MANIFESTS` directly above, ' +
      'and it drains with it: which modules a deployment ships is a root input, so the read is ' +
      'right and only its location is wrong. It replaced two competing merges — this root ' +
      'assembled one from the runtime scan while the function assembled another from the ' +
      'generated index, and the one under test was not the one that ran. Held by both roots ' +
      'symmetrically, which is what lets the harness compose a deployment.',
  },
  '_lifecycle:loadModulePresence': {
    owner: '_lifecycle',
    roots: ['production'],
    ownerLocked: true,
    reason:
      'D-38 — module presence is a composition input, loaded before the first module registers. ' +
      'Correct where it is; the import drains with the D-37 A2 relocation of the orchestrator ' +
      'cluster into `src/kernel/lifecycle/` (F2). The harness seeds the registry cache by hand ' +
      'instead, which is T073’s open half.',
  },
  '_lifecycle:lifecycleModuleFromStaticEntries': {
    owner: '_lifecycle',
    roots: ['production'],
    ownerLocked: true,
    reason:
      'The orchestrator this deployment boots. Same D-37 A2 relocation as `loadModulePresence`; ' +
      'the harness boots no orchestrator, which is the asymmetry T073 records.',
  },
  '_lifecycle:buildStaticRegistry': {
    owner: '_lifecycle',
    roots: ['harness'],
    ownerLocked: true,
    reason:
      'Issue #158 — the manifest registry `_i18n` walks to reconcile every module’s translation ' +
      'bundles. The harness contributed `() => undefined` here, so `translation_bundles` was ' +
      'empty in every test and the error envelope’s whole translation path went unexercised; ' +
      'issue #65 shipped through that gap. Production reaches the same function one hop away, ' +
      'through `lifecycleModuleFromStaticEntries` directly above, so importing it **reduces** ' +
      'the divergence this file measures: the alternative is a registry hand-rolled in the ' +
      'harness, which is the shape T143c exists to refuse. It drains with the same D-37 A2 ' +
      'relocation as the three entries above, and no sooner.',
  },
  'settings:collectRegisteredSettingsManifests': {
    owner: 'settings',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Boot-time settings-manifest reconciliation, which must run before any module reads a ' +
      'setting. The reconciler is already the kernel’s; this collector walks the registered ' +
      'manifests and is the half still living in the module. It drains when it moves next to ' +
      '`kernel/settings/manifest-reconciler.ts`, whose input it builds.',
  },
  'auth:promoteAdminActor': {
    owner: 'auth',
    roots: ['production'],
    ownerLocked: true,
    reason:
      'The MFA actor bridge promotes a partially-authenticated session to an admin actor before ' +
      'asserting it is one. Owner `auth`, which owns the actor shape. It drains when `auth` ' +
      'provides actor promotion as a port; the harness resolves `request.testActor` directly and ' +
      'has nothing to promote, which is why this entry is production-only.',
  },
  'auth:verifyPassword': {
    owner: 'auth',
    roots: ['production'],
    ownerLocked: true,
    reason:
      'Step-up re-verification compares a password against a stored hash. The hasher is ' +
      '`auth`’s, but the two hashes are `admin_users`’ and `customer_accounts`’ — so the ' +
      'root reads two other modules’ password columns to use it. It drains when those two ' +
      'provide `verifyPassword(subjectId, password)`, which also takes the hash out of a root.',
  },
  'email:absolutizePublicUrl': {
    owner: 'email',
    roots: ['production'],
    ownerLocked: true,
    reason:
      'A pure function over `BACKEND_PUBLIC_URL` / `PUBLIC_API_BASE_URL` with **no consumer ' +
      'inside `email`** — the root is its only caller. It is a deployment-origin helper filed ' +
      'under the module that first needed it; it drains by moving to the platform, a relocation ' +
      'that should be done for that reason and not for this count.',
  },
  'customer_accounts:CustomerAccount': {
    owner: 'customer_accounts',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Six root bridges turn an account id into an e-mail, a role or an organization id by ' +
      'querying the entity. Each has a different answer to "what if `customer_accounts` is off" ' +
      '— the MFA bridge should refuse, an invoice e-mail address should degrade — so a single ' +
      'directory port cannot be added without deciding all six, which is why it is one cluster ' +
      'and not six one-line fixes.',
  },
  'customer_accounts:resolveCustomerRollupSubtreeIds': {
    owner: 'customer_accounts',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Feature 056 roll-up widening, called from the per-request tenant-context builder ' +
      '(`composition.ts:992`). The reason this entry used to carry — "a gated port here puts a ' +
      'module’s effective state on the path of **every** request, including the ones that must ' +
      'keep working while it is off" — was written before feature 074 and is void: ' +
      '`customer_accounts` is `nonDeactivatable`, so that gate has no state in which it says ' +
      'no and there is no request it could break. What is left is a **cost**, not a boundary: ' +
      'one more container resolution per customer request, in the hottest builder in the tree. ' +
      'That is a measurement somebody has to take, and the request scope already pays it for ' +
      'other names. It drains with that measurement, under Principle I — a root that reads a ' +
      'module’s roll-up query is a root that has to be edited when the roll-up changes.',
  },
  'admin_users:AdminUser': {
    owner: 'admin_users',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Same cluster as `customer_accounts:CustomerAccount`, admin side. The "harder ' +
      'constraint" this entry used to name — "the error envelope reads the admin’s preferred ' +
      'language on the error path, so a gated port there would make an error response fail ' +
      'when `admin_users` is off" — is void since feature 074 locked the module: the error ' +
      'path cannot meet a closed gate, because there is no state in which that gate closes. ' +
      'With all three owners of the cluster locked, the six root bridges have **one** answer ' +
      'to "what if the module is off" instead of six, so the identity/directory projection ' +
      'port stops being blocked and starts being work. It drains with that port, together ' +
      'with `admin_roles:AdminRole` and `customer_accounts:CustomerAccount`.',
  },
  'admin_roles:AdminRole': {
    owner: 'admin_roles',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'The RFQ admin-context resolver reads the acting admin’s role code to decide platform-admin ' +
      'versus sales-representative visibility. Drains with the `admin_users` directory port above, ' +
      'which is where the role has to be projected from.',
  },
  'orders:Order': {
    owner: 'orders',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'The PWA push bridge turns an order-status event into a notification title and deep link. ' +
      '`orders` provides `orderServiceAccessor`, but nothing on it answers "the business id and ' +
      'the customer of this order" without loading the aggregate; drains when it does.',
  },
  'assets_library:Asset': {
    owner: 'assets_library',
    roots: ['production', 'harness'],
    ownerLocked: true,
    reason:
      'Two bridges read asset rows for facts the service does not expose — the storage backend ' +
      'and mime type for a PDF embed, and the public/undeleted filter for a feed image set. ' +
      'This module still hands its service out through a root-registered `assetsLibraryService`, ' +
      'so the entry drains with that conversion rather than before it.',
  },
  // `catalog:catalogPromptResolverTools`, `catalog:catalogPromptMutationTools`,
  // `inventory:inventoryPromptTools` and `orders:ordersPromptTools` were here.
  // All four were the same entry: a boot-time push into `prompt_actions`'
  // registry that could not move into the contributing module without declaring
  // `prompt_actions` a dependency — the declaration that would have made an
  // optional assistant undeactivatable. D-44's `nonBindingDependencies` is that
  // declaration without the claim, so all four now push from their own module's
  // boot hook. The `orders` one also closed a parity gap on its way out: it was
  // production-only, so no test composed an order tool.
  //
  // `catalog:catalogBulkProgressResolver` was the fifth and drained under D-72
  // point 4, which is why this comment is now the whole family's. Its obstacle
  // was the one D-44 could not remove and the core-set locks did not touch:
  // `promptActionsBulkProgressResolver` was not a registry but a single name
  // `prompt_actions` defaulted, and a module may not write a name another
  // module owns. The host keeps `promptActionBulkProgressRegistry` — a table
  // keyed by contributing module, stating a skip policy — so `catalog` pushes
  // from its own boot hook with a `nonBindingDependencies` entry, and neither
  // root names `catalog/prompt-tools.js`. Production 15 → 14, harness 10 → 9.
  'product_feeds:FeedDeliveryError': {
    owner: 'product_feeds',
    roots: ['harness'],
    // The one switchable owner on this ledger (D-72 point 1), and the one entry
    // whose presence claim is therefore live — which is also why it is the one
    // that is safe to make permanent: nothing is *built* here.
    permanent: true,
    reason:
      'LEDGER-PERMANENT (D-72). Harness-only, and what is imported is the **contract of the ' +
      'seam** rather than an implementation: this harness contributes delivery adapters that ' +
      'refuse, and a `product_feeds` delivery adapter says "the transport is absent" by ' +
      'throwing this error type. No instance of anything `product_feeds` owns is constructed ' +
      'here, so the hazard the ceiling exists for — a root-built service that keeps answering ' +
      'after its module is switched off — has no site. The only move that would remove the ' +
      'name is relocating an error class into `@endora-commerce/contracts` for one test helper’s benefit, ' +
      'which nothing else in the tree wants and which would put a module’s internal failure ' +
      'vocabulary into the shared API package. Nothing is: do not drain this.',
  },
};

/**
 * The residue **still to drain**, per root, as a ceiling that may only be
 * lowered.
 *
 * These are **import declarations**, which is the unit SC-001 and SC-006 are
 * written in; the ledger above is keyed one level finer. The criterion is 10
 * for both. Draining an entry means lowering the number here in the same merge
 * request, which is the whole mechanism: without it the last measurement was
 * taken by hand and nothing noticed the two that D-54 added to both roots on
 * its way past.
 *
 * D-72 point 1 — a declaration whose every binding is a `permanent` ledger
 * entry is **not** counted. A permanent entry inside a ceiling that may only be
 * lowered makes the ledger read as stalled when it is not, and it is the last
 * number to move that a reader would ever be able to move. The harness's 11
 * became 10 for that reason and for no drain.
 */
const ROOT_MODULE_IMPORT_CEILING: Readonly<Record<RootName, number>> = {
  production: 14,
  // 9 → 10 (issue #158), and this is the one direction this number is not
  // supposed to move, so the argument is here rather than in a merge-request
  // description nobody will find again.
  //
  // The declaration added is `_lifecycle/services/static-registry.js`, for
  // `buildStaticRegistry`. It is the function production already reaches
  // through `lifecycleModuleFromStaticEntries`, so the harness now builds the
  // manifest registry the way the deployment does instead of contributing
  // `() => undefined` — which is what left `translation_bundles` empty in every
  // test and the error envelope's translation path unexercised. The number this
  // file counts went up; the divergence it exists to measure went down, and
  // where those two disagree the divergence is the one that matters.
  //
  // Both raises available were worse. A registry hand-rolled in the harness is
  // precisely the "the harness does it its own way" shape T143c refuses, and a
  // `as LoadedManifestRegistry` cast over a partial object hides the same
  // divergence from the type system instead of from this ledger.
  harness: 10,
};

/** What the restated SC-001 / SC-006 ask for, kept beside what is true. */
const ROOT_MODULE_IMPORT_CRITERION = 10;

/**
 * Classes a root may still construct out of a module, and why each is not a
 * service.
 *
 * SC-006's second clause — "constructs no module-owned service" — is met in
 * both roots, and this list is what keeps it met: an entry may only be added
 * with an argument for why the thing constructed is not a service, and "it is
 * convenient here" is not one. A module-owned *service* built by a root is
 * ungated by construction, so the root's instance keeps answering after an
 * operator switches its module off and no test can see the difference.
 */
const ROOT_CONSTRUCTED_MODULE_CLASSES: Readonly<Record<string, string>> = {
  FeedDeliveryError:
    'An error type, not a service: the harness throws it from a refusing delivery adapter to ' +
    'say the transport is absent, which is the shape `product_feeds` declares for that seam.',
};

/** Every value binding a root imports from `src/modules/**`, keyed `<owner>:<binding>`. */
function moduleValueImports(source: string, fileName: string): Map<string, string> {
  const found = new Map<string, string>();
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const owner = /(?:^|\/)modules\/([^/]+)\//.exec(specifier)?.[1];
    if (owner === undefined) continue;
    const clause = statement.importClause;
    // `import './x.js'` — no clause, so nothing is bound, but the module is
    // still evaluated for its side effects. Recorded under a name a reader can
    // act on rather than skipped.
    if (clause === undefined) {
      found.set(`${owner}:<side-effect>`, specifier);
      continue;
    }
    // `import type { … }` — the root typing a contribution, not reaching into
    // an implementation.
    if (clause.isTypeOnly) continue;
    if (clause.name) found.set(`${owner}:${clause.name.text}`, specifier);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      found.set(`${owner}:${bindings.name.text}`, specifier);
      continue;
    }
    for (const element of bindings.elements) {
      // `import { type X, Y }` — the inline form, which a grep cannot tell from
      // a value import and which is why this walks the AST.
      if (element.isTypeOnly) continue;
      found.set(`${owner}:${element.name.text}`, specifier);
    }
  }
  return found;
}

/** Import **declarations** from `src/modules/**` that bind at least one value. */
function moduleValueImportDeclarations(source: string, fileName: string): number {
  return new Set(moduleValueImports(source, fileName).values()).size;
}

/**
 * The same count, minus the declarations whose **every** binding is permanent
 * (D-72 point 1) — which is what the ceiling is a ceiling on.
 *
 * Per-declaration rather than per-binding on purpose: a declaration that brings
 * in one permanent name and one drainable one is still a declaration somebody
 * has to remove, so it keeps counting until the drainable half goes.
 */
function drainableModuleValueImportDeclarations(source: string, fileName: string): number {
  const drainablePerSpecifier = new Map<string, boolean>();
  for (const [key, specifier] of moduleValueImports(source, fileName)) {
    const permanent = ROOT_MODULE_VALUE_IMPORTS[key]?.permanent === true;
    drainablePerSpecifier.set(specifier, (drainablePerSpecifier.get(specifier) ?? false) || !permanent);
  }
  return [...drainablePerSpecifier.values()].filter(Boolean).length;
}

describe('T143c — the root value-import ledger', () => {
  it('declares every value a root imports out of a module', () => {
    const undeclared: string[] = [];
    for (const [root, source] of ROOT_SOURCES) {
      for (const key of moduleValueImports(source, `${root}.ts`).keys()) {
        if (ROOT_MODULE_VALUE_IMPORTS[key] === undefined) undeclared.push(`${root} ${key}`);
      }
    }

    // A new root→module value import is the regression this file exists to
    // catch. Declaring it here is deliberate; adding it silently is what
    // happened twice while this ledger did not exist.
    expect(undeclared.sort()).toEqual([]);
  });

  it('holds no entry that has already drained', () => {
    const live = new Set<string>();
    for (const [root, source] of ROOT_SOURCES) {
      for (const key of moduleValueImports(source, `${root}.ts`).keys()) live.add(key);
    }

    const stale = Object.keys(ROOT_MODULE_VALUE_IMPORTS)
      .filter((key) => !live.has(key))
      .sort();

    // A ledger that outlives what it records stops being read. The reason texts
    // are the value here, and a stale one is a claim about the tree that is no
    // longer true.
    expect(stale).toEqual([]);
  });

  it('records which roots hold each entry, so an asymmetry is deliberate', () => {
    const mismatched: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      const actual = ROOT_SOURCES.filter(([root, source]) =>
        moduleValueImports(source, `${root}.ts`).has(key),
      ).map(([root]) => root);
      const declared = [...entry.roots].sort().join(',');
      if (actual.sort().join(',') !== declared) {
        mismatched.push(`${key}: declared ${declared}, found ${actual.join(',') || 'neither'}`);
      }
    }

    // The two roots are held to each other, so "production has it and the
    // harness does not" is a fact the ledger states rather than one a reader
    // has to rediscover.
    expect(mismatched.sort()).toEqual([]);
  });

  it('names the owning module correctly on every entry', () => {
    const wrong: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (!key.startsWith(`${entry.owner}:`)) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });

  it('says what has to happen for each entry to drain, not that it is needed', () => {
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (entry.permanent === true) continue;
      expect(entry.reason.length, `${key} has no recorded exit`).toBeGreaterThan(80);
    }
  });

  it('lets a permanent entry name no exit, so no sweep has anything to aim at', () => {
    // D-72 point 5's companion, and the inverse of the assertion above. The
    // `webhooks` idiom in `PORT_CATCHES_TO_DRAIN` is what this enforces: an
    // entry that is not waiting for anything must not sound like it is, because
    // a sentence beginning "it drains when…" is what the next sweep reads as an
    // instruction. Prose alone did not hold — D-60 prescribed a repair no test
    // in the tree would have stopped — so the idiom is asserted.
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (entry.permanent !== true) continue;
      expect(entry.reason, `${key} is permanent but names an exit`).not.toMatch(/\bdrains\b/i);
      expect(entry.reason, `${key} is permanent but does not say so`).toMatch(/do not drain this/i);
    }
  });

  it('derives which entries rest on an owner lock, rather than believing a reason', () => {
    // D-72 point 5 — D-63's property applied one file over. The ledger makes
    // two claims per entry: a Principle XVII one (a root-built instance keeps
    // answering after its owner is switched off) and a Principle I / D-52-D-53
    // one (a root that names a module's internals is a root that has to be
    // edited when that module changes). Feature 074's locks made the first
    // claim unreachable for 15 of the 16 owners — and three reasons went on
    // arguing it for weeks, because nothing here could see the difference.
    //
    // So it is read from the manifests on every run. Withdraw a lock anywhere
    // and every entry resting on it re-reds in the same run, with no sweep.
    const locked = new Set(
      DISCOVERED_MANIFESTS.filter(
        (entry) =>
          (entry.manifest.activation as { nonDeactivatable?: boolean } | undefined)
            ?.nonDeactivatable === true,
      ).map((entry) => entry.id),
    );

    // The vacuous guard this assertion needs: a manifest index that loaded but
    // classified nothing would make every `ownerLocked: true` a finding, and a
    // tree in which nothing is locked would make the flag meaningless.
    expect(locked.size, 'no manifest declares nonDeactivatable — nothing was read').toBeGreaterThan(
      0,
    );

    const wrong: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      const isLocked = locked.has(entry.owner);
      if (isLocked && entry.ownerLocked !== true) {
        wrong.push(`${key}: owner '${entry.owner}' is nonDeactivatable, entry says otherwise`);
      }
      if (!isLocked && entry.ownerLocked === true) {
        wrong.push(`${key}: owner '${entry.owner}' is switchable, entry claims a lock`);
      }
    }
    expect(wrong.sort()).toEqual([]);
  });

  it('holds each root at or below its recorded residue', () => {
    for (const [root, source] of ROOT_SOURCES) {
      const count = drainableModuleValueImportDeclarations(source, `${root}.ts`);
      expect(count, `${root} grew a module import`).toBeLessThanOrEqual(
        ROOT_MODULE_IMPORT_CEILING[root],
      );
    }
  });

  it('keeps the ceiling honest about the permanent entries it excludes', () => {
    // The other half of the exclusion: without this, marking an entry
    // `permanent` would be a way to lower a ceiling by declaration. The raw
    // count is asserted to be exactly the drainable count plus the
    // permanent-only declarations, so the two numbers cannot drift apart.
    for (const [root, source] of ROOT_SOURCES) {
      const raw = moduleValueImportDeclarations(source, `${root}.ts`);
      const drainable = drainableModuleValueImportDeclarations(source, `${root}.ts`);
      const permanentOnly = new Set(
        [...moduleValueImports(source, `${root}.ts`)]
          .filter(([key]) => ROOT_MODULE_VALUE_IMPORTS[key]?.permanent === true)
          .map(([, specifier]) => specifier),
      );
      expect(raw - drainable, `${root}: excluded declarations do not match the permanent set`).toBe(
        [...permanentOnly].filter(
          (specifier) =>
            ![...moduleValueImports(source, `${root}.ts`)].some(
              ([key, value]) =>
                value === specifier && ROOT_MODULE_VALUE_IMPORTS[key]?.permanent !== true,
            ),
        ).length,
      );
    }
  });

  it('keeps the criterion visible beside the residue it is not yet at', () => {
    // Not a behavioural assertion. The ceilings above are what is true; this is
    // what was asked for, and the gap between them is the remaining work. The
    // moment a ceiling reaches the criterion, this assertion is the one that
    // says so.
    const worst = Math.max(...Object.values(ROOT_MODULE_IMPORT_CEILING));
    expect(worst).toBeGreaterThanOrEqual(ROOT_MODULE_IMPORT_CRITERION);
  });
});

describe('T143c — no root constructs a module-owned service', () => {
  it('constructs nothing out of a module that is not on the allow-list', () => {
    const constructed: string[] = [];
    for (const [root, source] of ROOT_SOURCES) {
      const imported = new Set(
        [...moduleValueImports(source, `${root}.ts`).keys()].map((key) =>
          key.slice(key.indexOf(':') + 1),
        ),
      );
      for (const match of source.matchAll(/\bnew ([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
        const name = match[1] as string;
        if (!imported.has(name)) continue;
        if (ROOT_CONSTRUCTED_MODULE_CLASSES[name] !== undefined) continue;
        constructed.push(`${root} ${name}`);
      }
    }

    // The half of the criterion that is met, and the half that matters most: a
    // root-built service is ungated, so it answers with its module switched
    // off. Every one drained so far was found to be doing exactly that, and two
    // of them were built differently in the two roots.
    expect([...new Set(constructed)].sort()).toEqual([]);
  });

  it('says why each allowed construction is not a service', () => {
    for (const [name, reason] of Object.entries(ROOT_CONSTRUCTED_MODULE_CLASSES)) {
      expect(reason.length, `${name} has no recorded argument`).toBeGreaterThan(40);
    }
  });
});
