import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils.js';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 bg-destructive/10 text-destructive [&>svg]:text-destructive',
        success:
          'border-emerald-500/40 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-700 dark:bg-emerald-950 dark:text-emerald-100',
        warning:
          'border-amber-500/40 bg-amber-50 text-amber-900 [&>svg]:text-amber-700 dark:bg-amber-950 dark:text-amber-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
  ),
);
AlertDescription.displayName = 'AlertDescription';
