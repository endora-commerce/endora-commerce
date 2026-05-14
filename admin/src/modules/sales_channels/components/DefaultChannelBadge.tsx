import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * DefaultChannelBadge — feature 005 / T039.
 *
 * Read-only marker rendered next to the `Default` Sales Channel in
 * lists / detail headers so operators can spot it at a glance. The
 * channel itself is identified by `systemDefault === true` (FR-002);
 * this component just renders the visual.
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
