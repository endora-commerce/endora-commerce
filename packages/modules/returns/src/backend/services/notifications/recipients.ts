import { z } from 'zod';

/**
 * Who receives the *new case* e-mail (`specs/180-off-platform-complaints/` FR-A01,
 * research R-4).
 *
 * `returns.new_case_recipients` is a `string_list` setting, and the settings store
 * validates no list item — `orders.confirmation_recipients` is the precedent. So the
 * list is judged here, when the e-mail is sent: trimmed and lower-cased, each
 * address once, entries that are not an address set aside to be reported as
 * `invalid_recipient`, and at most the first {@link NEW_CASE_RECIPIENTS_MAX} kept.
 */

export const NEW_CASE_RECIPIENTS_SETTING = 'returns.new_case_recipients';
export const NEW_CASE_RECIPIENTS_MAX = 10;

export interface RecipientList {
  /** The addresses to send to, folded, each once, in the operator's order. */
  readonly recipients: string[];
  /** The entries that are not an address, as typed (trimmed). */
  readonly invalid: string[];
}

const addressSchema = z.email();

export function parseNewCaseRecipients(value: unknown): RecipientList {
  if (!Array.isArray(value)) return { recipients: [], invalid: [] };
  const recipients: string[] = [];
  const invalid: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const address = trimmed.toLowerCase();
    if (!addressSchema.safeParse(address).success) {
      invalid.push(trimmed);
      continue;
    }
    if (recipients.includes(address) || recipients.length >= NEW_CASE_RECIPIENTS_MAX) continue;
    recipients.push(address);
  }
  return { recipients, invalid };
}

/**
 * The effective list for a channel: the settings store answers the channel's value
 * where it has one and the global one otherwise (a channel's list *replaces* the
 * global, it does not add to it). `null` reads the global value.
 */
export function createNewCaseRecipientResolver(deps: {
  /** `SettingsReadPort.get`, read raw: the items are judged here, not by the store. */
  readonly settings: { get(code: string, salesChannelId: string | null, schema: z.ZodType<unknown>): Promise<unknown> };
}): (salesChannelId: string | null) => Promise<RecipientList> {
  return async (salesChannelId) =>
    parseNewCaseRecipients(await deps.settings.get(NEW_CASE_RECIPIENTS_SETTING, salesChannelId, z.unknown()));
}
