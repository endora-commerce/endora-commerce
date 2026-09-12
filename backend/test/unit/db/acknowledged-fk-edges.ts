/**
 * Cross-module foreign keys whose manifest dependency is deliberately absent.
 *
 * Specified by
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §4.
 *
 * `dependencies` means "this module cannot exist without that one"
 * (install-time necessity), not "a column somewhere points there". The three
 * precedence rules in research §R9 drop the edges below; every one of them is
 * also commented in the manifest that would otherwise declare it.
 *
 * The list is capped at 15 (SC-012) and is minimality-asserted by
 * fk-dependency-drift.test.ts: an entry survives only while it is *both* still
 * a real foreign key (M1) *and* still undeclared (M2). Adding a 16th entry is a
 * visible, reviewable act.
 *
 * ## Why feature 081 left every one of them exactly as it was (T022, D-113)
 *
 * Feature 081 replaced the old migration order — timestamps corrected by the
 * module dependency graph — with a topological sort of that graph. Removing the
 * correction removes the accident that used to make an undeclared cross-module
 * foreign key work, so the obvious next thought is that these undeclared edges
 * now need something. They do not, and this paragraph exists because an
 * unchanged file invites the next reader to "finish" it.
 *
 * Three measured facts, in the order they matter (research.md §3):
 *
 * 1. **Every one is a baseline-block fact.** Each is created by a migration
 *    stamped April or June 2026 — at or before `BASELINE_THROUGH`
 *    (`20260801T000000`). The baseline block is emitted first, in ascending
 *    timestamp order, and is never reordered by the dependency graph; it is
 *    closed, and the scaffolder clamps every new core stamp past the boundary.
 *    So no declaration could change where any of them runs.
 * 2. **Promoting them into `dependencies` would close cycles**, for all but a
 *    couple: added one at a time, most find the target already reaching the
 *    source, and added together they collapse a large component. That is not a
 *    fixable oversight. It **was** the bridge tables' argument too — *"the
 *    junction tables must follow `catalog`'s `products`, and `catalog`'s
 *    channel-scoping columns must follow `sales_channels`' own table, and no
 *    module-level edge can express both"* — and
 *    `specs/120-migration-closure-bridge-ownership/` Phase 2 answered it by
 *    changing which module owns the junction rather than by finding an edge to
 *    declare: a bridge belongs to its far side (D-226), so both directions
 *    became intra-module or module → kernel and the eight entries retired. The
 *    rest are the shapes that argument does not reach.
 *
 * **The counts that stood in this block are gone deliberately** (D-100). They
 * read "all 13" and "11 of the 13" and were stale the moment the bridge entries
 * left; the array below is what answers how many there are, and
 * `fk-dependency-drift.test.ts` is what holds each one to being real.
 * 3. **The field that could express it is ruled unspellable.** An ordering edge
 *    that the migration order reads and the lifecycle does not is D-44 §5's
 *    fourth quadrant — order without bind — kept deliberately unspellable in
 *    `packages/contracts/src/modules.ts` (the doc block above
 *    `ModuleNonBindingDependencySchema`). D-113 withdrew D-108, which had
 *    proposed exactly that field. The per-*migration* escape that would work is
 *    specified and deliberately not built:
 *    `specs/081-per-module-migration-order/contracts/ordering-algorithm.md` §7.
 *
 * What replaced the accident is the position half of `fk-dependency-drift.test.ts`
 * (FR-013), and its exemption (a) — "the referenced table is created in the
 * baseline block" — is precisely fact 1. It reports zero findings on this tree,
 * and the first post-baseline migration that needs one of these edges is what
 * will say so, by name.
 */
export type DroppedEdgeRule =
  /** Rule 1 — a platform-root module never depends on a domain module. */
  | 'platform-root'
  /** Rule 2 — a junction-table owner never depends on what it bridges. */
  | 'bridge-owner'
  /** Rule 3 — the tenancy root never depends on tenant-owned modules. */
  | 'tenancy-root';

export interface AcknowledgedFkEdge {
  /** Module owning the referencing table. */
  from: string;
  /** Module owning the referenced table. */
  to: string;
  /**
   * Concrete `"<referencing_table> → <referenced_table>"` pairs covered.
   * Documentation of the blast radius, not a matching key — matching is on the
   * `(from, to)` module pair (contract §4).
   */
  via: readonly string[];
  /** Why the manifest edge is intentionally absent. MUST be non-empty. */
  reason: string;
  /** The precedence rule from research §R9 that drops it. */
  rule: DroppedEdgeRule;
  /**
   * The cycle the edge would close, when it closes one. Several edges close no
   * cycle on their own and are dropped purely on the precedence rule; those say
   * so explicitly rather than inventing a path. MUST be non-empty either way.
   */
  cycle: string;
}

