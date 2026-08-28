import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type CrossModuleRead,
} from '../../../src/lifecycle/services/deactivation-ledger.js';
import { nonBindingPortEdgesFrom } from '../../../src/lifecycle/services/gating-graph.js';

/**
 * D-179.1 — which activation switches are dead, derived rather than listed.
 *
 * A switch is dead when a module the orchestrator refuses to switch off
 * *binds* its owner: `dependencies` and `acknowledgedDependencies` are both
 * read by `ModuleGatingGraph.dependentsOf`, so the flip-time refusal names a
 * module that will never go away and the operator's control does nothing.
 * Until !1023 that was the only way to declare a fallback-less read;
 * `refuses-without` is the third spelling, and this file is what says the
 * conversions took.
 *
 * Everything below is derived from the manifests on every run (D-100). The one
 * thing written down is {@link REMAINING_DEAD_SWITCHES}, and it is written down
 * because it carries the half no walk can decide: *why* each remaining bind is
 * right, or what has to happen for it to go. It is two-way — an owner that
 * gains a locked binder fails here, and so does an entry whose owner no longer
 * has one.
 */

const MANIFESTS: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);

/** The modules an operator cannot switch off, read from their own manifests. */
const LOCKED: ReadonlySet<string> = new Set(
  MANIFESTS.filter(
    (manifest) => manifest.activation !== undefined && 'nonDeactivatable' in manifest.activation,
  ).map((manifest) => manifest.id),
);

/** One binding declaration from a locked consumer — the thing that kills a switch. */
interface Bind {
  readonly consumer: string;
  readonly how: string;
}

/** Every locked module that binds `owner`, over either binding array. */
function lockedBindersOf(owner: string): Bind[] {
  const binds: Bind[] = [];
  for (const manifest of MANIFESTS) {
    if (!LOCKED.has(manifest.id)) continue;
    for (const dependency of manifest.dependencies ?? []) {
      if (dependency === owner) binds.push({ consumer: manifest.id, how: 'dependencies' });
    }
    for (const edge of manifest.acknowledgedDependencies ?? []) {
      if (edge.moduleId === owner) {
        binds.push({ consumer: manifest.id, how: `acknowledgedDependencies(${edge.port})` });
      }
    }
  }
  return binds.sort((a, b) => a.consumer.localeCompare(b.consumer));
}

/** Every switchable owner some locked module still binds — the dead switches. */
function deadSwitches(): string[] {
  return [
    ...new Set(
      MANIFESTS.filter((manifest) => !LOCKED.has(manifest.id))
        .map((manifest) => manifest.id)
        .filter((id) => lockedBindersOf(id).length > 0),
    ),
  ].sort();
}

/**
 * The switches that are still dead after this merge request, each with the
 * reason it is right or the condition that retires it.
 *
 * Not a list of ids to keep in step with the tree: the **derivation** decides
 * membership and this decides only what the entry says. Both directions fail.
 */
const REMAINING_DEAD_SWITCHES: Readonly<Record<string, string>> = {
  api_keys:
    'Legitimately bound. `orders` migration `20260724T193611_orders_order_placement_intents` ' +
    'writes `foreign key ("api_key_id") references "api_keys" ("id")`, so the dependency is ' +
    'schema and not a port read. Nothing retires it short of dropping the constraint.',
  promotions:
    '`orders` converted both of its edges; `carts` still acknowledges `promotionService` and ' +
    '`promotionCodePort`, and `carts` was excluded from this merge request because a ' +
    'concurrent batch is moving it into `packages/modules/`. Retires when those two edges ' +
    'take the same conversion.',
  quote_requests:
    'Legitimately bound, by `carts` rather than by `orders`: `carts` migration ' +
    '`20260611T140352_carts_consolidation` writes `foreign key ' +
    '("converted_to_quote_request_id") references "quote_requests" ("id")`. `orders` gave up ' +
    'its own bind here, which changes nothing an operator can reach until that constraint does.',
};

