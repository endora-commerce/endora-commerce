import { describe, expect, it, vi } from 'vitest';
import type { TransactionalEmailSender, TransactionalEmailSendInput } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { EVENT_REMINDER_DEFAULT, EVENT_REMINDER_EMAIL_CODE } from '../email-templates/event-reminder-defaults.js';
import { createEventReminderEmail, reminderEmailLanguage, type EventReminderEmailInput } from './event-reminder-email.js';

/**
 * The one e-mail this module sends: the reminder of an Event, to an
 * administrator, in their Admin UI's language
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §5a;
 * FR-139; research N-CAL6).
 *
 * What is held here is the send itself — what is asked of `transactional_emails`
 * and what every answer is turned into. That an e-mail which did not go out
 * never costs the bell entry is the sweep's, and is measured against a real
 * database in `backend/test/integration/crm/event-reminders.test.ts`.
 */

const INPUT: EventReminderEmailInput = {
  eventId: '00000000-0000-4000-8000-00000000e0e0',
  opportunityId: '00000000-0000-4000-8000-00000000c0de',
  remindAt: new Date('2026-10-12T07:00:00.000Z'),
  to: 'ada@example.test',
  preferredLanguage: 'pl',
  name: 'Demo at the warehouse',
  when: 'October 12, 2026, 10:00 AM (Europe/Warsaw)',
  number: 'OPP-000042',
};

function sending(outcome: Awaited<ReturnType<TransactionalEmailSender['send']>> | Error) {
  const sent: TransactionalEmailSendInput[] = [];
  const log = vi.fn();
  const email = createEventReminderEmail({
    sender: () => ({
      send: async (input) => {
        sent.push(input);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    }),
    log,
  });
  return { email, sent, log };
}

describe('reminderEmailLanguage', () => {
  it('is Polish for a Polish preference and English for anything else — the two the defaults are written in', () => {
    expect(reminderEmailLanguage('pl')).toBe('pl-PL');
    expect(reminderEmailLanguage('pl-PL')).toBe('pl-PL');
    expect(reminderEmailLanguage('en')).toBe('en-US');
    // No preference saved: the Admin UI renders from `preferredLanguage ?? 'en'`.
    expect(reminderEmailLanguage(null)).toBe('en-US');
    expect(reminderEmailLanguage('de')).toBe('en-US');
    expect(Object.keys(EVENT_REMINDER_DEFAULT.defaultSubject).sort()).toEqual(['en-US', 'pl-PL']);
    expect(Object.keys(EVENT_REMINDER_DEFAULT.defaultContent.languages).sort()).toEqual(['en-US', 'pl-PL']);
  });
});

describe('the event reminder e-mail', () => {
  it('asks for one message: no channel, the recipient’s language, a message id of the Event and its reminder time', async () => {
    const { email, sent, log } = sending({ status: 'sent' });
    expect(await email.send(INPUT)).toEqual({ sent: true });
    expect(sent).toEqual([
      {
        code: EVENT_REMINDER_EMAIL_CODE,
        // An administrator is not a channel's customer: the platform-wide content.
        salesChannelId: null,
        language: 'pl-PL',
        to: 'ada@example.test',
        messageId: `crm_event_reminder:${INPUT.eventId}:${INPUT.remindAt.getTime()}`,
        document: { type: 'crm_opportunity', id: INPUT.opportunityId },
        variables: {
          event: { name: 'Demo at the warehouse', when: 'October 12, 2026, 10:00 AM (Europe/Warsaw)' },
          opportunity: { number: 'OPP-000042' },
        },
        meta: { kind: EVENT_REMINDER_EMAIL_CODE, opportunityId: INPUT.opportunityId, eventId: INPUT.eventId },
      },
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('fills every variable its default templates name, and declares no other', () => {
    const named = new Set<string>();
    for (const text of [JSON.stringify(EVENT_REMINDER_DEFAULT.defaultSubject), JSON.stringify(EVENT_REMINDER_DEFAULT.defaultContent)]) {
      for (const match of text.matchAll(/\{\{(?:var|if)\s+([\w.]+)/g)) named.add(match[1] as string);
    }
    expect([...named].sort()).toEqual(['event.name', 'event.when', 'opportunity.number']);
  });

  it.each(['deactivated', 'no_transport', 'no_definition'] as const)(
    'names an outcome other than sent (%s), and says so in the log',
    async (status) => {
      const { email, log } = sending({ status });
      expect(await email.send(INPUT)).toEqual({ sent: false, reason: status });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[1]).toMatchObject({ eventId: INPUT.eventId, reason: status });
    },
  );

  it('contains a transport that throws: not sent, named, logged', async () => {
    const { email, log } = sending(new Error('smtp is away'));
    expect(await email.send(INPUT)).toEqual({ sent: false, reason: 'failed' });
    expect(log.mock.calls[0]?.[1]).toMatchObject({ reason: 'failed', error: 'smtp is away' });
  });

  it('never absorbs a module switched off — that is a presence answer, not a failed message', async () => {
    const { email } = sending(new ModuleDisabledError('transactional_emails'));
    await expect(email.send(INPUT)).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('sends nothing to nobody, and nothing where no sender is wired', async () => {
    const { email, sent } = sending({ status: 'sent' });
    expect(await email.send({ ...INPUT, to: '' })).toEqual({ sent: false, reason: 'no_address' });
    expect(sent).toEqual([]);

    const log = vi.fn();
    const unwired = createEventReminderEmail({ sender: () => undefined, log });
    expect(await unwired.send(INPUT)).toEqual({ sent: false, reason: 'no_sender' });
    expect(log.mock.calls[0]?.[1]).toMatchObject({ reason: 'no_sender' });
  });
});
