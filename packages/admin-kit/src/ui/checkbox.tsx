import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

/**
 * Styled native checkbox. Keeps the standard form semantics intact (useful
 * for uncontrolled forms + browser autofill) while picking up the
 * shadcn-style border + focus ring.
 */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      type="checkbox"
      ref={ref}
      className={cn(
        'h-4 w-4 shrink-0 rounded-sm border border-input bg-transparent shadow-sm',
        'accent-primary',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
