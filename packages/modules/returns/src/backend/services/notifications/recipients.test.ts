import { describe, expect, it, vi } from 'vitest';
import {
  NEW_CASE_RECIPIENTS_MAX,
  createNewCaseRecipientResolver,
  parseNewCaseRecipients,
} from './recipients.js';

/**
 * `specs/180-off-platform-complaints/` T014 (FR-A01, research R-4): the new-case
 * recipients are validated when the e-mail is sent, not when the setting is saved.
 */
describe('parseNewCaseRecipients', () => {
  it('trims, lower-cases and de-duplicates', () => {
    expect(parseNewCaseRecipients(['  Shop@Example.TEST ', 'shop@example.test', 'b@shop.example'])).toEqual({
      recipients: ['shop@example.test', 'b@shop.example'],
      invalid: [],
    });
  });

  it('skips an entry that is not an address and reports it as invalid', () => {
    expect(parseNewCaseRecipients(['a@shop.example', 'not-an-address', '', 'b@shop.example'])).toEqual({
      recipients: ['a@shop.example', 'b@shop.example'],
      invalid: ['not-an-address'],
    });
  });

  it(`keeps the first ${NEW_CASE_RECIPIENTS_MAX} addresses`, () => {
    const list = Array.from({ length: 12 }, (_, i) => `r${i}@shop.example`);
    const { recipients } = parseNewCaseRecipients(list);
    expect(NEW_CASE_RECIPIENTS_MAX).toBe(10);
    expect(recipients).toEqual(list.slice(0, 10));
  });

  it('answers an empty list for a value that is not a list of strings', () => {
    expect(parseNewCaseRecipients(undefined)).toEqual({ recipients: [], invalid: [] });
    expect(parseNewCaseRecipients('a@shop.example')).toEqual({ recipients: [], invalid: [] });
    expect(parseNewCaseRecipients([42, 'a@shop.example'])).toEqual({ recipients: ['a@shop.example'], invalid: [] });
  });
});

describe('createNewCaseRecipientResolver', () => {
  const GLOBAL = ['global@shop.example'];
  const CHANNEL = 'ch-1';
  const settings = {
    // The settings store's own rule: a channel value replaces the global one.
    get: vi.fn(async (_code: string, salesChannelId: string | null) =>
      salesChannelId === CHANNEL ? ['channel@shop.example'] : GLOBAL,
    ),
  };

  it('reads returns.new_case_recipients for the case’s channel, so the channel value wins', async () => {
    const resolve = createNewCaseRecipientResolver({ settings });
    expect((await resolve(CHANNEL)).recipients).toEqual(['channel@shop.example']);
    expect(settings.get).toHaveBeenCalledWith('returns.new_case_recipients', CHANNEL, expect.anything());
  });

  it('falls back to the global value for a channel without one', async () => {
    const resolve = createNewCaseRecipientResolver({ settings });
    expect((await resolve('ch-other')).recipients).toEqual(GLOBAL);
    expect((await resolve(null)).recipients).toEqual(GLOBAL);
  });
});
