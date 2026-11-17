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
          'border-[var(--success)]/40 bg-[var(--success-soft)] text-[var(--success-soft-fg)] [&>svg]:text-[var(--success-soft-fg)]',
        warning:
          'border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn-soft-fg)] [&>svg]:text-[var(--warn-soft-fg)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * How an `Alert` is announced (issue #1484, UX audit SHELL-08):
 *
 * - `'assertive'` — `role="alert"`: interrupts the screen reader. Only for an
 *   error that needs attention now.
 * - `'polite'` — `role="status"`: read when the reader is idle. For a result
 *   that appeared because of something the user did.
 * - `'off'` — no live role: a static banner that is part of the page.
 */
export type AlertLive = 'assertive' | 'polite' | 'off';

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

/**
 * The announcement each variant gets when `live` is not given. Only an error
 * interrupts; a success is polite; a default or warning banner is static, since
 * most of them are present when the page loads and announcing them is noise.
 */
export const ALERT_DEFAULT_LIVE: Readonly<Record<AlertVariant, AlertLive>> = {
  destructive: 'assertive',
  success: 'polite',
  warning: 'off',
  default: 'off',
};

const LIVE_ROLE: Readonly<Record<AlertLive, 'alert' | 'status' | undefined>> = {
  assertive: 'alert',
  polite: 'status',
  off: undefined,
};

/** The ARIA role an `Alert` renders with, for a variant and an optional `live` override. */
export function alertRole(
  variant: AlertVariant | null | undefined,
  live?: AlertLive,
): 'alert' | 'status' | undefined {
  return LIVE_ROLE[live ?? ALERT_DEFAULT_LIVE[variant ?? 'default']];
}

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  /**
   * How the banner is announced. Defaults by variant — see
   * {@link ALERT_DEFAULT_LIVE}. Pass `'assertive'` for a warning that needs
   * immediate attention, `'polite'` for a default or warning banner that
   * appears as the result of an action. An explicit `role` still wins.
   *
   * A live region that is mounted already carrying its text is not reliably
   * announced. For the result of an action next to its button ("Saved",
   * "Copied"), use `InlineStatus`, which stays mounted.
   */
  live?: AlertLive;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, live, ...props }, ref) => (
    <div
      ref={ref}
      role={alertRole(variant, live)}
      data-slot="alert"
      data-variant={variant ?? 'default'}
      className={cn(alertVariants({ variant }), className)} {...props}
    />
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
