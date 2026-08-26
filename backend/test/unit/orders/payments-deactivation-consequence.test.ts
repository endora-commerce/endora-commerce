import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import {
  buildDeactivationLedger,
  deactivationConsequencesFor,
  type CrossModuleRead,
} from '../../../src/modules/_lifecycle/services/deactivation-ledger.js';
import { nonBindingPortEdgesFrom } from '../../../src/modules/_lifecycle/services/gating-graph.js';

/**
 * What an operator switching `payments` off is told, produced by running the
 * real chain rather than written by hand (feature 080, T048; D-179).
 *
 * The `whenAbsent` sentence is the entire payload of a `refuses-without` entry:
 * the ledger classifies a declared fail-closed edge exactly as it classifies an
 * undeclared one, so without the sentence the dialog names no capability at all.
 * This file is the instrument for the sentence; `check:port-dependencies` is the
 * instrument for the `gated` and `site` facts it rests on.
 *
 * **And this edge is the first of its kind in the tree.** `orders` now declares
 * two non-binding edges on `payments` with *different kinds* — `degrades-without`
 * for the confirmation e-mail's payment line, `refuses-without` for the payment
 * row placement opens. D-179.1 repaired an order-dependent bug in exactly that
 * case (`entry.whenAbsent ?? existing?.description` paired an `unavailable`
 * effect with a *"keeps working with less"* sentence), and until this
 * conversion no real manifest produced the pair, so the repair was asserted
 * against fixtures only. Both scan orders are driven below.
 */
const MANIFESTS: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);

/** The modules an operator cannot switch off, read from their own manifests. */
const LOCKED: ReadonlySet<string> = new Set(
  MANIFESTS.filter(
    (manifest) => manifest.activation !== undefined && 'nonDeactivatable' in manifest.activation,
  ).map((manifest) => manifest.id),
);

function manifestOf(id: string): ModuleManifest {
  const manifest = MANIFESTS.find((candidate) => candidate.id === id);
  expect(manifest, `${id} is not a registered manifest`).toBeDefined();
  return manifest!;
}

/**
 * The two reads as `check-port-dependencies.ts` measures them: both are
 * `di.providePort` names resolved through `lazyPort` at call time.
 */
const REFUSING_READ: CrossModuleRead = {
  moduleId: 'orders',
  dependsOn: 'payments',
  name: 'paymentPlacementApplyPort',
  gated: true,
  captured: false,
  site: 'call',
};
const DEGRADING_READ: CrossModuleRead = {
  moduleId: 'orders',
  dependsOn: 'payments',
  name: 'paymentEmailRendererPort',
  gated: true,
  captured: false,
  site: 'call',
};

function consequencesFor(reads: readonly CrossModuleRead[]): ReturnType<
  typeof deactivationConsequencesFor
> {
  const ledger = buildDeactivationLedger({
    reads,
    declaredDependencies: new Map(),
    nonBinding: nonBindingPortEdgesFrom(MANIFESTS),
    neverAbsentOwners: LOCKED,
    acknowledged: [],
    contributionPolicies: {},
    excludedNames: new Set(),
  });
  expect(ledger.unassigned).toEqual([]);
  return deactivationConsequencesFor(ledger.entries, 'payments', () => true);
}

describe('the manifest declaration for the placement seam', () => {
  it('reads a real, non-empty manifest set', () => {
    // The floor: every assertion below filters these two, so an index that
    // stopped resolving would otherwise report a cheerful nothing.
    expect(MANIFESTS.length).toBeGreaterThan(20);
    expect(LOCKED.has('orders')).toBe(true);
  });

  it('is `refuses-without`, and carries the sentence that is its whole payload', () => {
    const edge = (manifestOf('orders').nonBindingDependencies ?? []).find(
      (candidate) =>
        candidate.moduleId === 'payments' && candidate.name === 'paymentPlacementApplyPort',
    );
    expect(edge, '`orders` declares no non-binding edge over paymentPlacementApplyPort').toBeDefined();
    expect(edge!.kind).toBe('refuses-without');
    expect(edge!.whenAbsent ?? '').not.toBe('');
  });

  it('leaves `payments.enabled` a live control — no binding declaration beside it', () => {
    // The trap this conversion had to avoid: `orders` declares
    // `activation.nonDeactivatable`, and `ModuleGatingGraph` builds
    // `dependentsOf` from `dependencies` ∪ `acknowledgedDependencies`, so either
    // spelling here would make the owner's switch refuse a flip forever.
    const orders = manifestOf('orders');
    expect(orders.dependencies ?? []).not.toContain('payments');
    expect((orders.acknowledgedDependencies ?? []).map((edge) => edge.moduleId)).not.toContain(
      'payments',
    );
    expect(manifestOf('payments').activation).toMatchObject({ settingCode: 'payments.enabled' });
  });
});

describe('what the operator is shown before switching `payments` off', () => {
  it('names the capability that stops, and calls it unavailable', () => {
    const rows = consequencesFor([REFUSING_READ]);
    expect(rows).toContainEqual({
      moduleId: 'orders',
      effect: 'unavailable',
      description:
        'the shop takes no orders at all: no payment method is left to choose, and a ' +
        'placement reaching checkout anyway is refused rather than recorded unpaid',
    });
  });

  it('lets the refusal win over the degrade, in either scan order', () => {
    // One row per dependent, whatever the number of edges: the pull decides,
    // and the sentence has to follow the effect that wins or the dialog
    // contradicts itself in six words.
    const forward = consequencesFor([DEGRADING_READ, REFUSING_READ]);
    const reverse = consequencesFor([REFUSING_READ, DEGRADING_READ]);
    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]!.effect).toBe('unavailable');
    expect(forward[0]!.description).toContain('takes no orders at all');
  });
});
