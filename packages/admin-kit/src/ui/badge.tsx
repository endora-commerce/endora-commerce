import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
        warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
