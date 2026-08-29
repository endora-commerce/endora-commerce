import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class-name merger used by every shadcn component. Combines the
 * developer-friendly `clsx` API (objects, falsy guards, arrays) with
 * `tailwind-merge`'s deduplication so `cn('p-2', 'p-4')` resolves to
 * the later utility instead of stacking both.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
