import type { TransactionalEmailSender } from '@endora-commerce/contracts';
import { configuredAdminBaseUrl, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { TASK_DIGEST_EMAIL_CODE } from '../email-templates/digest-defaults.js';
import { TASK_REMINDER_EMAIL_CODE } from '../email-templates/reminder-defaults.js';
import { TASK_DIGEST_LINK_PATH, taskLinkPath } from './task-notifier.js';

/**
 * Why a Task e-mail did not go out. Every one of them is logged and costs
 * nothing else: the bell entry, when there is one, stands.
 */
export type TaskEmailNotSentReason =
  /** No transactional sender is wired in this composition. */
  | 'no_sender'
  /** The recipient has no address. */
  | 'no_address'
  /** The operator switched the e-mail off on the templates screen. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No definition of the e-mail exists yet. */
  | 'no_definition'
  /** No mail server is configured: the message was only written to the log. */
  | 'logged'
  /** The send raised. */
  | 'failed';

export type TaskEmailResult = { sent: true } | { sent: false; reason: TaskEmailNotSentReason };

export type TaskEmailLanguage = 'en-US' | 'pl-PL';

/** One recipient, as `admin_users` describes them. */
export interface TaskEmailRecipient {
  adminUserId: string;
  to: string;
  /** The recipient's Admin UI language preference, as `admin_users` stores it. */
  preferredLanguage: string | null;
}

export interface TaskReminderEmailInput extends TaskEmailRecipient {
  /** The delivery row this message is — its message id. */
  deliveryId: string;
  taskId: string;
  number: string;
  title: string;
  /** `YYYY-MM-DD`, or `null` for a Task with no due date. */
  dueOn: string | null;
  dueAt: Date | null;
  /** `tasks.time_zone` — the calendar a due time is written in. */
  timeZone: string;
}

/** One line of a digest. */
export interface TaskDigestEntry {
  /** The Task's id — what its link into the admin panel addresses. */
  taskId: string;
  number: string;
  title: string;
  /** `YYYY-MM-DD`. */
  dueOn: string;
  dueAt: Date | null;
}

export interface TaskDigestEmailInput extends TaskEmailRecipient {
  /** `YYYY-MM-DD` in `timeZone` — the day the digest is for. */
  date: string;
  timeZone: string;
  tasks: readonly TaskDigestEntry[];
}

export interface TaskEmail {
  reminder(input: TaskReminderEmailInput): Promise<TaskEmailResult>;
  digest(input: TaskDigestEmailInput): Promise<TaskEmailResult>;
}

export interface TaskEmailDeps {
  /**
   * `transactional_emails`' late-bound sender, read per send: it answers
   * `undefined` until that module has announced it.
   */
  sender: () => TransactionalEmailSender | undefined;
  /** Where a send that did not happen is reported. */
  log: (message: string, context: Record<string, unknown>) => void;
  /**
   * The Admin UI's base address, read per send; `null` when it is not
   * configured, and the e-mail then carries no link. The platform's
   * `configuredAdminBaseUrl` unless a test injects one.
   */
  adminBaseUrl?: () => string | null;
}

/**
 * `{ adminUrl }` — the bell entry's address made absolute on `base` — or
 * nothing at all: a link is left out rather than relative, which opens nothing
 * from a mail client, and the template drops what it would have shown.
 */
function adminLink(base: string | null, path: string): { adminUrl?: string } {
  return base === null ? {} : { adminUrl: `${base}${path}` };
}

/**
 * The language a Task e-mail is written in: the recipient's Admin UI language
 * — Polish for a Polish preference, English for everything else, read by the
 * primary subtag (Projects' `stageAlertEmailLanguage`, copied).
 */
export function taskEmailLanguage(preferredLanguage: string | null): TaskEmailLanguage {
  const primary = preferredLanguage?.split('-', 1)[0]?.trim().toLowerCase();
  return primary === 'pl' ? 'pl-PL' : 'en-US';
}

/** A calendar day (`YYYY-MM-DD`) as `language` writes it — the date alone, no zone. */
export function dayWords(day: string, language: TaskEmailLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(language, { timeZone: 'UTC', dateStyle: 'long' }).format(date);
}

/** A Task's due date and time as `language` writes it, in `timeZone`; `null` with no due date. */
export function dueWords(
  due: { dueOn: string | null; dueAt: Date | null },
  language: TaskEmailLanguage,
  timeZone: string,
): string | null {
  if (due.dueAt) {
    return new Intl.DateTimeFormat(language, { timeZone, dateStyle: 'long', timeStyle: 'short' }).format(due.dueAt);
  }
  return due.dueOn ? dayWords(due.dueOn, language) : null;
}

/**
 * One Task of a digest as the template reads it: its number, its title on one
 * line, its due date in `language`, and whether it is overdue or due today —
 * the words around them are the template's, per language, so an operator
 * edits them on the templates screen and no sentence is written here.
 */
export function digestItem(
  entry: TaskDigestEntry,
  today: string,
  language: TaskEmailLanguage,
): { number: string; title: string; due: string; overdue: boolean; today: boolean } {
  return {
    number: entry.number,
    title: entry.title.replace(/\s+/g, ' ').trim(),
    due: dayWords(entry.dueOn, language),
    overdue: entry.dueOn < today,
    today: entry.dueOn >= today,
  };
}

/**
 * The reminder and digest e-mails of Tasks (`specs/165-task-management/`
 * research R-17, R-18) — Projects' `stage-alert-email.ts`, the model.
 *
 * Sent with **no Sales Channel** — an administrator is not a channel's
 * customer — and in the recipient's own language. It **answers what happened
 * and never throws for a message that did not go out**: a reminder is claimed
 * before this is tried and its e-mail is sent at most once, and a digest is
 * claimed for the day, so there is no retry to hand a failure to. A module
 * switched off is not contained: it is a presence answer about the
 * capability, not a failed message.
 *
 * A function rather than a literal at the composition site: `check:port-catches`
 * follows the port through the value.
 */
export function createTaskEmail(deps: TaskEmailDeps): TaskEmail {
  const notSent = (
    context: Record<string, unknown>,
    reason: TaskEmailNotSentReason,
    error?: unknown,
  ): TaskEmailResult => {
    deps.log('tasks: an e-mail was not sent', {
      ...context,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
    return { sent: false, reason };
  };

  const adminBaseUrl = deps.adminBaseUrl ?? (() => configuredAdminBaseUrl());

  const send = async (
    recipient: TaskEmailRecipient,
    message: {
      code: string;
      messageId: string;
      document: { type: string; id: string } | null;
      variables: (language: TaskEmailLanguage) => Record<string, unknown>;
      context: Record<string, unknown>;
    },
  ): Promise<TaskEmailResult> => {
    if (!recipient.to) return notSent(message.context, 'no_address');
    const sender = deps.sender();
    if (!sender) return notSent(message.context, 'no_sender');
    const language = taskEmailLanguage(recipient.preferredLanguage);
    try {
      const outcome = await sender.send({
        code: message.code,
        salesChannelId: null,
        language,
        to: recipient.to,
        messageId: message.messageId,
        ...(message.document ? { document: message.document } : {}),
        variables: message.variables(language),
        meta: { kind: message.code, ...message.context },
      });
      return outcome.status === 'sent' ? { sent: true } : notSent(message.context, outcome.status);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      return notSent(message.context, 'failed', error);
    }
  };

  return {
    reminder: (input) =>
      send(input, {
        code: TASK_REMINDER_EMAIL_CODE,
        // One message per delivery row — a transport asked twice for it sends it once.
        messageId: `${TASK_REMINDER_EMAIL_CODE}:${input.deliveryId}`,
        document: { type: 'task', id: input.taskId },
        variables: (language) => ({
          task: {
            number: input.number,
            title: input.title.replace(/\s+/g, ' ').trim(),
            due: dueWords(input, language, input.timeZone) ?? '',
            ...adminLink(adminBaseUrl(), taskLinkPath(input.taskId)),
          },
        }),
        context: { taskId: input.taskId, deliveryId: input.deliveryId },
      }),
    digest: (input) =>
      send(input, {
        code: TASK_DIGEST_EMAIL_CODE,
        // One message per person and day.
        messageId: `${TASK_DIGEST_EMAIL_CODE}:${input.adminUserId}:${input.date}`,
        document: null,
        variables: (language) => {
          const base = adminBaseUrl();
          const tasks = input.tasks.map((entry) => ({
            ...digestItem(entry, input.date, language),
            ...adminLink(base, taskLinkPath(entry.taskId)),
          }));
          return {
            digest: {
              ...adminLink(base, TASK_DIGEST_LINK_PATH),
              date: dayWords(input.date, language),
              taskCount: String(tasks.length),
              // One Task a line — the number, the title and the due date, no words around them.
              taskList: tasks.map((task) => `${task.number} ${task.title} — ${task.due}`).join('\n'),
              tasks,
            },
          };
        },
        context: { adminUserId: input.adminUserId, date: input.date },
      }),
  };
}
