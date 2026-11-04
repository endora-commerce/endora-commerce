import { can, type OrganizationPermissionSession } from './organization-permissions';

/**
 * What a buyer may do on the commerce surfaces — the product page, the product
 * cards, the cart, quick order and the shopping lists
 * (`specs/170-organization-roles/`, FR-030, FR-040, FR-047, FR-048, FR-057;
 * research R-12). Every surface reads these flags, so each rule has one
 * spelling over `can(session, code)`.
 *
 * Presentation only, as `can` is: the backend's guards are the boundary
 * (`contracts/storefront-api.md` §5), and an action shown here that the
 * server refuses is the safe failure, a refusal the page already words.
 */
export interface CommerceAbilities {
  /** Add to the cart, change or remove its lines, apply a coupon — `carts.create`. */
  readonly editCart: boolean;
  /** Add to the quote-request draft, turn the cart into a quote request — `quote_requests.create`. */
  readonly requestQuote: boolean;
  /** Create, rename, edit and delete lists, save a product or a cart line to one — `shopping_lists.create`. */
  readonly editShoppingLists: boolean;
  /** Convert a list (or lines of it) into the cart — `shopping_lists.convert` and `carts.create` (FR-048). */
  readonly convertListToCart: boolean;
  /** Convert a list (or lines of it) into a quote request — `shopping_lists.convert` and `quote_requests.create`. */
  readonly convertListToQuote: boolean;
  /**
   * Open the quick-order import at all — `carts.create` **or** `quote_requests.create` (owner
   * ruling Q2(b), 2026-11-04). Each of its targets is still judged on its own code.
   */
  readonly useQuickOrder: boolean;
}

/**
 * A signed-out visitor: every surface stays as it was before roles existed.
 * The guest basket is not judged by any role (owner ruling PR-4, research
 * R-35) — add-to-cart and cart editing stay offered — and the other actions
 * already route a visitor through sign-in where they need one.
 */
export const VISITOR_ABILITIES: CommerceAbilities = Object.freeze({
  editCart: true,
  requestQuote: true,
  editShoppingLists: true,
  convertListToCart: true,
  convertListToQuote: true,
  useQuickOrder: true,
});

/**
 * The flags for one buyer: `null`/`undefined` is a signed-out visitor (or a
 * session `/api/v1/me` did not answer for, which the backend treats the same
 * way); anything else is a signed-in member, judged by their role's codes.
 */
export function commerceAbilities(
  session: OrganizationPermissionSession | null | undefined,
): CommerceAbilities {
  if (!session) return VISITOR_ABILITIES;
  const carts = can(session, 'carts.create');
  const quotes = can(session, 'quote_requests.create');
  const convert = can(session, 'shopping_lists.convert');
  return {
    editCart: carts,
    requestQuote: quotes,
    editShoppingLists: can(session, 'shopping_lists.create'),
    convertListToCart: convert && carts,
    convertListToQuote: convert && quotes,
    useQuickOrder: carts || quotes,
  };
}

/**
 * The member session inside a `/api/v1/me` answer: `organizationRole` and
 * `permissions` ride on its `customerAccount` (`contracts/storefront-api.md`
 * §1). Read structurally so this file does not depend on how the account
 * fetcher types the answer.
 */
export function memberSession(
  me: { readonly customerAccount: object } | null | undefined,
): OrganizationPermissionSession | null {
  if (!me) return null;
  return me.customerAccount as OrganizationPermissionSession;
}

/** The product card's three settings toggles (`/api/v1/storefront/settings/product-card-buttons`). */
export interface ProductCardButtonsConfig {
  readonly showAddToCart: boolean;
  readonly showAddToShoppingList: boolean;
  readonly showAddToQuote: boolean;
}

/**
 * Which of the product card's buttons render: the shop's toggle **and** the
 * buyer's ability, and add-to-cart only for a directly buyable product.
 */
export function cardActionVisibility(
  config: ProductCardButtonsConfig,
  abilities: CommerceAbilities,
  buyable: boolean,
): { cart: boolean; list: boolean; quote: boolean } {
  return {
    cart: config.showAddToCart && buyable && abilities.editCart,
    list: config.showAddToShoppingList && abilities.editShoppingLists,
    quote: config.showAddToQuote && abilities.requestQuote,
  };
}
