import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { defineModuleManifest } from '@endora-commerce/contracts';
import {
  acknowledgedPortEdgesFrom,
  gatingGraph,
  ModuleGatingGraph,
  nonBindingPortEdgesFrom,
} from '@endora-commerce/platform/lifecycle';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * The graph the flip-time refusals read — feature 073, FR-008, Amendment A1
 * (T045/T046).
 *
 * Every assertion below names **shipped modules**. That is the point of the
 * file: the coverage that existed when `assertActivationWritable` shipped
 * without any dependency refusal at all was fixture-shaped, and fixtures cannot
 * notice that `catalog` resolves a port owned by a module an operator can
 * switch off — the manifests are where that fact lives.
 */

const MANIFESTS = REGISTERED_MANIFESTS.map((entry) => entry.manifest);
const graph = new ModuleGatingGraph(MANIFESTS);

/** Everything present, which is the shipped default state of a deployment. */
const allPresent = (): boolean => true;
const onlyPresent =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id);

describe('acknowledgedPortEdgesFrom — the withheld edges, from the manifests', () => {
  it('reads the twenty real edges the manifests deliberately keep out of `dependencies`', () => {
    // Two arrived with issue #90, when `check-port-dependencies` learned to
    // follow a module-local cradle alias and two edges that had always been
    // resolved through one became visible: the lifecycle admin surfaces
    // reaching for `requireAdmin`, and the request hook resolving a signed-in
    // customer's Organization.
    //
    // The rest are feature 075's, and they arrived as Phase C cut consumer
    // after consumer onto published ports. Each one is a read that genuinely
    // binds and could not be declared in `dependencies` without closing a
    // cycle `src/db/migration-order.ts` refuses outright — `organizations` and
    // `customer_accounts` declare each other's neighbourhood, and
    // `quote_requests` reaches `carts` and `orders`, both of which reach back.
    //
    // The sixteenth is `catalog:organizationDetailsPort`, and it is the same
    // shape as `catalog:pricingService` one line above it: the external
    // catalog namespace decorates a bound caller's prices with their
    // organisation's effective tiers, `organizations` declares `catalog`, and
    // declaring it back closes a cycle.
    //
    // Two of them replaced entries rather than adding: `customerAuthService`
    // and `customerRoleService` became `customerAuthPort` and
    // `customerRolePort` when the `organizations` cut moved from the
    // entity-returning services to their record-returning siblings.
    //
    // Seven arrived with D-94.3, and they are the first ones that did not come
    // from a cut. Four sites of the co-transactional family gained the foreign
    // key that was always missing (`stock_allocations_order_item_fk`,
    // `promotion_usages_order_fk`, `credit_limit_reservations_order_fk`,
    // `carts_completed_order_fk`), and three of the four oblige a module to
    // declare `orders` — which makes the *reverse* `dependencies` entry, the
    // one claiming `orders` installs first, false. So `orders` re-expresses
    // `cartWritePort`, `creditLimitService`, `promotionService` and
    // `promotionUsageFinalizer` here, `carts` re-expresses `promotionService`
    // and `promotionCodePort`, and `orders` names `rfqService` for the first
    // time — that last edge was reaching `quote_requests` through `carts`'
    // closure, which the same ruling removed.
    //
    // Two more arrive with feature 080's T048, and they are the same family a
    // step further on: `orders` reaches `carts` through `cartPlacementApplyPort`
    // (the basket read and the completion, on the placement `EntityManager`,
    // which is what `carts_completed_order_fk` obliges) and through
    // `cartReadPort` (the storefront total preview, which opens no transaction
    // and therefore takes no `EntityManager`). Both were one `Cart` /`CartItem`
    // entity import until that row; the cycle they are acknowledged for is the
    // one `cartWritePort` above already names.
    //
    // Five of those seven have since **left** again, and the reason is the
    // sentence that used to stand here: *"an acknowledged edge is in the refusal
    // graph exactly as a declared one is, so `promotions`, `credit_limits` and
    // `quote_requests` stay precisely as (un)deactivatable as they were the day
    // before."* That was true and it was the defect. `orders` cannot be switched
    // off, so its acknowledgement made all three owners' activation controls
    // answer 409 for ever — D-179.1's dead switches. The owner ruling of
    // 2026-08-25 added the spelling that was missing, `nonBindingDependencies`
    // kind `refuses-without`, and `orders`' four edges plus
    // `organizations:creditLimitReadPort` moved there. The behaviour is
    // unchanged in every case: the gate refused before and refuses now.
    //
    // What makes the acknowledgement honest is that the edge is in the refusal
    // graph either way: withholding it from `dependencies` withdraws the
    // ordering claim and nothing else, so no owner becomes switchable-off
    // underneath a live resolver by being acknowledged rather than declared.
    // This comment used to argue that from most owners being non-deactivatable;
    // D-100 took that argument out of the manifests and it does not belong here
    // either — the locked set is re-derived on every run, and a sentence about
    // it in a frozen list is a copy nothing refreshes.
    const keys = acknowledgedPortEdgesFrom(MANIFESTS)
      .map((edge) => `${edge.moduleId}:${edge.port}`)
      .sort();
    expect(keys).toEqual([
      '_lifecycle:requireAdmin',
      'admin_roles:adminUserReadPort',
      'admin_users:customerAccountReadPort',
      'auth:customerOrgResolver',
      'carts:promotionCodePort',
      'carts:promotionService',
      'catalog:organizationDetailsPort',
      'catalog:pricingService',
      'orders:cartPlacementApplyPort',
      'orders:cartReadPort',
      'orders:cartWritePort',
      'organizations:addressServicePort',
      'organizations:customerAccountMemberWritePort',
      'organizations:customerAccountReadPort',
      'organizations:customerAuthPort',
      'organizations:customerRolePort',
      'organizations:passwordResetService',
      'organizations:priceListReadPort',
      'quote_requests:cartWritePort',
      'quote_requests:orderReadPort',
    ]);
  });

  it('every acknowledged edge names a module that ships', () => {
    const ids = new Set(MANIFESTS.map((manifest) => manifest.id));
    for (const edge of acknowledgedPortEdgesFrom(MANIFESTS)) {
      expect(ids, `${edge.moduleId} acknowledges "${edge.dependsOn}"`).toContain(
        edge.dependsOn,
      );
    }
  });

  it('carries a reason long enough to be an argument rather than a label', () => {
    for (const edge of acknowledgedPortEdgesFrom(MANIFESTS)) {
      expect(edge.reason.length).toBeGreaterThan(30);
    }
  });

  /**
   * D-100 — **a reason may not carry a lock-derived cost claim.**
   *
   * Eight of the twenty-three reasons argued from `activation.nonDeactivatable`
   * that the acknowledged edge cost nothing, four of them with no bound at all
   * and three of those four byte-identical. The objection is not that the
   * sentences were false today. It is that
   * `backend/scripts/lib/switchable-modules.ts` exists precisely so the locked
   * set is **re-derived on every run** — un-lock a module and ten
   * `check-port-catches` sites go red in the same pipeline — while a `reason`
   * string is a copy of that derivation which no run refreshes.
   *
   * A reason states the ground a human had to decide: the cycle that keeps the
   * edge out of `dependencies`, and what the seam does when the owner is not
   * there. `quote_requests -> orders` is the model — it names the **absence**,
   * not the lock.
   *
   * Two-way, like every other ledger here: a new lock-claiming reason fails, and
   * so does an entry left standing after its reason stopped claiming.
   */
  const LOCK_CLAIMING_REASONS_ALLOWED: Readonly<Record<string, string>> = {
    'catalog:organizationDetailsPort':
      'Bounds the claim to what an operator can flip ("nothing an operator can flip depends ' +
      'on the difference"), which is a true sentence about the axis it names rather than an ' +
      'unbounded state claim.',
    'orders:cartWritePort':
      'Same bound, stated of both ends: it says what the acknowledgement withdraws (the ' +
      'ordering claim) and that nothing an operator can reach changes with it.',
  };

  /**
   * `quote_requests:orderReadPort` is deliberately **not** an entry above, and
   * the reason is worth writing down: D-100's F1 counted it among the eight
   * lock-derived claims, and the string does not name the lock at all. It argues
   * from the **absence** — "the event that triggers it cannot be emitted by an
   * absent orders module" — which is why the same ruling calls it the model. It
   * is outside this population by construction, not by allowance, and that is
   * the difference the ratchet is measuring.
   */

  it('no reason argues from the lock, except the two that bound the claim', () => {
    const claiming = acknowledgedPortEdgesFrom(MANIFESTS)
      .filter((edge) => /non-?deactivatable/i.test(edge.reason))
      .map((edge) => `${edge.moduleId}:${edge.port}`)
      .sort();

    expect(claiming).toEqual(Object.keys(LOCK_CLAIMING_REASONS_ALLOWED).sort());
  });

  it('every allowance says why that claim is bounded, and none is stale', () => {
    for (const [key, why] of Object.entries(LOCK_CLAIMING_REASONS_ALLOWED)) {
      expect(why.length, `${key} has no recorded ground`).toBeGreaterThan(40);
    }
  });
});

