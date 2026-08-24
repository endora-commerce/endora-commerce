import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleCliCommand,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/module-context.js';

/**
 * Carts module — feature 027 consolidation pass.
 *
 * Settings (`carts.abandonment.*`) declared here are seeded by the module-
 * lifecycle ManifestReconciler on backend boot. No raw INSERT in the
 * migration; the reconciler is the single seed path (matches the
 * `inventory.*` and `organizations.*` patterns).
 */

export const CARTS_SETTING_CODES = {
  ABANDONMENT_INACTIVITY_MINUTES: 'carts.abandonment.inactivity_minutes',
  ABANDONMENT_NOTIFICATION_RECIPIENT: 'carts.abandonment.notification_recipient',
} as const;

/**
 * The manifest defaults, exported so a read that has to degrade degrades to
 * *this* binding rather than to a literal invented at the call site (feature
 * 072, D-43).
 *
 * The two used to diverge: the manifest said 10080 while both readers' `catch`
 * answered `0`, and `CartAbandonmentWorker` treats `<= 0` as "sweep nothing".
 * The divergence did not merely lose the configured value — it inverted the
 * feature, and it would still have been off after the channel was fixed. A
 * compiled-in fallback is a second source of truth consulted only when the
 * first is unreachable, i.e. exactly when nobody is watching.
 */
export const DEFAULT_ABANDONMENT_INACTIVITY_MINUTES = 10080;
export const DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT = '';

