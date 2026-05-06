import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

interface EntryStatusBadgesProps {
  isDefault: boolean;
  isActive: boolean;
  translationsComplete?: boolean | null;
}

export function EntryStatusBadges({
  isDefault,
  isActive,
  translationsComplete = null,
}: EntryStatusBadgesProps): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isDefault ? <Badge variant="success">Default</Badge> : null}
      <Badge variant={isActive ? 'secondary' : 'warning'}>
        {isActive ? 'Active' : 'Inactive'}
      </Badge>
      {translationsComplete === null ? (
        <Badge variant="outline">Translations pending</Badge>
      ) : (
        <Badge variant={translationsComplete ? 'success' : 'warning'}>
          {translationsComplete ? 'Translations complete' : 'Translations partial'}
        </Badge>
      )}
    </div>
  );
}

