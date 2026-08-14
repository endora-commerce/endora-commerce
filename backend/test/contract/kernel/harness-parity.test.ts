import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../../src/composition.generated.js';

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

  it('both roots reach the generated list through the same two-pass split', () => {
    // The split itself is shared code (`composition-passes.ts`), so the only
    // thing to check is that neither root has grown a private opinion about it.
    for (const source of [harness, production]) {
      expect(source).toContain('earlyPassModules(MODULES)');
      expect(source).toContain('latePassModules(MODULES)');
    }
  });

  it('every generated entry is composed exactly once per pass', () => {
    // `composeModules` is called twice in each root — once per pass — and never
    // a third time with a hand-picked subset, which is how a root would start
    // choosing its own module set again.
    for (const source of [harness, production]) {
      const calls = [...source.matchAll(/\bcomposeModules\s*\(/g)].length;
      expect(calls).toBe(2);
    }
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
  OpenIdOAuthProvider: 'replaced by fakeOAuthProvider — a deliberate egress seam',
  SearchIndexer:
    'built inside a production-only closure; the harness builds its own through searchModule',
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
    // One subscribing site is left in the harness — the module-state channel.
    // The custom-field cache moved into `custom_fields`' own `onBoot` when the
    // module was converted (feature 072, T087), which is where it belongs and
    // which is also why the guard could not follow it: a module must not know
    // it is being composed by a test harness.
    //
    // So the guard moved to the *input* instead. The harness registers the real
    // `redisSubscriber` only under `exercisePubSub` and an inert stand-in
    // otherwise, and the module arms whichever it is handed. That keeps the
    // property this test exists for — a live subscription only where a test
    // asks for one — without the module carrying a test flag.
    //
    // Three occurrences: the remaining subscribing site, the registration
    // ternary, and the handle flag that tells teardown whether there is
    // anything to unsubscribe from. The flag exists because `unsubscribe()` on
    // a client that never subscribed rejects asynchronously from ioredis's
    // socket close handler, where no `try` can reach it.
    const guards = [...harness.matchAll(/options\.exercisePubSub === true/g)].length;
    const subscribes = [...harness.matchAll(/\.(subscribe|start)\(redisSubscriber|redisSubscriber\.subscribe\(/g)]
      .length;
    expect(guards).toBe(3);
    expect(subscribes).toBe(1);
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
