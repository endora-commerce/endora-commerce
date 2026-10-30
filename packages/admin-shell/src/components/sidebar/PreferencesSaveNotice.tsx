import type { ReactNode } from 'react';
import { useAdminPreferencesStatus } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 164, FR-017 — a layout change could not be saved.
 *
 * Non-blocking and dismissible, never a dialog; once per failure episode (the
 * store decides that). The polite live region is mounted before it has text, so
 * the sentence is announced when it arrives without taking focus.
 */
export function PreferencesSaveNotice(): ReactNode {
  const t = useTranslation('core');
  const { unsavedNotice, dismissNotice } = useAdminPreferencesStatus();
  return (
    <div role="status" aria-live="polite" className="b2b-preferences-notice">
      {unsavedNotice ? (
        <Alert role="none" variant="warning" className="b2b-preferences-notice__alert">
          <AlertDescription>{t('adminPreferences.saveFailed')}</AlertDescription>
          <Button type="button" variant="ghost" size="sm" onClick={dismissNotice}>
            {t('adminPreferences.dismiss')}
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}
