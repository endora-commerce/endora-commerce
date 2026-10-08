import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminUserReadPort,
  AdminUserRecord,
  AuthSessionReadPort,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { eventWhen } from '../domain/event-time.js';
import type { CrmEventReminderOutcome } from '../entities/crm-opportunity-event.entity.js';
import type { AdminReach } from './admin-reach.js';
import { crmNotificationText, type CrmNotifier } from './crm-notifier.js';
import type { EventReminderEmail } from './event-reminder-email.js';
import { isActiveAdministrator } from './opportunity-assignment-service.js';

/** A reminder found due later than this is not sent: it is shown as missed. */
export const REMINDER_LATE_LIMIT_MS = 24 * 60 * 60 * 1000;

/** A claim whose delivery was not recorded within this long was interrupted, and is never tried again. */
export const REMINDER_CLAIM_STALE_MS = 10 * 60 * 1000;

/** How recently a recipient must have been seen in the Admin UI to count as there to read a bell entry. */
export const REMINDER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/** The most reminders one pass claims. The next tick takes the rest. */
export const REMINDER_BATCH_SIZE = 100;

/** What somebody must hold to be reminded: a reminder names an Event, and is a call to come and look at it. */
export const REMINDER_RECIPIENT_PERMISSION = 'crm:read';

/**
 * An Event's name as a reminder says it: on one line. A name may be saved with
 * a line break in it, and a reminder puts it in the subject of an e-mail — a
 * header — and in a one-line bell sentence (research N-CALR5).
 */
export function reminderEventName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** What a delivery came to — the stored outcome of a reminder that was claimed and settled. */
export type ReminderDeliveryOutcome = Extract<
  CrmEventReminderOutcome,
  'bell' | 'bell_email' | 'email' | 'no_recipient' | 'undeliverable'
>;

export interface EventReminderSweepSummary {
  /** Reminders found more than 24 hours late, and marked so. */
  missed: number;
  /** Claims found unrecorded after ten minutes, and marked so. */
  interrupted: number;
  /** Reminders this pass claimed. */
  claimed: number;
  /** Claims given back for the next tick: it is known that nothing was written for them. */
  released: number;
  /**
   * Claims that were no longer this pass's when their turn came — the Event
   * was deleted, or its reminder was removed or set to another time. Nothing
   * is delivered for them and nothing is recorded: the row is its editor's.
   */
  withdrawn: number;
  /** What the delivered claims came to. */
  outcomes: Record<ReminderDeliveryOutcome, number>;
}

export interface EventReminderServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `admin_users`' port — the recipient's status, address and language. Lazy, never captured. */
  adminUsers: AdminUserReadPort;
  /** Whether an administrator may reach an Organization — asked of the **recipient**. */
  canReach: AdminReach;
  /** `admin_roles`' port — whether the **recipient** still holds `crm:read`. Lazy, never captured. */
  permissions: PermissionReadPort;
  /** `auth`'s port — whether the recipient was seen in the Admin UI lately. Lazy, never captured. */
  sessions: Pick<AuthSessionReadPort, 'lastSeenByAdminUser'>;
  notifier: CrmNotifier;
  email: EventReminderEmail;
  /** Where a delivery that had to be given back is reported. */
  log: (message: string, context: Record<string, unknown>) => void;
}

/** A reminder this pass has claimed, with what its delivery needs — read in the claiming statement. */
interface ClaimedReminder {
  id: string;
  opportunityId: string;
  name: string;
  allDay: boolean;
  startsAt: Date;
  timeZone: string;
  remindAt: Date;
  createdByAdminUserId: string | null;
  number: string;
  organizationId: string;
  assignedAdminUserId: string | null;
}

interface ClaimedRow {
  id: string;
  opportunity_id: string;
  name: string;
  all_day: boolean;
  starts_at: Date;
  time_zone: string;
  remind_at: Date;
  created_by_admin_user_id: string | null;
  number: string;
  organization_id: string;
  assigned_admin_user_id: string | null;
}