/** The four edges this merge request re-classified, and who owns each name. */
const CONVERTED = [
  { consumer: 'orders', owner: 'credit_limits', name: 'creditLimitService' },
  { consumer: 'orders', owner: 'promotions', name: 'promotionService' },
  { consumer: 'orders', owner: 'promotions', name: 'promotionUsageFinalizer' },
  { consumer: 'orders', owner: 'quote_requests', name: 'rfqService' },
  { consumer: 'organizations', owner: 'credit_limits', name: 'creditLimitReadPort' },
] as const;

function manifestOf(id: string): ModuleManifest {
  const manifest = MANIFESTS.find((candidate) => candidate.id === id);
  expect(manifest, `${id} is not a registered manifest`).toBeDefined();
  return manifest!;
}

describe('the dead-activation-switch derivation', () => {
  it('reads a real, non-empty manifest set', () => {
    // The floor. Every assertion below is a filter over these two, so an index
    // that stopped resolving would otherwise report every switch alive.
    expect(MANIFESTS.length).toBeGreaterThan(20);
    expect(LOCKED.size).toBeGreaterThan(0);
    expect(LOCKED.has('orders')).toBe(true);
    expect(LOCKED.has('organizations')).toBe(true);
    expect(LOCKED.has('catalog')).toBe(true);
  });

  it.each(['credit_limits', 'admin_notifications'])(
    'finds no locked module binding %s — its switch is live',
    (owner) => {
      // The point of each merge request, stated as the predicate D-179.1
      // derived the candidate set from rather than as a behaviour.
      expect(lockedBindersOf(owner)).toEqual([]);
    },
  );

  it('accounts for every switch that is still dead, in both directions', () => {
    expect(deadSwitches()).toEqual(Object.keys(REMAINING_DEAD_SWITCHES).sort());
    for (const [owner, why] of Object.entries(REMAINING_DEAD_SWITCHES)) {
      expect(lockedBindersOf(owner).length, `${owner}: ${why}`).toBeGreaterThan(0);
    }
  });
});

describe('the re-classified edges', () => {
  it.each(CONVERTED)(
    '$consumer declares $owner.$name as refuses-without, with a sentence',
    ({ consumer, owner, name }) => {
      const manifest = manifestOf(consumer);
      const edge = (manifest.nonBindingDependencies ?? []).find(
        (candidate) => candidate.moduleId === owner && candidate.name === name,
      );
      expect(edge, `${consumer} declares no non-binding edge over ${name}`).toBeDefined();
      expect(edge!.kind).toBe('refuses-without');
      // `whenAbsent` is the whole payload: with none, the entry classifies
      // exactly as no entry at all and the dialog names no capability.
      expect(edge!.whenAbsent ?? '').not.toBe('');
    },
  );

  it.each(CONVERTED)(
    '$consumer keeps no binding declaration over $owner beside it',
    ({ consumer, owner }) => {
      // "One edge, one claim, in one place" — a manifest that said both would
      // be telling the operator the control works and refusing the flip.
      const manifest = manifestOf(consumer);
      expect(manifest.dependencies ?? []).not.toContain(owner);
      expect(
        (manifest.acknowledgedDependencies ?? []).map((edge) => edge.moduleId),
      ).not.toContain(owner);
    },
  );
});

