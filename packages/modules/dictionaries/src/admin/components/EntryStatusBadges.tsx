import type { ReactNode } from 'react';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
interface EntryStatusBadgesProps {
  isDefault: boolean;
  isActive: boolean;
  translationsComplete?: boolean | null;
  /**
   * Whether the entry has translations to report on at all. An inactive
   * language has none — nothing serves it and a label cannot be saved in it —
   * so its row says "inactive" and stops, rather than "translations pending"
   * for a hundred and eighty languages nobody is waiting on.
   */
  showTranslations?: boolean;
}

export function EntryStatusBadges({
  isDefault,
  isActive,
  translationsComplete = null,
  showTranslations = true,
}: EntryStatusBadgesProps): ReactNode {
  const t = useTranslation('dictionaries');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isDefault ? <Badge variant="success">{t('badge.default')}</Badge> : null}
      <Badge variant={isActive ? 'secondary' : 'warning'}>
        {isActive ? t('badge.active') : t('badge.inactive')}
      </Badge>
      {!showTranslations ? null : translationsComplete === null ? (
        <Badge variant="outline">{t('badge.translationsPending')}</Badge>
      ) : (
        <Badge variant={translationsComplete ? 'success' : 'warning'}>
          {translationsComplete ? t('badge.translationsComplete') : t('badge.translationsPartial')}
        </Badge>
      )}
    </div>
  );
}