/**
 * The reminders of Events, delivered by a sweep
 * (`specs/143-crm-sales-opportunities/spec.md` FR-137 – FR-141; `data-model.md`
 * § *`crm_opportunity_events`* → *Reminder states*; research N-CAL4 – N-CAL7).
 *
 * **The row is the schedule.** There is no job per reminder: a tick reads what
 * is due from the table, so an edit is an update, a delete is a delete, a
 * flushed Redis loses nothing, and closing, reopening or reassigning an
 * Opportunity needs no bookkeeping anywhere.
 *
 * **At most once, by claiming first.** One pass:
 *
 *  1. marks `missed` every reminder more than 24 hours overdue, and
 *     `interrupted` every claim still unrecorded after ten minutes;
 *  2. claims up to a hundred due reminders — `for update skip locked`, so two
 *     worker processes sweeping at once split the rows — by setting the latch
 *     and `sending`, **and commits**;
 *  3. delivers each, outside any transaction;
 *  4. records what each came to.
 *
 * A process that dies between 2 and 4 leaves a reminder that is never tried
 * again: a bell entry may already be written, and there is no way to know. The
 * one case that is given back for the next tick is the one where it *is* known
 * that nothing was written — the recipient could not be established, or the
 * bell's own write threw.
 *
 * **Nothing is delivered for a closed Opportunity, and nothing is consumed**:
 * the claim joins the Opportunity's status and takes only those of kind
 * `open`, so the reminder waits and is delivered — late, up to 24 hours — when
 * the Opportunity is reopened.
 *
 * **The recipient is read when the reminder fires** (FR-138): whoever the
 * Opportunity is assigned to at that moment; failing that the Event's creator;
 * each only if they are an active administrator who still holds `crm:read` and
 * may still reach the Opportunity's Organization — the three conditions a
 * mention is held to (`mention-service.ts`). Nobody qualifying is an outcome
 * of its own, and nothing is written anywhere.
 *
 * **A claim is this pass's only for as long as the row says so.** The claim is
 * identified by its stamp — the `reminder_handled_at` this pass wrote — and is
 * looked at again when its turn comes: an Event deleted since, or a reminder
 * removed or moved, is not delivered (FR-137). What a delivery came to is
 * recorded over `interrupted` as well as over `sending`: a pass that outlives
 * the ten minutes — a mail server that answers nobody is enough — is presumed
 * dead by the next tick, and when it turns out not to be, what it did replaces
 * the presumption. `interrupted` therefore stays only on a claim whose pass
 * never came back (research N-CALR3).
 *
 * **The bell always; an e-mail as well when the recipient is not there to see
 * it** (FR-139) — not seen in the Admin UI for five minutes, or the bell
 * switched off by the operator. An e-mail that does not go out, for whatever
 * reason, never costs the bell entry.
 *
 * It runs platform-wide by design, in the system scope its worker enters. The
 * Event rows carry no tenant column; what stands in for the tenant scope here
 * is the recipient's reach, established before anybody is told anything.
 *
 * The reminder columns are written with statements of their own, never through
 * the entity: a delivery must not move the Event's `updated_at`.
 */
export class EventReminderService {
  constructor(private readonly deps: EventReminderServiceDeps) {}

