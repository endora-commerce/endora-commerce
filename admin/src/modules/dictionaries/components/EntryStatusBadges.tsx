import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n/useTranslation';

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
  const t = useTranslation('dictionaries');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isDefault ? <Badge variant="success">{t('badge.default')}</Badge> : null}
      <Badge variant={isActive ? 'secondary' : 'warning'}>
        {isActive ? t('badge.active') : t('badge.inactive')}
      </Badge>
      {translationsComplete === null ? (
        <Badge variant="outline">{t('badge.translationsPending')}</Badge>
      ) : (
        <Badge variant={translationsComplete ? 'success' : 'warning'}>
          {translationsComplete ? t('badge.translationsComplete') : t('badge.translationsPartial')}
        </Badge>
      )}
    </div>
  );
}