const settings = defineModuleSettingsManifest({
  moduleCode: 'carts',
  groups: [{ code: 'carts', name: 'Carts' }],
  settings: [
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
      name: 'Cart abandonment threshold (minutes)',
      description:
        'Minutes of inactivity before an Active cart is considered Abandoned. Default 10080 (7 days).',
      groupCode: 'carts',
      valueType: 'number',
      defaultValue: DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
    },
    {
      code: CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
      name: 'Abandonment notification recipient',
      description:
        'Single e-mail address that receives an abandonment notification on every Active → Abandoned transition. Empty = no notification.',
      groupCode: 'carts',
      valueType: 'string',
      defaultValue: DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'carts',
  name: 'Carts',
  description: 'Shopping cart aggregation, pricing, lifecycle, and approval gate.',
  version: '2.0.0',
  // Feature 075, Phase C adds `catalog`. Six files read the `Product`,
  // `ProductPackagingUnit` and `ProductLink` entities directly — the cart line,
  // the cart serializer, the admin detail, the up-sell strip, the pricing
  // recompute and the quote-to-cart conversion — so an operator who switched
  // `catalog` off still had carts naming, pricing and accepting products the
  // platform had stopped serving, out of tables deactivation leaves in place.
  // Binding rather than non-binding: a basket that cannot resolve what is in it
  // must refuse, not quote a figure it cannot justify (issue #124's rule, which
  // `price_lists` already stands on here).
  //
  // D-94.1 adds `orders`, for the foreign key `carts_completed_order_fk`
  // (`carts.completed_order_id` -> `orders.id`, `on delete set null`) — the
  // pointer this table has always had for its *other* terminal transition
  // (`carts_converted_to_qr_fk`) and never for this one. AGENTS.md
  // § Migrations item 4: a cross-module foreign key is declared here or the
  // build fails.
  //
  // D-94.3 moves `promotions` out, to `acknowledgedDependencies` below. The
  // edge is unchanged and still binds — what is withdrawn is the install
  // ordering, which `promotion_usages_order_fk` now says runs the other way:
  // `promotions` declares `orders`, `orders` is declared here, so keeping
  // `promotions` in `dependencies` would close `carts -> promotions -> orders
  // -> carts`.
  dependencies: [
    'catalog',
    'customer_accounts',
    'orders',
    'organizations',
    'price_lists',
    'quote_requests',
    'sales_channels',
    'settings',
  ],
  // Feature 073, Amendment A1 — a real port edge whose `dependencies` entry
  // would close a cycle. Read by the flip-time refusals and by
  // `check-port-dependencies`; read by neither the install order nor the
  // migration order.
  acknowledgedDependencies: [
    {
      moduleId: 'promotions',
      port: 'promotionService',
      reason:
        'The basket prices through `PromotionApplyPort.applyToCart`, which is a real bind: a ' +
        'cart that cannot resolve its discount must not quote a figure it cannot justify. ' +
        'The edge cannot go in `dependencies` since D-94.1, because ' +
        '`promotion_usages_order_fk` obliges `promotions` to declare `orders`, this module ' +
        'declares `orders` for `carts_completed_order_fk`, and the three together close ' +
        '`carts -> promotions -> orders -> carts`. Acknowledging it withdraws the install ' +
        'ordering the constraint says is backwards and withdraws nothing else — `promotions` ' +
        'stays exactly as (un)deactivatable under this module as it was.',
    },
    {
      moduleId: 'promotions',
      port: 'promotionCodePort',
      reason:
        'The coupon a buyer typed, resolved through the three-step lookup `promotions` owns — ' +
        'the legacy inline code, then the coupon table, then the promotion behind it, each ' +
        'filtered on `isActive`. It shares the cycle of `promotionService` above and is ' +
        'acknowledged for the same reason and with the same effect: the bind is kept, the ' +
        'ordering claim the foreign key contradicts is dropped.',
    },
  ],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base. This reverses
  // the reading 073 took. The quote-only deployment that argued for a switch
  // here is real, but it does not want the *basket* gone: checkout, quick order
  // and the quote flow all assemble one, so switching this off removes the
  // structure every ordering path is built on rather than one path among
  // several. A deployment that quotes and never checks out simply does not use
  // checkout; `quote_requests` is where that choice belongs, and it stays
  // operator-controlled.
  //
  // `carts.enabled` goes with the control it backed: one of the nineteen that
  // never accepted a deactivation. The existing rows are removed by a core data
  // migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'The basket every ordering path assembles — checkout, quick order and the quote flow all ' +
      'go through it.',
  },
  // Feature 026 checklist — `routes.admin.ts` gates on both codes and this
  // manifest declared neither, so until T136 only a role holding `'*'` could
  // reach the admin cart screens. The permission-inventory scanner that should
  // have caught it read one call shape out of the several the tree writes; it
  // now reads every shape, blanks comments and regex literals, and reports an
  // argument it cannot resolve instead of dropping it.
  //
  // D-173 adds the third, and it is not this module's own code: the admin
  // proxy for the per-Organization `requires_cart_approval` policy is gated on
  // `customers:manage`, whose core `PERMISSION_CATALOGUE` row names
  // `customers` — a module an operator can switch off, while this one declares
  // itself non-deactivatable. Declaring it here makes this module a second
  // *owner*, in the shape issue #213 gave `integrations:manage`, so the code
  // stays grantable on `/admin-roles` while this surface is on. The label —
  // *"Manage customer organizations"* — reads as a sentence about that
  // endpoint, so the code is shared rather than replaced.
  permissions: [
    { code: 'carts:read', label: 'View customer carts' },
    { code: 'carts:reject', label: 'Reject a cart pending organization approval' },
    { code: 'customers:manage', label: 'Manage customer organizations' },
  ],
  i18n: { bundlesDir: 'i18n' },
});

/** Legacy export retained for backward compatibility. */
export const cartsManifest = settings;

/**
 * The operator command this module declares — feature 080, T042b / D-160.9.
 *
 * It was `scripts/abandonment-sweep.ts`, the tree's one call site of
 * `requireModuleEnabled` and the worked example D-157 was written around. The
 * host asks that question now, at the declaration seam, for every command; see
 * `cli/abandonment-sweep.ts` for what the move changed and what it did not.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'abandonment-sweep',
    summary: 'Run one pass of the cart abandonment sweep against the live database.',
    run: async (context) =>
      (await import('./cli/abandonment-sweep.js')).abandonmentSweep(context),
  },
];
