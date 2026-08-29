import type { ReactNode } from 'react';
import { cn } from '../lib/utils.js';

export interface StickyFormActionsProps {
  children: ReactNode;
  className?: string;
}

/**
 * Primary form actions — fixed to the bottom on mobile, inline on desktop.
 */
export function StickyFormActions(props: StickyFormActionsProps): ReactNode {
  const { children, className } = props;
  return <div className={cn('b2b-sticky-form-actions', className)}>{children}</div>;
}
