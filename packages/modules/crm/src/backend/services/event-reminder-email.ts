import type { TransactionalEmailSender } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { EVENT_REMINDER_EMAIL_CODE } from '../email-templates/event-reminder-defaults.js';

/**
 * Why the reminder e-mail did not go out. Every one of them is logged and
 * costs nothing else: the bell entry, when there is one, stands (FR-139).
 */
export type EventReminderEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** The recipient has no address. */
  | 'no_address'
  /** The operator switched the reminder e-mail off on the templates screen. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No `crm_event_reminder` definition exists yet. */
  | 'no_definition'
  /** The send raised. */
  | 'failed';

export type EventReminderEmailResult = { sent: true } | { sent: false; reason: EventReminderEmailNotSentReason };

export interface EventReminderEmailInput {
  eventId: string;
  opportunityId: string;
  /** The reminder time this message is for: an Event armed again gets a message id of its own. */
  remindAt: Date;
  to: string;
  /** The recipient's Admin UI language preference, as `admin_users` stores it. */
  preferredLanguage: string | null;
  /** The Event's name. */
  name: string;
  /** When the Event starts, already worded (`domain/event-time.ts`). */
  when: string;
  /** The Opportunity's number. */
  number: string;
}

export interface EventReminderEmail {
  send(input: EventReminderEmailInput): Promise<EventReminderEmailResult>;
}

export interface EventReminderEmailDeps {
  /**
   * `transactional_emails`' late-bound sender, read per send: it answers
   * `undefined` until that module has announced it.
   */
  sender: () => TransactionalEmailSender | undefined;
  /** Where a send that did not happen is reported. */
  log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * The language a reminder e-mail is written in: the recipient's Admin UI
 * language. An administrator's preference is `en`, `pl` or none saved, and the
 * Admin UI draws itself from `preferredLanguage ?? 'en'`; the shipped defaults
 * exist in `en-US` and `pl-PL`. So Polish for a Polish preference and English
 * for everything else, read by the primary subtag as the platform reads it.
 */
export function reminderEmailLanguage(preferredLanguage: string | null): 'en-US' | 'pl-PL' {
  const primary = preferredLanguage?.split('-', 1)[0]?.trim().toLowerCase();
  return primary === 'pl' ? 'pl-PL' : 'en-US';
}

/**
 * The reminder of an Event, as an e-mail to one administrator
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §5a).
 *
 * Sent with **no Sales Channel** — an administrator is not a channel's
 * customer, so the platform-wide content and branding apply — and in the
 * recipient's own language, which no other templated e-mail of the platform
 * to an administrator is.
 *
 * **It answers what happened and never throws for a message that did not go
 * out**: the caller has a bell entry to stand by, and a reminder is delivered
 * at most once, so there is no retry to hand a failure to. The one thing it
 * does not contain is a module switched off, which is a presence answer about
 * the capability and not a failed message.
 *
 * A function rather than a literal at the composition site, as the notifier is
 * and for its reason: `check:port-catches` follows the port through the value.
 */
export function createEventReminderEmail(deps: EventReminderEmailDeps): EventReminderEmail {
  const notSent = (
    input: EventReminderEmailInput,
    reason: EventReminderEmailNotSentReason,
    error?: unknown,
  ): EventReminderEmailResult => {
    deps.log('crm: the event reminder e-mail was not sent', {
      opportunityId: input.opportunityId,
      eventId: input.eventId,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
    return { sent: false, reason };
  };

  return {
    async send(input: EventReminderEmailInput): Promise<EventReminderEmailResult> {
      if (!input.to) return notSent(input, 'no_address');
      const sender = deps.sender();
      if (!sender) return notSent(input, 'no_sender');
      try {
        const outcome = await sender.send({
          code: EVENT_REMINDER_EMAIL_CODE,
          salesChannelId: null,
          language: reminderEmailLanguage(input.preferredLanguage),
          to: input.to,
          // One message per Event and reminder time: a transport that is asked
          // twice for the same one sends it once.
          messageId: `${EVENT_REMINDER_EMAIL_CODE}:${input.eventId}:${input.remindAt.getTime()}`,
          document: { type: 'crm_opportunity', id: input.opportunityId },
          variables: {
            event: { name: input.name, when: input.when },
            opportunity: { number: input.number },
          },
          meta: { kind: EVENT_REMINDER_EMAIL_CODE, opportunityId: input.opportunityId, eventId: input.eventId },
        });
        return outcome.status === 'sent' ? { sent: true } : notSent(input, outcome.status);
      } catch (error) {
        // A switched-off module is an answer about the whole capability, not a
        // message that failed to go out.
        rethrowIfModuleDisabled(error);
        // Everything else is contained, and named: the reminder was claimed
        // before this was tried, and its bell entry must not be lost to a mail
        // server that is away.
        return notSent(input, 'failed', error);
      }
    },
  };
}