  /** One pass. `now` is the clock, handed in so that a test needs no sleep. */
  async sweep(now: Date = new Date()): Promise<EventReminderSweepSummary> {
    const summary: EventReminderSweepSummary = {
      missed: 0,
      interrupted: 0,
      claimed: 0,
      released: 0,
      withdrawn: 0,
      outcomes: { bell: 0, bell_email: 0, email: 0, no_recipient: 0, undeliverable: 0 },
    };
    Object.assign(summary, await this.#expire(now));

    const claims = await this.#claim(now);
    summary.claimed = claims.length;

    let reached = 0;
    try {
      for (; reached < claims.length; reached += 1) {
        const claim = claims[reached] as ClaimedReminder;
        try {
          await this.#handle(claim, now, summary);
        } catch (error) {
          // A module switched off under a delivery is never absorbed. The
          // claim itself is settled by then (`#handle` settles in a `finally`),
          // and the ones not reached are given back below.
          rethrowIfModuleDisabled(error);
          // Anything else concerns this one reminder and must not cost the
          // others theirs. Its claim was settled with what was known: given
          // back for the next tick if nothing had been written yet, recorded
          // as delivered by the bell if the bell entry had.
          this.deps.log('crm: delivering an event reminder raised', {
            eventId: claim.id,
            opportunityId: claim.opportunityId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      // A pass that stops early gives back what it claimed and never reached:
      // nothing was written for those, so the next tick may deliver them.
      const unreached = claims.slice(reached + 1);
      if (unreached.length > 0) {
        await this.#settle(unreached.map((claim) => claim.id), null, now);
        summary.released += unreached.length;
      }
    }
    return summary;
  }

  /**
   * Deliver one claimed reminder and settle its claim — recorded with what the
   * delivery came to, or given back (`null`) when it is known that nothing was
   * written. The settling is in a `finally`, so whatever is thrown out of here
   * leaves no claim hanging on this pass's account.
   */
  async #handle(claim: ClaimedReminder, now: Date, summary: EventReminderSweepSummary): Promise<void> {
    // Until the bell has answered, nothing has been written: `null` gives the claim back.
    let outcome: ReminderDeliveryOutcome | null = null;
    // A claim that is no longer this pass's is neither delivered nor settled.
    let withdrawn = false;
    const name = reminderEventName(claim.name);
    try {
      if (!(await this.#stillHeld(claim, now))) {
        withdrawn = true;
        summary.withdrawn += 1;
        return;
      }
      const recipient = await this.#recipientOf(claim);
      if (recipient === null) {
        outcome = 'no_recipient';
        return;
      }

      const when = eventWhen(claim);
      const bell = await this.deps.notifier.notify({
        kind: 'crm.opportunity.event_reminder',
        targetAdminUserId: recipient.id,
        opportunityId: claim.opportunityId,
        eventId: claim.id,
        ...crmNotificationText.eventReminder({ name, when, number: claim.number, allDay: claim.allDay }),
      });
      const inBell = bell === 'recorded';
      // From here on the reminder is delivered as far as the bell goes, and
      // that is what is recorded whatever becomes of the e-mail.
      outcome = inBell ? 'bell' : 'undeliverable';

      // With no bell entry to find, whether they are online decides nothing.
      const there = inBell && (await this.#seenLately(recipient.id, now));
      if (!there) {
        const mail = await this.deps.email.send({
          eventId: claim.id,
          opportunityId: claim.opportunityId,
          remindAt: claim.remindAt,
          to: recipient.email,
          preferredLanguage: recipient.preferredLanguage,
          name,
          when,
          number: claim.number,
        });
        if (mail.sent) outcome = inBell ? 'bell_email' : 'email';
      }
    } finally {
      if (!withdrawn) {
        await this.#settle([claim.id], outcome, now);
        if (outcome === null) summary.released += 1;
        else summary.outcomes[outcome] += 1;
      }
    }
  }

  /**
   * Who is reminded: the Opportunity's assignee, else the Event's creator —
   * each only if they are an active administrator who holds `crm:read` and
   * may reach the Opportunity's Organization **now**. "May no longer see the
   * Opportunity" (FR-138) is either of the last two: a role that lost the
   * permission closes the screen as surely as a lost Organization does, and a
   * reminder says more than any other bell entry of this module — the Event's
   * name.
   */
  async #recipientOf(claim: ClaimedReminder): Promise<AdminUserRecord | null> {
    const candidates = [claim.assignedAdminUserId, claim.createdByAdminUserId].filter(
      (id, index, all): id is string => id !== null && all.indexOf(id) === index,
    );
    if (candidates.length === 0) return null;
    const known = new Map((await this.deps.adminUsers.findByIds(candidates)).map((admin) => [admin.id, admin]));
    for (const id of candidates) {
      const admin = known.get(id);
      if (!isActiveAdministrator(admin)) continue;
      const held = await this.deps.permissions.listPermissions(admin.id);
      if (!held.includes('*') && !held.includes(REMINDER_RECIPIENT_PERMISSION)) continue;
      if (await this.deps.canReach(admin.id, claim.organizationId)) return admin;
    }
    return null;
  }

  /**
   * Whether the claim is still the one this pass made: the row exists and the
   * latch carries this pass's stamp. Every edit of a reminder clears the latch
   * (`opportunity-event-service.ts`), so the stamp alone says the reminder is
   * the one that was claimed — and it is a value this pass wrote, which
   * `remind_at` is not. `interrupted` counts as held: it is another tick's
   * presumption about this pass, not somebody else's claim.
   */
  async #stillHeld(claim: ClaimedReminder, claimedAt: Date): Promise<boolean> {
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(
        `select 1 as "held"
           from "crm_opportunity_events"
          where "id" = ? and "reminder_handled_at" = ?
            and "reminder_outcome" in ('sending', 'interrupted')`,
        [claim.id, claimedAt],
      )) as unknown[];
    return rows.length > 0;
  }

  /**
   * Whether the recipient has made a request to the Admin UI in the last five
   * minutes. With the Admin UI open the bell polls twice a minute, so this is
   * in practice "has it open in a browser" — which is the condition under
   * which a bell entry can be seen. It does not say anybody is looking.
   */
  async #seenLately(adminUserId: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - REMINDER_ONLINE_WINDOW_MS);
    return (await this.deps.sessions.lastSeenByAdminUser([adminUserId], since)).length > 0;
  }

  /**
   * Step 1: the reminders nobody will send any more. Both statements are
   * bookkeeping about a delivery, not a change to an Opportunity, so the
   * Command records no audit entry.
   */
  async #expire(now: Date): Promise<{ missed: number; interrupted: number }> {
    return this.deps.commandBus.run({
      action: 'crm.event_reminder.expire',
      objectType: 'crm_event_reminder',
      objectId: 'sweep',
      run: async ({ em }) => {
        const missed = (await em.execute(
          `update "crm_opportunity_events"
              set "reminder_handled_at" = ?, "reminder_outcome" = 'missed'
            where "remind_at" is not null and "reminder_handled_at" is null and "remind_at" < ?
        returning "id"`,
          [now, new Date(now.getTime() - REMINDER_LATE_LIMIT_MS)],
        )) as unknown[];
        const interrupted = (await em.execute(
          `update "crm_opportunity_events"
              set "reminder_outcome" = 'interrupted'
            where "reminder_outcome" = 'sending' and "reminder_handled_at" < ?
        returning "id"`,
          [new Date(now.getTime() - REMINDER_CLAIM_STALE_MS)],
        )) as unknown[];
        return { result: { missed: missed.length, interrupted: interrupted.length }, skipAudit: true };
      },
    });
  }

  /**
   * Step 2: claim what is due, and commit before anything is delivered. The
   * lock is on the Event rows alone — never on an Opportunity or a status row
   * — so it takes no part in the module's lock order, and `skip locked` makes
   * two passes at once split the rows instead of waiting on each other.
   */
  async #claim(now: Date): Promise<ClaimedReminder[]> {
    return this.deps.commandBus.run({
      action: 'crm.event_reminder.claim',
      objectType: 'crm_event_reminder',
      objectId: 'sweep',
      run: async ({ em }) => {
        const rows = (await em.execute(
          `select e."id", e."opportunity_id", e."name", e."all_day", e."starts_at", e."time_zone", e."remind_at",
                  e."created_by_admin_user_id", o."number", o."organization_id", o."assigned_admin_user_id"
             from "crm_opportunity_events" e
             join "crm_opportunities" o on o."id" = e."opportunity_id"
             join "crm_opportunity_statuses" s on s."code" = o."status_code" and s."kind" = 'open'
            where e."remind_at" is not null and e."reminder_handled_at" is null
              and e."remind_at" <= ? and e."remind_at" >= ?
            order by e."remind_at", e."id"
            limit ?
              for update of e skip locked`,
          [now, new Date(now.getTime() - REMINDER_LATE_LIMIT_MS), REMINDER_BATCH_SIZE],
        )) as ClaimedRow[];
        if (rows.length > 0) {
          await em.execute(
            `update "crm_opportunity_events"
                set "reminder_handled_at" = ?, "reminder_outcome" = 'sending'
              where "id" in (${rows.map(() => '?').join(', ')})`,
            [now, ...rows.map((row) => row.id)],
          );
        }
        const result = rows.map(
          (row): ClaimedReminder => ({
            id: row.id,
            opportunityId: row.opportunity_id,
            name: row.name,
            allDay: row.all_day,
            startsAt: new Date(row.starts_at),
            timeZone: row.time_zone,
            remindAt: new Date(row.remind_at),
            createdByAdminUserId: row.created_by_admin_user_id,
            number: row.number,
            organizationId: row.organization_id,
            assignedAdminUserId: row.assigned_admin_user_id,
          }),
        );
        return { result, skipAudit: true };
      },
    });
  }

