import { defineModuleManifest } from '@b2b/contracts';

/**
 * Promotions module — rules engine (feature 045).
 *
 * Owns promotion definitions, the typed rule builder, the pluggable action
 * catalogue, coupons + generator, usage limits, and usage statistics.
 */
export const PROMOTION_PERMISSIONS = {
  READ: 'promotions:read',
  WRITE: 'promotions:write',
  DELETE: 'promotions:delete',
} as const;

export const manifest = defineModuleManifest({
  id: 'promotions',
  name: 'Promotions',
  description: 'Promotion rules engine: rule builder, actions, coupons, limits, statistics.',
  version: '1.0.0',
  // `carts` is deliberately NOT declared, despite the rule builder reading it
  // at runtime: carts applies promotions through
  // PromotionService.applyToCart(CartSnapshot) — a value object — so that edge
  // runs the other way.
  //
  // `orders` used to sit beside it under the same sentence, and D-94.1 moves
  // it: `promotion_usages_order_fk` (`promotion_usages.order_id` ->
  // `orders.id`, `on delete restrict`) is a cross-module foreign key, and
  // AGENTS.md § Migrations item 4 says such an edge is declared here or the
  // build fails — an `acknowledgedDependencies` entry does not satisfy it. The
  // edge is mutual: `placeOrder` calls `finalizeUsage(tx, …)` on this module's
  // finalizer and this module writes a redemption row against the order. The
  // cycle that closes (`promotions -> orders -> carts -> promotions`) is
  // broken on the other side — `orders` **and** `carts` re-express
  // `promotionService` as an acknowledged edge, which drops the install
  // ordering the constraint says is backwards and keeps the bind (D-94.3).
  //
  // The remaining former declarations (organizations, price_lists,
  // payment_methods, delivery_methods, dictionaries) are rule *dimensions* the
  // builder offers, not install-time necessities: a promotion module with no
  // price lists installed simply offers fewer conditions. `dependencies` means
  // "cannot exist without" — specs/065-manifest-aware-migrations/research.md §R9.
  // `auth` owns `requireAdmin`; `dictionaries` owns the language-scope
  // validator; `organizations` owns the status gate that keeps a suspended
  // organization from collecting org-targeted discounts. Feature 072 made all
  // three container resolutions rather than optional arguments.
  // `currencies` owns `currencyReferenceRegistry`, the registry this module
  // contributes its "who still prices in this currency" descriptor to (feature
  // 077, D-87). `currencies` used to ask the question itself, with a
  // `count(*) from "promotions"` naming this module's table — an edge that
  // existed nowhere an operator, the lifecycle or the migration order could see.
  dependencies: [
    'catalog',
    'sales_channels',
    'auth',
    'currencies',
    'dictionaries',
    'orders',
    'organizations',
  ],
  settings: {
    moduleCode: 'promotions',
    groups: [{ code: 'promotions', name: 'Promotions' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'promotions.enabled',
        name: 'Promotions enabled',
        description:
          'Switches promotions, coupons and the Rule Builder on or off, including the discounts they apply at checkout. Nothing is dropped: promotions, their rules and their usage history stay in the database and apply again exactly as configured when you switch it back on.',
        groupCode: 'promotions',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: PROMOTION_PERMISSIONS.READ, label: 'View promotions' },
    { code: PROMOTION_PERMISSIONS.WRITE, label: 'Create + edit promotions and rules' },
    { code: PROMOTION_PERMISSIONS.DELETE, label: 'Delete promotions and rules' },
  ],
  actions: [
    {
      id: 'open-promotions',
      labelKey: 'actions.openPromotions.label',
      descriptionKey: 'actions.openPromotions.description',
      icon: 'Tag',
      targetRoute: '/promotions',
      requiredPermission: PROMOTION_PERMISSIONS.READ,
      keywords: ['promotion', 'promotions', 'discount', 'coupon', 'marketing'],
      weight: 250,
    },
    {
      id: 'new-promotion',
      labelKey: 'actions.newPromotion.label',
      descriptionKey: 'actions.newPromotion.description',
      icon: 'Plus',
      targetRoute: '/promotions/new',
      requiredPermission: PROMOTION_PERMISSIONS.WRITE,
      keywords: ['promotion', 'new', 'create', 'discount', 'coupon'],
      weight: 251,
    },
  ],
  activation: { settingCode: 'promotions.enabled', default: true },
});
