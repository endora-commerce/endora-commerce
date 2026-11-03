import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The quote-request draft belongs to `quote_requests`;
 * while it is off it answers not-found (issue #666).
 */
export default async function QuoteRequestDraftLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('quote_requests');
  return children;
}
