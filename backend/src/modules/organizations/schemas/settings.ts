import { z } from 'zod';

/**
 * Zod schemas for the two settings keys this feature introduces.
 *
 * The Settings module persists values as `unknown` (it's a generic
 * key-value store); these schemas are how the moderation service +
 * notification dispatcher coerce + validate at the read-side.
 */

export const moderationModeSchema = z.enum(['manual', 'auto']);
export type ModerationMode = z.infer<typeof moderationModeSchema>;

export const notificationRecipientsSchema = z
  .array(z.string().email().max(320))
  .max(50)
  .transform((entries) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of entries) {
      const key = raw.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(raw.trim());
    }
    return out;
  });
export type NotificationRecipients = z.infer<typeof notificationRecipientsSchema>;
