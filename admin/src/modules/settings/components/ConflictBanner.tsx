import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  message?: string;
  onRefresh: () => void;
}

/**
 * Surface used when the server returns 409 VERSION_CONFLICT (someone else
 * modified the setting between this client's load and save). Asks the user
 * to refresh and retry — matches the pattern used in feature 003 governance.
 */
export function ConflictBanner({ message, onRefresh }: Props): ReactNode {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-900">
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          {message ??
            'Someone else changed this setting since you opened it. Refresh to load the latest value, then re-apply your edit.'}
        </span>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </AlertDescription>
    </Alert>
  );
}
