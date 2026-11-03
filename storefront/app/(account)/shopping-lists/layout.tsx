import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The shopping-list pages belong to `shopping_lists`;
 * while it is off they answer not-found (issue #666).
 */
export default async function ShoppingListsLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('shopping_lists');
  return children;
}
