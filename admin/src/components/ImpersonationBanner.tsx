import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
  return (
    <Alert variant="warning" className="flex items-start justify-between gap-4">
      <ShieldAlert className="size-4" />
      <div className="flex-1">
        <AlertTitle>Impersonating {customerLabel}</AlertTitle>
        <AlertDescription>
          Every action you take is audit-logged against your admin account.
        </AlertDescription>
      </div>
      <Button variant="outline" size="sm" onClick={(): void => void onEnd()}>
        End impersonation
      </Button>
    </Alert>
  );
}
