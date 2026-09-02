import type { ReactNode } from 'react';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Read-only marker for the system-default Sales Channel (feature 005 / T039).
 *
 * The channel is identified by `systemDefault === true` (FR-002); this renders
 * the visual and nothing else.
 *
 * A copy of it is still at `admin/src/modules/sales_channels/components/`,
 * serving this module's own two screens until they move into this package in
 * Phase 4's batch 14. Delete that one with the move.
 */
export function DefaultChannelBadge({
  systemDefault,
}: {
  systemDefault: boolean;
}): ReactNode {
  const t = useTranslation('sales_channels');
  if (!systemDefault) return null;
  return (
    <Badge variant="secondary" className="ml-2 text-[10px] uppercase tracking-wider">
      {t('badge.systemDefault')}
    </Badge>
  );
}
