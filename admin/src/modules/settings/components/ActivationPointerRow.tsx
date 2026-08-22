import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { SettingDto } from '@endora-commerce/contracts';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * A module's activation setting, as the Settings screen shows it after D-36a.
 *
 * It is no longer a control here. The single control moved to
 * `/platform/modules`, whose routes are kernel-resident, so that no module owns
 * the surface that toggles modules — with the control on this screen, switching
 * `settings` off took the control that would switch it back on with it.
 *
 * The row stays visible on purpose. An operator who knows a capability by the
 * name of its setting still finds it where they expect, and is told where the
 * switch went; deleting the row would make the relocation look like a loss.
 * It renders read-only for the same reason the batch save skips it: the
 * ordinary settings write path refuses activation codes outright, so a
 * saveable-looking row could only ever fail.
 */

export function ActivationPointerRow({ setting }: { setting: SettingDto }): ReactNode {
  const t = useTranslation('settings');
  // Presence is not read here on purpose: this row states where the switch is,
  // not what position it is in. The screen that owns the switch shows that.
  return (
    <div className="space-y-2 rounded-md border border-dashed px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{setting.name}</span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {t('activation.title')}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('activation.managedOnPlatformScreen')}
      </p>
      <Link
        to="/platform/modules"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-3" aria-hidden="true" />
        {t('activation.openPlatformScreen')}
      </Link>
    </div>
  );
}