describe('dependents — the deactivation direction', () => {
  it('names `organizations` among the modules that need `settings`', () => {
    // The live defect this task closes: `organizations` is the tenancy root and
    // non-deactivatable, `settings` was made deactivatable on purpose by D-36,
    // and until now the Admin UI let an operator take the first down by
    // switching off the second.
    expect(graph.dependentsOf('settings')).toContain('organizations');
  });

  it('names `catalog` among the modules that need `price_lists` — the acknowledged edge', () => {
    // The trap. `catalog` is absent from `dependentsOf('price_lists')` in the
    // manifest graph, so a refusal computed from `ModuleDepGraph` alone lets an
    // operator switch the pricing engine off under a live resolver in a core
    // commerce module.
    expect(graph.dependentsOf('price_lists')).toContain('catalog');
    expect(graph.declaredDependenciesOf('catalog')).not.toContain('price_lists');
  });

  it('names `organizations` among the modules that need `addresses` and `customer_accounts`', () => {
    expect(graph.dependentsOf('addresses')).toContain('organizations');
    expect(graph.dependentsOf('customer_accounts')).toContain('organizations');
  });

  it('reports only the dependents that are effectively present', () => {
    // With every manifest dependent of `price_lists` switched off, the one
    // blocker left is the acknowledged one. This is the case a manifest-only
    // implementation gets wrong while still returning a 409 for other reasons.
    const blocking = graph.presentDependentsOf('price_lists', onlyPresent('catalog'));
    expect(blocking).toEqual(['catalog']);
  });

  it('reports nothing for a module nothing depends on', () => {
    // `product_feeds`, a leaf that stays. This read `pim_ergonode` until that
    // module left for the paid repository (feature 134), after which the case
    // passed over an unknown id — vacuously, which is E9's third class.
    expect(MANIFESTS.some((manifest) => manifest.id === 'product_feeds')).toBe(true);
    expect(graph.presentDependentsOf('product_feeds', allPresent)).toEqual([]);
  });
});

