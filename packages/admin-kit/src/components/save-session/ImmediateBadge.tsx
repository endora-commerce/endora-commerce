/**
 * The "Applies immediately" badge (feature 180, #407; FR-061; feature 174 FR-070 drew it first).
 *
 * On the heading of a section whose controls write at once as their own audited operations,
 * outside the page's one Save, so that Save is not read as covering them. Text, not only an
 * icon. One component rather than a copy per module: `catalog`, `customers`, `organizations`
 * and `inventory` each used to carry their own, with their own string, and the copy lives in the
 * `core` bundle because it belongs to no module.
 *
 * `className` places it (it carries a leading margin for sitting after a heading's text); it is
 * merged last, so a caller's margin replaces the badge's own.
 */
import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';

import { useTranslation } from '../../i18n/useTranslation.js';
import { cn } from '../../lib/utils.js';

export interface ImmediateBadgeProps {
  readonly className?: string;
}

export function ImmediateBadge({ className }: ImmediateBadgeProps): ReactNode {
  const t = useTranslation('core');
  return (
    <span
      className={cn(
        'ml-2 inline-flex items-center gap-1 rounded-md border border-[var(--info)]/40 bg-[var(--info-soft)] px-2 py-0.5 text-xs font-medium text-[var(--info-soft-fg)]',
        className,
      )}
    >
      <Zap className="size-3" aria-hidden="true" />
      {t('saveSession.immediateBadge')}
    </span>
  );
}
