import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert.js';
import { Button } from './ui/button.js';
import { useTranslation } from '../i18n/useTranslation.js';

/**
 * Admin-side impersonation banner (T194). Presentational primitive: render
 * a sticky warning bar across the top of the admin app whenever an
 * impersonation session is active, with an explicit "End impersonation"
 * button that POSTs `/api/v1/admin/impersonation/end`.
 */
export interface ImpersonationBannerProps {
  customerLabel: string;
  onEnd: () => void | Promise<void>;
}

export function ImpersonationBanner({ customerLabel, onEnd }: ImpersonationBannerProps): ReactNode {
  const t = useTranslation('core');
  return (
    <Alert variant="warning" className="flex items-start justify-between gap-4">
      <ShieldAlert className="size-4" />
      <div className="flex-1">
        <AlertTitle>{t('appShell.impersonation.title', { customer: customerLabel })}</AlertTitle>
        <AlertDescription>
          {t('appShell.impersonation.notice')}
        </AlertDescription>
      </div>
      <Button variant="outline" size="sm" onClick={(): void => void onEnd()}>
        {t('appShell.impersonation.end')}
      </Button>
    </Alert>
  );
}
