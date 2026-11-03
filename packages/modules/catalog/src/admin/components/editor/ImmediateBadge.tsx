import type { ReactNode } from 'react';
import { Lock, Zap } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 170 (FR-070, `contracts/editor-ui.md` §3 and §11) — one visible "Applies immediately"
 * badge on the heading of a section whose controls run at once as their own audited Commands
 * (structural operations, price-book rows, membership, stock). Text, not only an icon.
 */
export function ImmediateBadge(): ReactNode {
  const t = useTranslation('catalog');
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-[var(--info)]/40 bg-[var(--info-soft)] px-2 py-0.5 text-xs font-medium text-[var(--info-soft-fg)]">
      <Zap className="size-3" aria-hidden="true" />
      {t('productEditor.immediate.badge')}
    </span>
  );
}

/** The heading badge of a structural section outside Global: the set itself is Global only. */
export function GlobalOnlyBadge({ label }: { label: string }): ReactNode {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
      <Lock className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A section heading carrying the right badge for the scope. */
export function SectionHeading({
  id,
  title,
  immediate,
  globalOnlyLabel,
}: {
  id?: string;
  title: string;
  /** The section's structural controls are rendered (Global, `catalog:write`). */
  immediate: boolean;
  /** Shown outside Global instead of the immediate badge. */
  globalOnlyLabel?: string | undefined;
}): ReactNode {
  return (
    <h3 id={id} className="flex flex-wrap items-center text-base font-semibold">
      {title}
      {immediate ? <ImmediateBadge /> : globalOnlyLabel ? <GlobalOnlyBadge label={globalOnlyLabel} /> : null}
    </h3>
  );
}