describe('dependencies — the activation direction', () => {
  it('ignores acknowledged edges, because they are mutual by construction', () => {
    // `catalog` acknowledges `price_lists`, `price_lists` declares `catalog`.
    // Reading the acknowledged edge here would mean neither can be switched on
    // while the other is off — a pair with no way back.
    expect(graph.absentDependenciesOf('catalog', onlyPresent())).not.toContain(
      'price_lists',
    );
    expect(graph.acknowledgedDependenciesOf('catalog')).toEqual([
      'organizations',
      'price_lists',
    ]);
  });

  // Both cases below read `pim_ergonode` until feature 134 took it to the paid
  // repository; `product_feeds` declares `price_lists` the same way and stays.
  it('names the declared dependencies that are absent', () => {
    const present = new Set(MANIFESTS.map((manifest) => manifest.id));
    present.delete('price_lists');
    expect(
      graph.absentDependenciesOf('product_feeds', (id) => present.has(id)),
    ).toEqual(['price_lists']);
  });

  it('reports nothing when everything the module needs is present', () => {
    expect(MANIFESTS.some((manifest) => manifest.id === 'product_feeds')).toBe(true);
    expect(graph.absentDependenciesOf('product_feeds', allPresent)).toEqual([]);
  });
});

/**
 * D-44 — a `nonBindingDependencies` edge is real to the container and invisible
 * to this graph, in **both** directions.
 *
 * Synthetic manifests rather than shipped ones on purpose: the property is that
 * the graph does not read the field at all, and a fixture pair is the only way
 * to state it without waiting for a module to declare one. The shipped
 * declarations are held to the same property by the last case.
 */
