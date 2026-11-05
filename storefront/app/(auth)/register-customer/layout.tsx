import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * Individual self-registration belongs to `customers`; while it is off the
 * page answers not-found, as if it had never been installed (Constitution
 * XVII), at the same segment-layout seam issue #666 put the other module
 * pages behind. The backend's register route answers 503 on its own while
 * the module is off, so the form's server action needs no second gate.
 */
export default async function RegisterCustomerLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('customers');
  return children;
}
