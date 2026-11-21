import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';

/**
 * The strip between the module's three screens — Settings, Groups, and Cache
 * & search index (issue #1550, UX audit SHELL-10).
 *
 * They are one place with three views, so they take one sidebar row and this
 * strip rather than three rows of *System* (Hick, Miller): groups are where an
 * operator goes to rearrange the settings screen, and the cache screen is the
 * maintenance drawer of the same configuration. The palette still reaches
 * every one of them directly (`open-settings`, `open-setting-groups`,
 * `clear-cache`; Principle XVI).
 *
 * The cache tab follows its route's gate, `settings:write`: an operator who
 * holds only the read code would otherwise be offered a tab that opens onto a
 * not-found screen.
 */
export const SETTINGS_TAB_PATHS = {
  settings: '/settings',
  groups: '/settings/groups',
  cache: '/settings/cache',
} as const;

export function SettingsSectionTabs({ className }: { className?: string }): ReactNode {
  const t = useTranslation('settings');
  const { hasPermission } = useAuth();
  return (
    <RouteTabs
      {...(className === undefined ? {} : { className })}
      tabs={[
        { to: SETTINGS_TAB_PATHS.settings, label: t('tabs.settings') },
        { to: SETTINGS_TAB_PATHS.groups, label: t('tabs.groups') },
        ...(hasPermission('settings:write')
          ? [{ to: SETTINGS_TAB_PATHS.cache, label: t('tabs.cache') }]
          : []),
      ]}
    />
  );
}
