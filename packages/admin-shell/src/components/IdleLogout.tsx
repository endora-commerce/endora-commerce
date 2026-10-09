import { useEffect } from 'react';
import { useAuth } from '../lib/auth.js';

/**
 * Signs the admin out of the Admin UI after a configurable period of
 * inactivity. The timeout (in minutes) is the `admin.idle_logout_minutes`
 * setting (Settings module, General group; default 60). Pure side-effect
 * component — renders nothing and only runs while authenticated.
 *
 * The value arrives on the session (`GET /api/v1/admin/me`,
 * `idleLogoutMinutes`), which every signed-in administrator can read. It is
 * deliberately **not** read from `/api/v1/admin/settings/:code`: that endpoint
 * requires `settings:read`, so an administrator whose role lacks it got a 403
 * on every sign-in and was held to the default below whatever the operator had
 * configured.
 *
 * The timer re-arms on any user activity, so the logout fires only after a
 * continuous idle stretch. A backgrounded tab re-arms on refocus so a stale
 * timer can't fire the moment the operator returns.
 */
/**
 * Applied only when the session carries no usable value: a backend older than
 * the `idleLogoutMinutes` field omits it, and a current one answers `null`
 * when the setting cannot be resolved.
 */
const DEFAULT_IDLE_MINUTES = 60;
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
];

export function IdleLogout(): null {
  const { status, me, logout } = useAuth();
  const configured = me?.idleLogoutMinutes;
  const timeoutMinutes =
    typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_IDLE_MINUTES;

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
