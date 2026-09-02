import type { OrganizationStatus } from '@endora-commerce/contracts';
import { cn } from '../../lib/utils.js';

export interface OrganizationStatusBadgeProps {
  status: OrganizationStatus;
  compact?: boolean;
}

/**
 * Status pill used by the OrganizationPicker (compact variant) and by the
 * Organizations list view (full variant).
 *
 * Labels are PL/EN i18n strings landed by feature 021 — for the
 * foundational layer we ship English defaults and let the admin i18n
 * bundle (US1 T050) populate translations.
 */
const STYLES: Record<OrganizationStatus, { label: string; cls: string }> = {
  pending_verification: {
    label: 'Pending',
    cls: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  active: {
    label: 'Active',
    cls: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  blocked: {
    label: 'Blocked',
    cls: 'bg-rose-100 text-rose-900 border-rose-300',
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-slate-200 text-slate-700 border-slate-300',
  },
};

export function OrganizationStatusBadge(
  props: OrganizationStatusBadgeProps,
): React.ReactElement {
  const style = STYLES[props.status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        props.compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        style.cls,
      )}
    >
      {style.label}
    </span>
  );
}