describe('what the operator is shown before the flip', () => {
  /**
   * The reads, as `check-port-dependencies.ts` measures them in CI: every one
   * of the five is a `di.providePort` name resolved through `lazyPort` at call
   * time. That check is the instrument for `gated` and `site`; this file is the
   * instrument for the sentence those two let the ledger carry.
   */
  const reads: CrossModuleRead[] = CONVERTED.map((edge) => ({
    moduleId: edge.consumer,
    dependsOn: edge.owner,
    name: edge.name,
    gated: true,
    captured: false,
    site: 'call',
  }));

  const ledger = buildDeactivationLedger({
    reads,
    declaredDependencies: new Map(),
    nonBinding: nonBindingPortEdgesFrom(MANIFESTS),
    neverAbsentOwners: LOCKED,
    acknowledged: [],
    contributionPolicies: {},
    excludedNames: new Set(),
  });

  it('classifies all five as fails-closed', () => {
    expect(ledger.unassigned).toEqual([]);
    expect(ledger.entries).toHaveLength(CONVERTED.length);
    for (const entry of ledger.entries) expect(entry.outcome).toBe('fails-closed');
  });

  it('names a capability for every dependent, instead of the null it used to', () => {
    const rows = deactivationConsequencesFor(ledger.entries, 'credit_limits', () => true);
    expect(rows.map((row) => row.moduleId)).toEqual(['orders', 'organizations']);
    for (const row of rows) {
      expect(row.effect).toBe('unavailable');
      expect(row.description).not.toBeNull();
      expect(row.description!.length).toBeGreaterThan(20);
    }
  });

  it('carries a sentence on both promotions edges, whichever one renders', () => {
    // `deactivationConsequencesFor` keeps one row per dependent, so of the two
    // `orders` -> `promotions` edges only one sentence reaches the dialog and
    // which one is scan order. Both therefore have to be true on their own.
    const rows = deactivationConsequencesFor(ledger.entries, 'promotions', () => true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.moduleId).toBe('orders');
    expect(rows[0]!.description).not.toBeNull();
    const promotionEdges = (manifestOf('orders').nonBindingDependencies ?? []).filter(
      (edge) => edge.moduleId === 'promotions',
    );
    expect(promotionEdges).toHaveLength(2);
    for (const edge of promotionEdges) expect(edge.whenAbsent ?? '').not.toBe('');
  });
});


/**
 * D-179.3 — the same conversion over one owner, in two kinds.
 *
 * `admin_notifications` needed two answers rather than one: the kind belongs to
 * the **edge**, and each of its two locked consumers had already been ruled, in
 * code, by a different ruling. `catalog` decides absence in front of the gate
 * (D-60) and degrades; `organizations` re-throws it (D-88) and refuses. A
 * manifest that gave them one kind would have contradicted one of the two
 * implementations.
 */
const RECLASSIFIED_D179_3 = [
  {
    consumer: 'catalog',
    owner: 'admin_notifications',
    name: 'adminNotificationRecordPort',
    kind: 'degrades-without',
  },
  {
    consumer: 'organizations',
    owner: 'admin_notifications',
    name: 'adminNotificationRecordPort',
    kind: 'refuses-without',
  },
] as const;

describe('the two edges into admin_notifications', () => {
  it.each(RECLASSIFIED_D179_3)(
    '$consumer declares $owner.$name as $kind, with a sentence',
    ({ consumer, owner, name, kind }) => {
      const edge = (manifestOf(consumer).nonBindingDependencies ?? []).find(
        (candidate) => candidate.moduleId === owner && candidate.name === name,
      );
      expect(edge, `${consumer} declares no non-binding edge over ${name}`).toBeDefined();
      expect(edge!.kind).toBe(kind);
      // `whenAbsent` is the whole payload for both kinds: with none, the entry
      // classifies exactly as no entry at all and the dialog names nothing.
      expect(edge!.whenAbsent ?? '').not.toBe('');
    },
  );

  it.each(RECLASSIFIED_D179_3)(
    '$consumer keeps no binding declaration over $owner beside it',
    ({ consumer, owner }) => {
      expect(manifestOf(consumer).dependencies ?? []).not.toContain(owner);
      expect(
        (manifestOf(consumer).acknowledgedDependencies ?? []).map((edge) => edge.moduleId),
      ).not.toContain(owner);
    },
  );

  it('gives the two consumers different sentences, because they answer differently', () => {
    const [degrades, refuses] = RECLASSIFIED_D179_3.map(
      ({ consumer, owner, name }) =>
        (manifestOf(consumer).nonBindingDependencies ?? []).find(
          (candidate) => candidate.moduleId === owner && candidate.name === name,
        )!,
    );
    expect(degrades!.whenAbsent).not.toBe(refuses!.whenAbsent);
  });
});
