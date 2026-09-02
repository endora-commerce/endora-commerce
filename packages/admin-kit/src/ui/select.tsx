import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

/**
 * Native `<select>` styled to match shadcn's input shape. We deliberately
 * stay native here — the admin needs sturdy keyboard / accessibility
 * defaults more than custom popover chrome, and most lists are short
 * enums (status, kind, role). For richer pickers (combo / async-search),
 * swap in a Radix Select wrapper later.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