export const ACKNOWLEDGED_FK_EDGES: readonly AcknowledgedFkEdge[] = [
  // ── Rule 3 — organizations is the tenancy root (Principle XI) ────────────
  // `organizations → admin_users` used to sit here. Feature 072 (T138) retired
  // it: converting the module made its dependency on `admin_notifications`
  // explicit — the new-registration notice is an in-app admin notification —
  // and that edge satisfies `admin_users` transitively. The exception became
  // dead weight and M2 said so, which is the whole point of M2.
  {
    from: 'organizations',
    to: 'customer_accounts',
    via: ['email_verification_tokens → customer_accounts'],
    reason:
      'Email-verification tokens are a registration-flow detail owned by the ' +
      'organizations module. The kept direction is customer_accounts → ' +
      'organizations, which is the tenancy direction (every transacting customer ' +
      'has an organization, feature 051).',
    rule: 'tenancy-root',
    cycle: 'organizations → customer_accounts → organizations',
  },
  {
    from: 'organizations',
    to: 'delivery_methods',
    via: ['organization_delivery_methods → delivery_methods'],
    reason:
      'The per-organization delivery-method allow-list is a late additive ' +
      'commercial option; an organization with no rows falls back to the channel ' +
      'defaults.',
    rule: 'tenancy-root',
    cycle:
      'no cycle on its own — dropped because a tenancy root that cannot install ' +
      'before an optional commercial module is not a root',
  },
  {
    from: 'organizations',
    to: 'inventory',
    via: ['organization_warehouses → warehouses'],
    reason:
      'The per-organization warehouse binding is a late additive column; an ' +
      'organization resolves stock through the channel default without it.',
    rule: 'tenancy-root',
    cycle:
      'organizations → inventory → sales_channels → organizations, once the ' +
      'sales_channels bridge edge is also declared',
  },
  {
    from: 'organizations',
    to: 'payment_methods',
    via: ['organization_payment_methods → payment_methods'],
    reason:
      'The per-organization payment-method allow-list is a late additive ' +
      'commercial option; an organization with no rows falls back to the channel ' +
      'defaults.',
    rule: 'tenancy-root',
    cycle:
      'no cycle on its own — dropped because a tenancy root that cannot install ' +
      'before an optional commercial module is not a root',
  },

  // ── Rule 1 — the kernel is the platform root (feature 072, D-32) ─────────
  {
    from: 'kernel',
    to: 'assets_library',
    via: ['sales_channels → assets'],
    reason:
      'Feature 072 T019 moved the SalesChannel entity into the kernel, which ' +
      'made the pre-existing `sales_channels.logo_asset_id → assets` foreign key ' +
      'a kernel → module edge. It is a nullable presentation column with ' +
      '`on delete set null`: dropping the assets_library module leaves the ' +
      'channel row intact, so the kernel does not *depend* on the module in the ' +
      'install-time sense the manifest graph models. D-32 counted ORM relations ' +
      'only and did not see this edge, because `logoAssetId` is a scalar ' +
      '@Property, not a @ManyToOne. Retiring it means dropping the constraint in ' +
      'a core migration — a schema change, tracked separately from the ' +
      'relocation.',
    rule: 'platform-root',
    cycle:
      'no cycle — the kernel appears in no manifest and can never be named in a ' +
      '`dependencies` array, so the edge is undeclarable rather than undeclared',
  },

  // Rule 2 — `sales_channels` owning the membership bridges — is **retired**.
  // `specs/120-migration-closure-bridge-ownership/` Phase 2 moved all nine
  // bridge tables to the modules that own their far sides (D-226), so each
  // bridge's two foreign keys are now far side → far side, which is
  // intra-module, and far side → `sales_channels`, which is module → kernel and
  // needs no declaration at all. The eight entries that stood here were this
  // defect's symptom register; they are gone because the inversion is, and
  // `fk-dependency-drift.test.ts`' minimality assertion is what says so rather
  // than this comment.

  // The `settings → sales_channels` entry that stood here until feature 072
  // T019 is gone: `sales_channels` is a kernel-owned table now, so the three
  // foreign keys it covered became settings → kernel, which needs no
  // declaration at all (the kernel has no manifest to name).
];