describe('non-binding edges — declared, and absent from both directions', () => {
  const host = defineModuleManifest({
    id: 'assistant',
    name: 'Assistant',
    version: '1.0.0',
    dependencies: [],
  });
  const contributor = defineModuleManifest({
    id: 'shop',
    name: 'Shop',
    version: '1.0.0',
    dependencies: [],
    nonBindingDependencies: [
      {
        moduleId: 'assistant',
        name: 'toolRegistry',
        kind: 'contributes-to',
        reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
      },
    ],
  });
  const fixture = new ModuleGatingGraph([host, contributor]);

  it('flattens the edges the way the port check keys them', () => {
    expect(nonBindingPortEdgesFrom([host, contributor])).toEqual([
      {
        moduleId: 'shop',
        dependsOn: 'assistant',
        name: 'toolRegistry',
        kind: 'contributes-to',
        whenAbsent: null,
        reason: 'Pushes an inert tool descriptor into the assistant catalogue at boot.',
      },
    ]);
  });

  it('does not make the contributor a dependent of the host', () => {
    // The whole point: the host keeps a live activation control. An
    // `acknowledgedDependencies` entry in the same position would appear here.
    expect(fixture.dependentsOf('assistant')).toEqual([]);
    expect(fixture.presentDependentsOf('assistant', allPresent)).toEqual([]);
  });

  it('does not make the host a dependency of the contributor', () => {
    expect(fixture.declaredDependenciesOf('shop')).toEqual([]);
    expect(fixture.acknowledgedDependenciesOf('shop')).toEqual([]);
    expect(fixture.absentDependenciesOf('shop', onlyPresent())).toEqual([]);
  });

  it('leaves every shipped non-binding target out of `dependentsOf`', () => {
    // The shipped half of the same property, so a later edit that folds the
    // field into the constructor fails here rather than in an operator's 409.
    for (const edge of nonBindingPortEdgesFrom(MANIFESTS)) {
      expect(
        graph.dependentsOf(edge.dependsOn),
        `${edge.moduleId} declares ${edge.dependsOn}:${edge.name} as non-binding`,
      ).not.toContain(edge.moduleId);
    }
  });

  it('names a module that ships, and carries an argument rather than a label', () => {
    const ids = new Set(MANIFESTS.map((manifest: ModuleManifest) => manifest.id));
    for (const edge of nonBindingPortEdgesFrom(MANIFESTS)) {
      expect(ids, `${edge.moduleId} → ${edge.dependsOn}`).toContain(edge.dependsOn);
      expect(edge.reason.length).toBeGreaterThan(30);
      if (edge.kind === 'degrades-without') expect(edge.whenAbsent).not.toBeNull();
    }
  });
});

describe('the process singleton', () => {
  it('defaults to the registered core manifests rather than to an empty graph', () => {
    // An empty graph is a refusal that never fires, which is the fall-open this
    // task removes; the default has to know the edges before anything installs
    // a deployment-specific manifest set.
    expect(gatingGraph().dependentsOf('settings')).toContain('organizations');
    expect(gatingGraph().dependentsOf('price_lists')).toContain('catalog');
  });
});
