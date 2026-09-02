// Public hook — feature 019.
//
// Returns a scope-bound `t(key, params?)` function. Pass the calling
// module's id as the scope so keys are looked up against the right
// bundle (research §R3, FR-009).
//
//   const t = useTranslation('settings');
//   t('actions.save');                          // → "Save" / "Zapisz"
//   t('notifications.saved', { name: 'foo' });  // → "Saved \"foo\"."

import { useCallback } from 'react';
import { useTranslationContext } from './TranslationProvider.js';

export function useTranslation(scope: string) {
  const { t } = useTranslationContext();
  return useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      t(scope, key, params),
    [t, scope],
  );
}
