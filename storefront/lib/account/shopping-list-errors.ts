import { defineUrlErrors } from '../url-errors';

/**
 * What `/shopping-lists` and `/shopping-lists/:id` say about a refused action
 * (issue #745). **A code travels, never a sentence** — see `lib/url-errors.ts`.
 */
export const SHOPPING_LIST_ERRORS = defineUrlErrors({
  api: {
    SHOPPING_LIST_CANNOT_DELETE_DEFAULT: 'account.shoppingLists.error.SHOPPING_LIST_CANNOT_DELETE_DEFAULT',
    SHOPPING_LIST_CANNOT_DELETE_LAST: 'account.shoppingLists.error.SHOPPING_LIST_CANNOT_DELETE_LAST',
    NOT_FOUND: 'account.shoppingLists.error.NOT_FOUND',
    PRODUCT_NOT_FOUND: 'commerce.error.PRODUCT_NOT_FOUND',
    CART_LINE_CAP_EXCEEDED: 'commerce.error.CART_LINE_CAP_EXCEEDED',
    ORGANIZATION_PERMISSION_REQUIRED: 'commerce.error.ORGANIZATION_PERMISSION_REQUIRED',
  },
  own: {
    NAME_REQUIRED: 'account.shoppingLists.nameRequired',
    CREATE_FAILED: 'account.shoppingLists.createFailed',
    DELETE_FAILED: 'account.shoppingLists.deleteFailed',
    SET_DEFAULT_FAILED: 'account.shoppingLists.setDefaultFailed',
    RENAME_FAILED: 'account.shoppingList.renameFailed',
    UPDATE_FAILED: 'account.shoppingList.updateFailed',
    REMOVE_FAILED: 'account.shoppingList.removeFailed',
    CLEAR_FAILED: 'account.shoppingList.clearFailed',
    CONVERT_FAILED: 'account.shoppingList.convertFailed',
    SELECT_AT_LEAST_ONE: 'account.shoppingList.selectAtLeastOne',
    FAILED: 'account.shoppingLists.error.FAILED',
  },
  generic: 'FAILED',
});
