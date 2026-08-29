import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';

interface MenuLinkProps {
  item: ResolvedMenuItem;
  className?: string;
  /**
   * Optional click handler — the mobile drawer (a client component) passes it
   * to dismiss itself on navigation. The desktop server panel omits it.
   */
  onClick?: () => void;
}

/**
 * Renders a link-kind menu item (`category-link`, `cms-page-link`,
 * `external-link`) with an optional icon at the requested side. Used by
 * both desktop (panel) and mobile (drawer) renderers.
 */
export function MenuLink({ item, className, onClick }: MenuLinkProps): ReactNode {
  if (!item.url) return null;
  const icon = item.icon ?? null;
  const baseClass = `inline-flex items-center gap-2 ${className ?? ''}`;
  return (
    <a href={item.url} className={baseClass} {...(onClick ? { onClick } : {})}>
      {icon && icon.position === 'left' ? (
        <img src={icon.url} alt="" className="h-4 w-4 shrink-0" />
      ) : null}
      <span>{item.label}</span>
      {icon && icon.position === 'right' ? (
        <img src={icon.url} alt="" className="h-4 w-4 shrink-0" />
      ) : null}
    </a>
  );
}
