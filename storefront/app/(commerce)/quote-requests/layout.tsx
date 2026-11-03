import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The quote-request confirmation pages belong to `quote_requests`;
 * while it is off they answer not-found (issue #666).
 */
export default async function QuoteRequestSuccessLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('quote_requests');
  return children;
}
