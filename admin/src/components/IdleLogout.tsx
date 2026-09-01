import { useEffect, useState } from 'react';
import type { SettingDto } from '@endora-commerce/contracts';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

/**
 * Signs the admin out of the Admin UI after a configurable period of
 * inactivity. The timeout (in minutes) comes from the `admin.idle_logout_minutes`
 * setting (Settings module, General group; default 60). Pure side-effect
 * component — renders nothing and only runs while authenticated.
 *
 * The timer re-arms on any user activity, so the logout fires only after a
 * continuous idle stretch. A backgrounded tab re-arms on refocus so a stale
 * timer can't fire the moment the operator returns.
 */
const DEFAULT_IDLE_MINUTES = 60;
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
];

/**
 * Read one setting by code (feature 091, P6).
 *
 * The request is built here rather than through `settings`' own admin API
 * client: that client is a module's **code**, which is what
 * `backend/scripts/ledgers/cross-module-imports/host.ts` recorded, while
 * `/api/v1/admin/settings/:code` and `SettingDto` are an HTTP path and a
 * `@endora-commerce/contracts` type the admin application already compiles.
 * That is the exit P2 established and `admin-kit-surface.md` R6 records.
 */
function readSetting(code: string): Promise<SettingDto> {
  return apiClient.get<SettingDto>(`/api/v1/admin/settings/${encodeURIComponent(code)}`);
}

export function IdleLogout(): null {
  const { status, logout } = useAuth();
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(DEFAULT_IDLE_MINUTES);

  // Load the configured timeout once per authenticated session. On any failure
  // (setting missing, network error) we keep the 60-minute default.
  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let cancelled = false;
    readSetting('admin.idle_logout_minutes')
      .then((dto) => {
        if (cancelled) return;
        const raw = dto.globalValue ?? dto.defaultValue;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) setTimeoutMinutes(n);
      })
      .catch(() => {
        /* keep the default */
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    const idleMs = timeoutMinutes * 60_000;
    let timer: ReturnType<typeof setTimeout>;

    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void logout();
      }, idleMs);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') arm();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, arm, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    arm();

    return () => {
      clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, arm);
      }
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, timeoutMinutes, logout]);

  return null;
}
