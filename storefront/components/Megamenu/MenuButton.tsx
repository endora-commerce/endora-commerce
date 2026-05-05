import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@b2b/contracts';

interface MenuButtonProps {
  item: ResolvedMenuItem;
}

const variantClasses: Record<string, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
};

/**
 * Renders a menu item of kind `button` as an anchor styled per its
 * `variant` (`primary | secondary | ghost`). Variants mirror the CMS
 * Page Builder's `Button` component so a CTA inside a megamenu panel
 * matches one inside an embedded CMS Block.
 */
export function MenuButton({ item }: MenuButtonProps): ReactNode {
  if (!item.url) return null;
  const variant = item.variant ?? 'primary';
  const className = `inline-flex h-10 items-center rounded-md px-4 text-sm font-medium transition ${
    variantClasses[variant] ?? variantClasses['primary']!
  }`;
  return (
    <a href={item.url} className={className}>
      {item.label}
    </a>
  );
}
