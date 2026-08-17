import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { OrgRegistrationNotifier } from '../../../src/modules/organizations/services/org-registration-notifier.js';

/**
 * D-88 — the one live fail-open the backward hop found.
 *
 * `handleRegistered` is best-effort by design: the registration has already
 * committed when the event fires, so a downstream failure must not poison it.
 * The `catch` that implements that tolerance also absorbed
 * `ModuleDisabledError` from `admin_notifications`, which declares no
 * `activation.nonDeactivatable` — so switching that module off made every
 * organization registration silently un-notified, with `onError` swallowing the
 * 503 and nothing anywhere saying so.
 *
 * Both halves are asserted, because narrowing the wrong way is the other defect:
 * a presence answer propagates, and an ordinary failure still does not.
 */

interface Recorded {
  readonly errors: unknown[];
}

function notifier(
  record: () => Promise<void>,
): { subject: OrgRegistrationNotifier; recorded: Recorded } {
  const recorded: Recorded = { errors: [] };
  const org = { id: 'org-1', name: 'Test', status: 'active' };
  const subject = new OrgRegistrationNotifier({
    emFactory: () => ({ findOne: async () => org }) as never,
    adminNotificationService: { record } as never,
    mailer: { send: async () => undefined } as never,
    resolveRecipients: async () => [],
    onError: (err) => recorded.errors.push(err),
  });
  return { subject, recorded };
}

describe('OrgRegistrationNotifier — the presence answer is not a degrade it may choose', () => {
  it('lets a switched-off admin_notifications through instead of calling onError', async () => {
    const { subject, recorded } = notifier(() => {
      throw new ModuleDisabledError('admin_notifications');
    });

    await expect(subject.handleRegistered('org-1')).rejects.toThrow(ModuleDisabledError);
    expect(recorded.errors, 'the 503 must not be recorded as an ordinary failure').toEqual([]);
  });

  it('still absorbs an ordinary downstream failure, which is what the catch is for', async () => {
    const boom = new Error('admin_notifications table is locked');
    const { subject, recorded } = notifier(() => {
      throw boom;
    });

    await expect(subject.handleRegistered('org-1')).resolves.toBeUndefined();
    expect(recorded.errors).toEqual([boom]);
  });
});
