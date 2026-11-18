import type { EntityManager } from '@mikro-orm/postgresql';
import type { ReturnNotificationHealth } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { RecipientList } from './recipients.js';

/**
 * Where the *new case* e-mail goes to nobody (`specs/180-off-platform-complaints/`
 * D-7, research R-22) — read by the status configuration screen, whose operator may
 * hold `returns:read` without the settings permission, and applying this module's
 * own effective-value rule (a channel's list replaces the global one, R-4) with the
 * same parser the send uses, so the warning and the send never disagree.
 *
 * The channels are the active ones: an inactive channel files no case.
 */
export async function newCaseRecipientHealth(deps: {
  readonly emFactory: () => EntityManager;
  /** `createNewCaseRecipientResolver`'s answer; `null` reads the global value. */
  readonly recipients: (salesChannelId: string | null) => Promise<RecipientList>;
}): Promise<ReturnNotificationHealth> {
  const global = await deps.recipients(null);
  const channels = await deps.emFactory().find(SalesChannel, { active: true }, { orderBy: { code: 'asc' } });
  const salesChannelIds: string[] = [];
  for (const channel of channels) {
    if ((await deps.recipients(channel.id)).recipients.length === 0) salesChannelIds.push(channel.id);
  }
  return { recipientsMissing: { global: global.recipients.length === 0, salesChannelIds } };
}
