import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The ordering-defaults page reads and writes `quick_order`'s preferences
 * (`/api/v1/quick-order/preferences`); while it is off it answers not-found
 * (issue #672), as the quick-order page does (issue #666).
 */
export default async function PreferencesLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('quick_order');
  return children;
}
