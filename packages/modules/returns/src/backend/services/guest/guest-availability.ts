import { z } from 'zod';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { RETURNS_SETTING_CODES } from '../../../manifest.js';

/**
 * Whether complaints from guests are in effect on a sales channel
 * (`specs/181-guest-complaints/` FR-001, FR-002, research R-12): *Complaints from guests*
 * **and** 180's *Complaints without a platform order*, both read for the request's
 * resolved channel (Principle XII). It fails closed: an unreadable setting is off, and
 * the guest setting alone never opens anything.
 *
 * Evaluated inside an active module — the module's off state always wins, because every
 * guest route is registered through `ctx.routes` and is absent while `returns` is off.
 */
export interface GuestAvailability {
  enabled(salesChannelId: string): Promise<boolean>;
}

export function createGuestAvailability(settings: Pick<SettingsReadPort, 'get'>): GuestAvailability {
  const flag = async (code: string, salesChannelId: string): Promise<boolean> => {
    try {
      return await settings.get(code, salesChannelId, z.boolean());
    } catch {
      return false;
    }
  };
  return {
    async enabled(salesChannelId) {
      const [offPlatform, guests] = await Promise.all([
        flag(RETURNS_SETTING_CODES.OFF_PLATFORM_COMPLAINTS_ENABLED, salesChannelId),
        flag(RETURNS_SETTING_CODES.GUEST_COMPLAINTS_ENABLED, salesChannelId),
      ]);
      return offPlatform && guests;
    },
  };
}
