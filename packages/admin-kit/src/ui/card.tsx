import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

/**
 * The admin's one card (issue #1438, UX audit 2026-11-17 DS-04; owner decision
 * DEC-03). Its density comes from the tokens in `theme.css` — `--card-pad`
 * around header, content and footer, `--fs-section-title` for the title — so
 * the deprecated legacy card classes in `theme.css`, which read the same tokens, draw the
 * same box.
 *
 * Every part carries a `data-slot`, which is how `CardContent` knows whether it
 * follows a header: it drops its top padding only then, so a header-less card
 * (a frame around a table or a filter row) needs no `pt-6` workaround.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * No padding around the content and clipped corners — for a card whose
   * content is a table that runs to the card's edge. A `CardHeader` keeps its
   * padding.
   */
  flush?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({ className, flush, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card"
    data-flush={flush ? '' : undefined}
    className={cn(
      'rounded-lg border bg-card text-card-foreground shadow-sm',
      flush && 'overflow-hidden [&[data-flush]>[data-slot=card-content]]:p-0',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn('flex flex-col space-y-1.5 p-(--card-pad)', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

/** The element a `CardTitle` renders. A heading by default; `div` takes it out of the outline. */
export type CardTitleElement = 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * `h2` by default — a card titles a section of the page under its `h1`. Use
   * `h3` for a card inside another titled section, and never `h1`: the page
   * header owns the page's one `h1`.
   */
  as?: CardTitleElement;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as = 'h2', ...props }, ref) => {
    const Heading = as;
    return (
      <Heading
        ref={ref}
        data-slot="card-title"
        className={cn('text-(length:--fs-section-title) font-semibold leading-none tracking-tight', className)}
        {...props}
      />
    );
  },
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn('p-(--card-pad) [[data-slot=card-header]+&]:pt-0', className)}
      {...props}
    />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="card-footer" className={cn('flex items-center p-(--card-pad) pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
