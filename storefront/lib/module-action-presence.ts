import type { ModulePresenceSet } from './api/module-presence';
import type { CommerceAbilities } from './commerce-permissions';

/**
 * Which of the modules that contribute in-page commerce actions are present
 * for this request — Principle XVII item 5, issue #672: a module that is off
 * contributes no storefront element, its buttons on a product card included.
 *
 * Resolved on the server from `getServerContext().modules` and handed down as
 * plain booleans, because a function does not cross the server/client
 * boundary and a client island must not ask the browser what is present. One
 * object, so a product card rendered in many lists takes one prop rather than
 * one per action.
 */
export interface ModuleActionPresence {
  /** `shopping_lists` — the heart, save-to-list, the list conversions. */
  readonly shoppingLists: boolean;
  /** `comparisons` — the compare toggle. */
  readonly comparisons: boolean;
  /** `quote_requests` — add to quote, the quote-only call to action, the conversions into a quote request. */
  readonly quoteRequests: boolean;
}

export function moduleActionPresence(modules: Pick<ModulePresenceSet, 'isPresent'>): ModuleActionPresence {
  return {
    shoppingLists: modules.isPresent('shopping_lists'),
    comparisons: modules.isPresent('comparisons'),
    quoteRequests: modules.isPresent('quote_requests'),
  };
}

/**
 * The member's abilities with the actions of absent modules withdrawn. Both
 * gates must allow: presence never grants what the role withholds
 * (`specs/170-organization-roles/`), and the role never offers what the
 * platform is not serving.
 */
export function withModulePresence(
  abilities: CommerceAbilities,
  presence: ModuleActionPresence,
): CommerceAbilities {
  return {
    editCart: abilities.editCart,
    requestQuote: abilities.requestQuote && presence.quoteRequests,
    editShoppingLists: abilities.editShoppingLists && presence.shoppingLists,
    convertListToCart: abilities.convertListToCart && presence.shoppingLists,
    convertListToQuote: abilities.convertListToQuote && presence.shoppingLists && presence.quoteRequests,
    // The quick-order page is gated by its own segment layout (issue #666).
    useQuickOrder: abilities.useQuickOrder,
  };
}
