import type { OrganizationStatus } from '@endora-commerce/contracts';
import { useTranslation } from '../../i18n/useTranslation.js';
import { cn } from '../../lib/utils.js';

export interface OrganizationStatusBadgeProps {
  status: OrganizationStatus;
  compact?: boolean;
}

/**
 * Status pill used by the OrganizationPicker (compact variant) and by the
 * Organizations list view (full variant).
 *
 * **Its labels are `core`'s** (`organizationStatusBadge.<status>`, EN + PL), for
 * the reason `CategoryTreePicker` gives: the kit never resolves a module's
 * namespace (`admin-kit-surface.md` R6). They were hard-coded English until
 * issue #1368.
 */
const STYLES: Record<OrganizationStatus, { cls: string }> = {
  pending_verification: {
    cls: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  active: {
    cls: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  blocked: {
    cls: 'bg-rose-100 text-rose-900 border-rose-300',
  },
  rejected: {
    cls: 'bg-slate-200 text-slate-700 border-slate-300',
  },
};

export function OrganizationStatusBadge(
  props: OrganizationStatusBadgeProps,
): React.ReactElement {
  const t = useTranslation('core');
  const style = STYLES[props.status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        props.compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        style.cls,
      )}
    >
      {t(`organizationStatusBadge.${props.status}`)}
    </span>
  );
}
