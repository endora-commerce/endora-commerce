import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 180, WP-7 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2;
 * FR-061) — the "Applies immediately" badge on the heading of an organization-detail section
 * whose controls write at once (members, hierarchy, moderation, VAT validation, sales channels,
 * roles, sales representatives), so the page's one Save is not read as covering them.
 *
 * The same look as the product editor's badge (`catalog`'s `ImmediateBadge`): text, not only an
 * icon. A copy rather than an import, because that component is `catalog`'s and a module never
 * imports another module's internals (Principle I).
 */
export function ImmediateBadge(): ReactNode {
  const t = useTranslation('organizations');
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-[var(--info)]/40 bg-[var(--info-soft)] px-2 py-0.5 align-middle text-xs font-medium text-[var(--info-soft-fg)]">
      <Zap className="size-3" aria-hidden="true" />
      {t('detail.immediate.badge')}
    </span>
  );
}
