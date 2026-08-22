import { z } from 'zod';
import { SettingNotRegistered, SettingOutOfScopeForChannel } from '../../../kernel/settings/settings.service.js';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import {
  CARTS_SETTING_CODES,
  DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
  DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
} from '../manifest.js';

/**
 * The two `carts.abandonment.*` reads, in one place (issue #54).
 *
 * They stood twice: once in `backend.ts`, for the composed sweep, and once in
 * the hand-built ops CLI, for the operator running it by hand. Two copies of
 * "which channel does this read name, and what does it fall back to" is
 * precisely the drift the composition checklist's item 6 is about, and this
 * pair has drifted before — both copies once passed the literal `'default'` as
 * a channel id against a `uuid` column and both fell back to `0`, which the
 * sweep reads as "sweep nothing" (feature 072, D-41/D-43).
 *
 * There is one reader now and no second copy to drift: since feature 080's
 * T042b the operator command resolves the composition's own
 * `cartAbandonmentWorker`, which this file already supplies.
 *
 * The reads are **platform-wide** (`null` channel) on purpose: an abandonment
 * threshold and an ops mailbox are properties of the platform, not of a
 * storefront. What may be absorbed is enumerated, because a bare `catch` around
 * a port call turns fail-closed into fail-open — a shape mismatch, a driver
 * error or a `ModuleDisabledError` propagates.
 */

/** Resolvers in the shape {@link CartAbandonmentWorkerDeps} asks for. */
export interface AbandonmentSettingsReaders {
  resolveInactivityMinutes: () => Promise<number>;
  resolveNotificationRecipient: () => Promise<string>;
}

/**
 * Conditions the process has already reported. Never reset, so the guard is per
 * **process**: an out-of-scope setting is a deployment fact that holds for every
 * subsequent read, and the sweep runs on a timer. One line per condition is what
 * makes it findable; one line per read is what makes it invisible. A CLI run is
 * one pass and then exits, so "once per process" is "once" there — and the warn
 * is still worth emitting, because an operator running the sweep by hand is
 * precisely the person who needs to be told the threshold did not come from the
 * setting they configured.
 */
const warnedConditions = new Set<string>();

function warnOnce(condition: string, message: string): void {
  if (warnedConditions.has(condition)) return;
  warnedConditions.add(condition);
  console.warn(message);
}

/**
 * One platform-wide read of one of this module's own settings, degrading to the
 * manifest default under exactly the two conditions D-43 allows: an
 * unregistered code (quiet — the normal state before the manifest reconciler's
 * first run) and a setting the operator scoped to specific channels (warned
 * once, because that scoping cannot be intentional for a platform-wide value).
 */
async function readPlatformSetting<T>(
  settings: SettingsReadPort,
  code: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return await settings.get(code, null, schema);
  } catch (error) {
    if (error instanceof SettingNotRegistered) return fallback;
    if (error instanceof SettingOutOfScopeForChannel) {
      warnOnce(
        `out-of-scope:${code}`,
        `[carts] setting "${code}" is scoped to specific sales channels, so it has ` +
          `no platform-wide value — falling back to the manifest default ` +
          `(logged once per process).`,
      );
      return fallback;
    }
    throw error;
  }
}

/**
 * `settings` is a thunk, not a value: in the composed module it resolves the
 * settings port on every call, and a port captured once keeps answering after
 * its owner is switched off.
 */
export function abandonmentSettingsReaders(
  settings: () => SettingsReadPort,
): AbandonmentSettingsReaders {
  return {
    resolveInactivityMinutes: async () =>
      readPlatformSetting(
        settings(),
        CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
        z.number().int().nonnegative(),
        DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
      ),
    resolveNotificationRecipient: async () =>
      readPlatformSetting(
        settings(),
        CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
        z.string(),
        DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
      ),
  };
}