  /**
   * Step 4: what the claims came to — or, for `null`, the claims given back.
   * Only a claim this pass still holds is touched — its own stamp on the
   * latch, and `sending` or the `interrupted` a later tick presumed: an Event
   * whose reminder was changed, removed or deleted meanwhile is left as its
   * editor left it.
   */
  async #settle(
    eventIds: readonly string[],
    outcome: ReminderDeliveryOutcome | null,
    claimedAt: Date,
  ): Promise<void> {
    if (eventIds.length === 0) return;
    await this.deps.commandBus.run({
      action: 'crm.event_reminder.record',
      objectType: 'crm_event_reminder',
      objectId: 'sweep',
      run: async ({ em }) => {
        const ids = eventIds.map(() => '?').join(', ');
        if (outcome === null) {
          await em.execute(
            `update "crm_opportunity_events"
                set "reminder_handled_at" = null, "reminder_outcome" = null
              where "id" in (${ids}) and "reminder_handled_at" = ?
                and "reminder_outcome" in ('sending', 'interrupted')`,
            [...eventIds, claimedAt],
          );
        } else {
          await em.execute(
            `update "crm_opportunity_events"
                set "reminder_outcome" = ?
              where "id" in (${ids}) and "reminder_handled_at" = ?
                and "reminder_outcome" in ('sending', 'interrupted')`,
            [outcome, ...eventIds, claimedAt],
          );
        }
        return { result: undefined, skipAudit: true };
      },
    });
  }
}
