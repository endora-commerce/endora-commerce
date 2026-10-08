import type { AdminNotificationMessage, AdminNotificationRecordPort } from '@endora-commerce/contracts';
import { effectiveState, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type CrmNotificationOutcome = 'recorded' | 'not-present';

export type CrmNotificationKind =
  | 'crm.opportunity.assigned'
  | 'crm.opportunity.message'
  | 'crm.opportunity.mention'
  | 'crm.opportunity.event_reminder';

/**
 * What a bell entry says, twice over: the finished English sentence, and the
 * address of its template in this module's bundle with the params that fill it.
 *
 * An entry is one row read by several administrators, each in a language of
 * their own, so it cannot be translated when it is written
 * (`specs/conventions/module-i18n.md`): the Admin UI resolves `titleMessage`
 * in the reader's language and shows `title` whenever it cannot — this module
 * switched off, a consumer that predates the field.
 */
export interface CrmNotificationText {
  title: string;
  titleMessage: AdminNotificationMessage;
}

const message = (key: string, params: Record<string, string>): AdminNotificationMessage => ({
  scope: 'crm',
  key: `notifications.${key}.title`,
  params,
});

/**
 * Every sentence this module records in the bell, each beside its key.
 *
 * A sentence names an Opportunity **by its number** and a colleague by their
 * name, and nothing else: a bell is read outside the tenant scope, so never a
 * title and never a text. The params are held to the same rule by
 * construction — `crm-notifier.test.ts` proves that the English template
 * filled with them is the sentence, so they cannot say more than it does.
 *
 * A mention with no known author is a sentence of its own rather than the
 * other one with a blank: a template cannot drop a clause.
 *
 * **One sentence departs from that rule, and says so** (research N-CAL7, the
 * owner's open question OQ-5): the reminder of an Event names the Event and
 * when it starts, because a reminder has to say of what. Never the Event's
 * description and never the Opportunity's title — the function takes neither.
 * The recipient's reach to the Opportunity is established at the moment of
 * sending, and the name is a short line a colleague wrote in order to be shown
 * at that moment. `when` arrives already worded (`domain/event-time.ts`): a
 * bell param is a string and the bell knows nothing of the Event's zone. Two
 * keys, timed and all-day, for the reason a mention has two.
 */
export const crmNotificationText = {
  assigned: (number: string): CrmNotificationText => ({
    title: `Opportunity ${number} was assigned to you`,
    titleMessage: message('assigned', { number }),
  }),
  message: (number: string): CrmNotificationText => ({
    title: `New message on opportunity ${number}`,
    titleMessage: message('message', { number }),
  }),
  mention: (number: string, authorName: string | null): CrmNotificationText =>
    authorName === null
      ? {
          title: `You were mentioned in opportunity ${number}`,
          titleMessage: message('mention', { number }),
        }
      : {
          title: `${authorName} mentioned you in opportunity ${number}`,
          titleMessage: message('mentionByAuthor', { author: authorName, number }),
        },
  eventReminder: (event: { name: string; when: string; number: string; allDay: boolean }): CrmNotificationText => {
    const { name, when, number } = event;
    return event.allDay
      ? {
          title: `Reminder: ${name}, all day on ${when} — opportunity ${number}`,
          titleMessage: message('eventReminderAllDay', { name, when, number }),
        }
      : {
          title: `Reminder: ${name}, ${when} — opportunity ${number}`,
          titleMessage: message('eventReminder', { name, when, number }),
        };
  },
};

export interface CrmNotification extends CrmNotificationText {
  kind: CrmNotificationKind;
  /** The administrator the bell entry is for. */
  targetAdminUserId: string;
  opportunityId: string;
  /** The Event the entry is about: the link then opens the Opportunity on its Events tab, with that Event marked. */
  eventId?: string;
}

export interface CrmNotifier {
  notify(notification: CrmNotification): Promise<CrmNotificationOutcome>;
}

/**
 * Where a bell entry about an Opportunity leads: its detail screen in the
 * Admin UI — on the Events tab with one Event marked, when the entry is about
 * an Event. A tab id is part of an address (`src/admin/pages/opportunity-detail/tabs.ts`).
 */
export function opportunityLinkPath(opportunityId: string, about: { eventId?: string } = {}): string {
  const path = `/crm/opportunities/${opportunityId}`;
  return about.eventId ? `${path}?tab=events&event=${about.eventId}` : path;
}

/** The longest sentence `admin_notifications` stores as an entry's `title`. */
export const BELL_TITLE_MAX_LENGTH = 255;

/**
 * The finished sentence, cut to what a bell entry holds.
 *
 * Only a reminder can be too long — it is the one sentence that carries a text
 * somebody typed, an Event's name of up to 200 characters — and the bell
 * refuses an over-long title with an error, which for a reminder meant a claim
 * given back every minute for a day and then *missed* (research N-CALR6). The
 * cut is to the stored English sentence alone: the `titleMessage` params, which
 * are what the Admin UI words the entry from, keep the name whole.
 */
export function bellTitle(sentence: string): string {
  return sentence.length <= BELL_TITLE_MAX_LENGTH
    ? sentence
    : `${sentence.slice(0, BELL_TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Bell entries about an Opportunity, through `admin_notifications`' own port.
 *
 * That module is operator-switchable and this module only *degrades* without
 * it (the manifest's `degrades-without` edge): an assignment or a message
 * succeeds either way, and with the bell off nobody is told. So presence is
 * **decided first**, outside any `try` — a closed gate throws rather than
 * answering, and a refusal caught afterwards would be indistinguishable from a
 * defect. Nothing here catches anything.
 *
 * A function rather than an object literal at the composition site, as
 * `catalog`'s recorder is and for its reason: `check:port-catches` follows the
 * port through the value.
 */
export function createCrmNotifier(adminNotifications: AdminNotificationRecordPort): CrmNotifier {
  return {
    async notify(notification: CrmNotification): Promise<CrmNotificationOutcome> {
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      await adminNotifications.record({
        audience: 'admin_user',
        targetAdminUserId: notification.targetAdminUserId,
        kind: notification.kind,
        subjectType: 'crm_opportunity',
        subjectId: notification.opportunityId,
        title: bellTitle(notification.title),
        titleMessage: notification.titleMessage,
        linkPath: opportunityLinkPath(
          notification.opportunityId,
          notification.eventId ? { eventId: notification.eventId } : {},
        ),
      });
      return 'recorded';
    },
  };
}

/**
 * Tell somebody about a write **that has already committed**
 * (`specs/143-crm-sales-opportunities/research.md` N-R12).
 *
 * The assignment, or the message, is stored by the time anybody is told. If
 * telling fails — the bell's store, or the reach lookup that precedes it — the
 * request would answer 500 for a write that happened, and a client that
 * retries would post the message twice. So the failure is tolerated here,
 * narrowly and on purpose: it is logged and the caller goes on to answer what
 * it wrote. A module switched off is not a failure of this kind and is thrown
 * as it is.
 */
export async function tellAfterCommit(opportunityId: string, tell: () => Promise<void>): Promise<void> {
  try {
    await tell();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    console.warn('crm: a notification about a committed change could not be written', {
      opportunityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
