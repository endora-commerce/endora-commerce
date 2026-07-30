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
  {
    from: 'organizations',
    to: 'admin_users',
    via: ['organizations → admin_users', 'organization_tax_id_validations → admin_users'],
    reason:
      'Sales-rep assignment and tax-id validation attribution are optional admin ' +
      'annotations on an organization; an organization exists and transacts ' +
      'without either. The tenancy root must stay installable before the admin ' +
      'domain.',
    rule: 'tenancy-root',
    cycle:
      'no cycle on its own — dropped because a tenancy root that cannot install ' +
      'before an optional admin module is not a root',
  },
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

  // ── Rule 2 — sales_channels owns the membership bridges ─────────────────
  {
    from: 'sales_channels',
    to: 'assets_library',
    via: ['sales_channels → assets'],
    reason:
      'A channel logo is presentation metadata on the channel row. The bridge ' +
      'owner does not depend on the asset library; the library is a platform root.',
    rule: 'bridge-owner',
    cycle:
      'no cycle on its own — dropped because declaring it inverts the ' +
      'bridge-ownership direction',
  },
  {
    from: 'sales_channels',
    to: 'catalog',
    via: ['sales_channel_categories → categories', 'sales_channel_products → products'],
    reason:
      'Channel membership bridges are owned by sales_channels but consumed by the ' +
      'domain: catalog is the module that cannot function without channel scoping, ' +
      'and it declares sales_channels.',
    rule: 'bridge-owner',
    cycle: 'sales_channels → catalog → sales_channels',
  },
  {
    from: 'sales_channels',
    to: 'cms',
    via: ['sales_channel_cms_pages → cms_pages'],
    reason:
      'Same bridge-ownership inversion as catalog: cms declares sales_channels, ' +
      'not the other way round.',
    rule: 'bridge-owner',
    cycle: 'sales_channels → cms → sales_channels',
  },
  {
    from: 'sales_channels',
    to: 'customer_accounts',
    via: ['sales_channel_customer_accounts → customer_accounts'],
    reason:
      'Per-channel customer visibility is a membership bridge; the customer ' +
      'domain is what needs channel scoping.',
    rule: 'bridge-owner',
    cycle: 'sales_channels → customer_accounts → price_lists → catalog → sales_channels',
  },
  {
    from: 'sales_channels',
    to: 'delivery_methods',
    via: ['sales_channel_delivery_methods → delivery_methods'],
    reason:
      'Per-channel delivery-method availability is a membership bridge over a root ' +
      'module that is complete without any channel.',
    rule: 'bridge-owner',
    cycle:
      'no cycle on its own — dropped because declaring it inverts the ' +
      'bridge-ownership direction',
  },
  {
    from: 'sales_channels',
    to: 'organizations',
    via: ['sales_channel_organizations → organizations'],
    reason:
      'Per-channel organization visibility is a membership bridge. organizations ' +
      'is the tenancy root and must install before any channel-scoped domain.',
    rule: 'bridge-owner',
    cycle:
      'no cycle on its own — dropped because declaring it inverts the ' +
      'bridge-ownership direction and would pull the tenancy root behind ' +
      'sales_channels',
  },
  {
    from: 'sales_channels',
    to: 'payment_methods',
    via: ['sales_channel_payment_methods → payment_methods'],
    reason:
      'Per-channel payment-method availability is a membership bridge over a root ' +
      'module that is complete without any channel.',
    rule: 'bridge-owner',
    cycle:
      'no cycle on its own — dropped because declaring it inverts the ' +
      'bridge-ownership direction',
  },
  {
    from: 'sales_channels',
    to: 'promotions',
    via: ['sales_channel_promotions → promotions'],
    reason:
      'Promotion-to-channel membership is a bridge; promotions declares ' +
      'sales_channels because a promotion is resolved per channel.',
    rule: 'bridge-owner',
    cycle: 'sales_channels → promotions → sales_channels',
  },
  {
    from: 'sales_channels',
    to: 'taxes',
    via: ['sales_channel_taxes → taxes'],
    reason:
      'Per-channel tax-class availability is a membership bridge over a root ' +
      'module that is complete without any channel.',
    rule: 'bridge-owner',
    cycle:
      'no cycle on its own — dropped because declaring it inverts the ' +
      'bridge-ownership direction',
  },

  // ── Rule 1 — settings is a platform root ────────────────────────────────
  {
    from: 'settings',
    to: 'sales_channels',
    via: [
      'setting_group_sales_channels → sales_channels',
      'setting_sales_channels → sales_channels',
      'setting_values → sales_channels',
    ],
    reason:
      'The per-channel scope columns are optional: a setting value with a null ' +
      'sales_channel_id is the global value. settings is the platform root every ' +
      'module — sales_channels included — installs on top of.',
    rule: 'platform-root',
    cycle: 'settings → sales_channels → settings',
  },
];
