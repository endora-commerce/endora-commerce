import type { EventBus } from '../../../events/bus.js';
import type { SettingsCache } from './settings-cache.js';

/**
 * SettingsCacheInvalidator — feature 004 / US3 (T051).
 *
 * Subscribes to the platform EventBus and drops cache entries whenever the
 * admin service emits a value or group change. Lives for the process
 * lifetime; the returned `dispose` unsubscribes for tests that want a
 * deterministic teardown.
 */

export interface SettingsCacheInvalidatorHandle {
  dispose: () => void;
}

interface ValueChangedPayload {
  settingCode: string;
}

export function attachSettingsCacheInvalidator(
  eventBus: EventBus,
  cache: SettingsCache,
): SettingsCacheInvalidatorHandle {
  const offValue = eventBus.on(
    'settings.value_changed',
    async (payload: unknown) => {
      const { settingCode } = (payload as ValueChangedPayload) ?? {};
      if (settingCode) {
        await cache.invalidate(settingCode);
      }
    },
  );
  const offGroup = eventBus.on(
    'settings.group_changed',
    async (_payload: unknown) => {
      // A group change can move settings between groups (only `general` on
      // delete) or rescope channels — both of which can change resolution
      // for any number of codes. Cheapest correct invalidation is the full
      // namespace; the cost is bounded by the universe of registered
      // settings (low hundreds per the plan).
      await cache.invalidateAll();
    },
  );

  return {
    dispose() {
      offValue();
      offGroup();
    },
  };
}
