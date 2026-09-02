import type { ReactNode } from 'react';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Read-only marker for the system-default Sales Channel (feature 005 / T039).
 *
 * The channel is identified by `systemDefault === true` (FR-002); this renders
 * the visual and nothing else.
 *
 * **There is one copy, and this is it.** A second stood at
 * `admin/src/modules/sales_channels/components/` for the length of P7a, serving
 * this module's own two screens; batch 14 moved both screens into this package,
 * they import this file, and the other one is deleted — which is what the note
 * that stood here said would happen. `EntityChannelMembership` beside it went
 * the same way one merge request earlier.
 * `admin/test/modules/sales_channels/organization-channels-zone.test.tsx`
 * asserts that no file remains at the old path, because nothing in this estate
 * compares two copies of one component.
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
