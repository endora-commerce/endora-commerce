import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 180, WP-8 (FR-061) — the "Applies immediately" badge on the heading of a customer-detail
 * section whose controls run at once as their own writes, outside the page's one Save (block,
 * password and two-step resets, impersonation, delete and restore, organization and customer-group
 * assignment). Text, not only an icon. The look is the product editor's badge (feature 174); the
 * string is this module's own, since a module does not render another's internals.
 */
export function ImmediateBadge(): ReactNode {
  const t = useTranslation('customers');
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-[var(--info)]/40 bg-[var(--info-soft)] px-2 py-0.5 text-xs font-medium text-[var(--info-soft-fg)]">
      <Zap className="size-3" aria-hidden="true" />
      {t('detail.immediate.badge')}
    </span>
  );
}
