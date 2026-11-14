import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { addDays, todayIn } from '../domain/deadline.js';
import type { ProjectStageAlertOutcome } from '../entities/project-stage-alert-delivery.entity.js';
import type { ProjectAccess } from './project-access.js';
import { projectNotificationText, type ProjectNotifier } from './project-notifier.js';
import type { StageAlertEmail } from './stage-alert-email.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';

/** Alerts are claimed from this hour, local time in the alert zone, on their due day (research R-12). */
export const STAGE_ALERT_SEND_HOUR = 8;

/** The most alerts one pass claims. The next tick — fifteen minutes later — takes the rest. */
export const STAGE_ALERT_BATCH_SIZE = 100;

/**
 * A claim still unsettled this long after it was made was interrupted — its
 * pass died between the claim and the settle — and is marked so (issue #462,
 * CRM's `REMINDER_CLAIM_STALE_MS`). Two ticks of the fifteen-minute clock: a
 * pass still delivering by then is presumed dead, and when it turns out not to
 * be, what it settles replaces the presumption.
 */
export const STAGE_ALERT_CLAIM_STALE_MS = 30 * 60 * 1000;

/** The day an alert `offsetDays` before `deadlineOn` is due. */
export function alertDueOn(deadlineOn: string, offsetDays: number): string {
  return addDays(deadlineOn, -offsetDays);
}

/** "Today" in the alert zone, and whether alerts are sent yet today. */
export interface StageAlertClock {
  /** `YYYY-MM-DD` in the alert zone. */
  today: string;
  /** Whether the local time is past {@link STAGE_ALERT_SEND_HOUR}:00. */
  sending: boolean;
}

/** The alert clock at `now` in `timeZone`. Throws `RangeError` for a zone that is not one. */
export function stageAlertClock(timeZone: string, now: Date): StageAlertClock {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .find((part) => part.type === 'hour')?.value,
  );
  return { today: todayIn(timeZone, now), sending: hour >= STAGE_ALERT_SEND_HOUR };
}

/** How one alert's delivery went, counted over its recipients. */
export interface StageAlertTally {
  /** Members who may see the Project, and so were addressed. */
  recipients: number;
  /** Bell entries written. */
  bell: number;
  /** E-mails handed to the transport. */
  email: number;
}

/** What a delivered alert came to — the outcome settled on its row. */
export function stageAlertOutcome(tally: StageAlertTally): StageAlertDeliveryOutcome {
  if (tally.recipients === 0) return 'no_recipient';
  if (tally.bell > 0) return tally.email > 0 ? 'bell_email' : 'bell';
  return tally.email > 0 ? 'email' : 'undeliverable';
}

/** An alert this pass claimed, with what its delivery needs — read in the claiming statement. */
export interface ClaimedStageAlert {
  /** The delivery row's id. */
  id: string;
  stageId: string;
  offsetDays: number;
  /** `YYYY-MM-DD` — the deadline the alert is for. */
  deadlineOn: string;
  projectId: string;
  projectNumber: string;
  stageName: string;
}

/** The table side of the sweep — {@link StageAlertStore}; an interface so the state machine is testable alone. */
export interface StageAlertStorePort {
  hasSweepWork(clock: StageAlertClock, now: Date): Promise<boolean>;
  /** Mark `interrupted` every claim unsettled past {@link STAGE_ALERT_CLAIM_STALE_MS}; answers their ids. */
  expire(now: Date): Promise<string[]>;
  claim(clock: StageAlertClock, now: Date): Promise<ClaimedStageAlert[]>;
  stillDue(claim: ClaimedStageAlert): Promise<boolean>;
  memberIdsOf(projectId: string): Promise<string[]>;
  settle(id: string, outcome: StageAlertDeliveryOutcome, recipientCount: number, now: Date): Promise<void>;
  release(ids: readonly string[]): Promise<void>;
}

/**
 * The alerts due today: an open Project, its **current** Stage, a deadline,
 * an offset of that Stage that puts the due day on `today`, and no delivery
 * row for that (Stage, offset, deadline) yet — **the one statement of it**,
 * read by the claim to act and by the probe to ask whether there is anything
 * to act on, so the two cannot drift.
 *
 * Only today's due day is ever claimed, never a past one: a Stage entered
 * after its alert day, or a deadline moved so that its alert day is gone,
 * sends nothing backdated (US8 sc.5). A deadline moved to a day not yet
 * alerted is a new key, and re-arms the alert (US8 sc.3). The range on
 * `deadline_on` (offsets are 1–365) lets the deadline index narrow the read.
 */
function dueAlerts(today: string): WorkRows {
  return {
    from: `from "project_stages" s
             join "projects" p on p."id" = s."project_id"
             cross join lateral unnest(s."alert_offsets_days") as a("offset_days")
            where p."state" = 'open' and p."current_stage_id" = s."id"
              and s."deadline_on" between (?::date + 1) and (?::date + 365)
              and s."deadline_on" - a."offset_days" = ?::date
              and not exists (select 1 from "project_stage_alert_deliveries" d
                               where d."stage_id" = s."id" and d."offset_days" = a."offset_days"
                                 and d."deadline_on" = s."deadline_on")`,
    params: [today, today, today],
  };
}

/**
 * Claimed, and still unsettled after {@link STAGE_ALERT_CLAIM_STALE_MS}: marked
 * `interrupted` — the one statement of it, read by the pass and by the probe.
 * The partial index on `claimed_at` where `outcome is null` keeps it a lookup.
 */
function interruptedClaims(now: Date): WorkRows & { where: string } {
  const where = `"outcome" is null and "claimed_at" < ?`;
  return {
    where,
    from: `from "project_stage_alert_deliveries" where ${where}`,
    params: [new Date(now.getTime() - STAGE_ALERT_CLAIM_STALE_MS)],
  };
}

interface ClaimedRow {
  id: string;
  stage_id: string;
  offset_days: number;
  deadline_on: string;
  project_id: string;
  number: string;
  stage_name: string;
}

/**
 * The sweep's statements over `project_stage_alert_deliveries` and the Stage
 * and Project rows behind them. Platform-wide by design, in the system scope
 * the worker enters: who may be told is decided per recipient afterwards,
 * through `ProjectAccess.canSeeAs` (`PROJECT_ACCESS_READERS` names this file).
 *
 * Delivery bookkeeping, not a change to a Project: every write runs through the
 * Command Bus with no audit entry, as CRM's reminder sweep does.
 */
export class StageAlertStore implements StageAlertStorePort {
  constructor(
    private readonly deps: {
      emFactory: () => EntityManager;
      commandBus: CommandBus;
    },
  ) {}

  /**
   * Whether a pass at `clock` would claim anything — **yes or no, and nothing
   * else** (issue #120). The worker asks this before it opens its system scope,
   * so a tick with nothing due writes no `tenant.escape_hatch` audit row. It
   * runs with no tenant context, and what keeps that legitimate is that it
   * learns one bit, through `anyRowExists`, over the claim's own row source.
   */
  async hasSweepWork(clock: StageAlertClock, now: Date): Promise<boolean> {
    if (!clock.sending) return false;
    return anyRowExists(this.deps.emFactory(), [interruptedClaims(now), dueAlerts(clock.today)]);
  }

  /**
   * The claims nobody will settle any more (issue #462): unsettled
   * {@link STAGE_ALERT_CLAIM_STALE_MS} after they were made, so their pass died
   * between claim and settle. They are marked `interrupted` and never retried —
   * a bell entry or an e-mail may already have gone out, and there is no way to
   * know. `settled_at` stays empty: nobody settled them.
   */
  async expire(now: Date): Promise<string[]> {
    const stale = interruptedClaims(now);
    return this.deps.commandBus.run({
      action: 'projects.stage_alert.expire',
      objectType: 'project_stage_alert',
      objectId: 'sweep',
      run: async ({ em }) => {
        const rows = (await em.execute(
          `update "project_stage_alert_deliveries" set "outcome" = 'interrupted'
            where ${stale.where}
        returning "id"`,
          [...stale.params],
        )) as Array<{ id: string }>;
        return { result: rows.map((row) => row.id), skipAudit: true };
      },
    });
  }

  /**
   * Claim what is due today, and commit before anything is delivered. The
   * claim **is** the insert — `on conflict do nothing` over the unique
   * (Stage, offset, deadline) key — so two passes at once claim each alert
   * once: the second insert waits on the first's row and then inserts nothing.
   */
  async claim(clock: StageAlertClock, now: Date): Promise<ClaimedStageAlert[]> {
    if (!clock.sending) return [];
    const due = dueAlerts(clock.today);
    return this.deps.commandBus.run({
      action: 'projects.stage_alert.claim',
      objectType: 'project_stage_alert',
      objectId: 'sweep',
      run: async ({ em }) => {
        const rows = (await em.execute(
          `with "due" as (
             select s."id" as "stage_id", a."offset_days", s."deadline_on"
               ${due.from}
              order by s."deadline_on", s."id", a."offset_days"
              limit ?
           ), "claimed" as (
             insert into "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on", "claimed_at")
             select "stage_id", "offset_days", "deadline_on", ? from "due"
             on conflict ("stage_id", "offset_days", "deadline_on") do nothing
             returning "id", "stage_id", "offset_days", "deadline_on"
           )
           select c."id", c."stage_id", c."offset_days", to_char(c."deadline_on", 'YYYY-MM-DD') as "deadline_on",
                  p."id" as "project_id", p."number", s."name" as "stage_name"
             from "claimed" c
             join "project_stages" s on s."id" = c."stage_id"
             join "projects" p on p."id" = s."project_id"
            order by c."deadline_on", c."stage_id", c."offset_days"`,
          [...due.params, STAGE_ALERT_BATCH_SIZE, now],
        )) as ClaimedRow[];
        const result = rows.map(
          (row): ClaimedStageAlert => ({
            id: row.id,
            stageId: row.stage_id,
            offsetDays: Number(row.offset_days),
            deadlineOn: row.deadline_on,
            projectId: row.project_id,
            projectNumber: row.number,
            stageName: row.stage_name,
          }),
        );
        return { result, skipAudit: true };
      },
    });
  }

  /**
   * Whether a claim still stands when its delivery begins — the Project open,
   * the Stage still its current one, the deadline the one claimed and the
   * offset still among the Stage's alerts (CRM's `#stillHeld` shape, T144 F5).
   * A Stage left or a deadline moved in the moment between the claim and the
   * delivery sends nothing.
   */
  async stillDue(claim: ClaimedStageAlert): Promise<boolean> {
    const rows = (await this.deps.emFactory().execute(
      `select 1 as "due" from "project_stages" s join "projects" p on p."id" = s."project_id"
        where s."id" = ? and p."state" = 'open' and p."current_stage_id" = s."id"
          and s."deadline_on" = ?::date and ? = any(s."alert_offsets_days")`,
      [claim.stageId, claim.deadlineOn, claim.offsetDays],
    )) as unknown[];
    return rows.length > 0;
  }

  /** The Members of a Project a claim names — by that id only. */
  async memberIdsOf(projectId: string): Promise<string[]> {
    const rows = (await this.deps
      .emFactory()
      .execute(
        `select pm."admin_user_id" from "project_members" pm where pm."project_id" = ? order by pm."admin_user_id"`,
        [projectId],
      )) as Array<{ admin_user_id: string }>;
    return rows.map((row) => row.admin_user_id);
  }

  /**
   * What a claim came to. Only an unsettled claim is touched — or one a later
   * pass presumed `interrupted`: a pass that outlived the bound is not dead
   * after all, and what it delivered replaces the presumption (CRM's rule).
   */
  async settle(id: string, outcome: StageAlertDeliveryOutcome, recipientCount: number, now: Date): Promise<void> {
    await this.deps.commandBus.run({
      action: 'projects.stage_alert.record',
      objectType: 'project_stage_alert',
      objectId: id,
      run: async ({ em }) => {
        await em.execute(
          `update "project_stage_alert_deliveries"
              set "outcome" = ?, "recipient_count" = ?, "settled_at" = ?
            where "id" = ? and ("outcome" is null or "outcome" = 'interrupted')`,
          [outcome, recipientCount, now, id],
        );
        return { result: undefined, skipAudit: true };
      },
    });
  }

  /**
   * Give claims back — it is known that nothing was written for them — so the
   * next tick may deliver them; over `interrupted` too, for the same reason as
   * {@link settle}.
   */
  async release(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.deps.commandBus.run({
      action: 'projects.stage_alert.release',
      objectType: 'project_stage_alert',
      objectId: 'sweep',
      run: async ({ em }) => {
        await em.execute(
          `delete from "project_stage_alert_deliveries"
            where "id" = any(?::uuid[]) and ("outcome" is null or "outcome" = 'interrupted')`,
          [`{${ids.join(',')}}`],
        );
        return { result: undefined, skipAudit: true };
      },
    });
  }
}

export interface StageAlertSweepSummary {
  /** Claims found unsettled past {@link STAGE_ALERT_CLAIM_STALE_MS}, and marked `interrupted`. */
  interrupted: number;
  /** Alerts this pass claimed. */
  claimed: number;
  /** Claims given back for the next tick: nothing was written for them. */
  released: number;
  /**
   * Claims no longer due when their delivery began — a Stage left or a
   * deadline moved since the claim. Each is settled `no_recipient` (counted in
   * `outcomes` too): nobody was told.
   */
  withdrawn: number;
  /** What the delivered claims came to. */
  outcomes: Record<StageAlertDeliveryOutcome, number>;
}

/** What a delivery came to — every stored outcome but the `interrupted` a later pass presumes. */
export type StageAlertDeliveryOutcome = Exclude<ProjectStageAlertOutcome, 'interrupted'>;

export interface StageAlertServiceDeps {
  store: StageAlertStorePort;
  /** `projects.alerts_time_zone`, read per pass. */
  timeZone: () => Promise<string>;
  /** Whether a Member may see the Project now: active, `projects:read`, reach and visibility (research R-4). */
  access: Pick<ProjectAccess, 'canSeeAs'>;
  /** `admin_users`' port — each recipient's address and language. Lazy, never captured. */
  adminUsers: Pick<AdminUserReadPort, 'findByIds'>;
  notifier: ProjectNotifier;
  email: StageAlertEmail;
  /** Where a delivery that raised, and a claim found interrupted, are reported. */
  log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * Deadline alerts on Stages, delivered by a sweep (`specs/163-projects-and-tasks/`
 * spec FR-035, SC-004; research R-12).
 *
 * **The row is the schedule.** There is no job per alert: a tick reads what is
 * due today from the Stages, so a moved deadline, a Stage left or a Project
 * closed needs no bookkeeping anywhere, and a flushed Redis loses a tick and
 * never an alert.
 *
 * **Exactly once, by claiming first.** One pass, from 08:00 in the alert zone:
 *
 *  1. claims the alerts due today — one row per (Stage, offset, deadline),
 *     inserted, **and commits**;
 *  2. delivers each, outside any transaction, to every Member who may see the
 *     Project at that moment — in the bell and by e-mail — once it has asked
 *     that the alert is still due (the Stage still current, the deadline the
 *     one claimed); one that is not tells nobody and settles `no_recipient`;
 *  3. records what each came to (`bell_email`, `bell`, `email`, `no_recipient`
 *     or `undeliverable`) with the number of recipients.
 *
 * A claim whose delivery raised before anything was written is given back, and
 * the next tick of the same day delivers it; one that raised after a bell entry
 * or an e-mail went out is settled with what is known, and is never sent again.
 * A process that dies between 1 and 3 leaves a claim with no outcome — an alert
 * that is never retried, because there is no way to know what reached whom. The
 * first pass {@link STAGE_ALERT_CLAIM_STALE_MS} later marks it `interrupted` and
 * says so in the log (issue #462, as CRM's reminder sweep does), so an alert
 * nobody may have received is seen rather than left blank.
 */
export class StageAlertService {
  constructor(private readonly deps: StageAlertServiceDeps) {}

  /** The alert clock at `now`, in the zone the setting names. */
  async clock(now: Date = new Date()): Promise<StageAlertClock> {
    return stageAlertClock(await this.deps.timeZone(), now);
  }

  /**
   * Whether a {@link sweep} at `now` would claim anything — yes or no. Before
   * 08:00 in the alert zone the answer is no without a question to the
   * database.
   */
  async hasWork(now: Date = new Date()): Promise<boolean> {
    const clock = await this.clock(now);
    if (!clock.sending) return false;
    return this.deps.store.hasSweepWork(clock, now);
  }

  /** One pass. `now` is the clock, handed in so that a test needs no sleep. */
  async sweep(now: Date = new Date()): Promise<StageAlertSweepSummary> {
    const summary: StageAlertSweepSummary = {
      interrupted: 0,
      claimed: 0,
      released: 0,
      withdrawn: 0,
      outcomes: { bell: 0, bell_email: 0, email: 0, no_recipient: 0, undeliverable: 0 },
    };
    const clock = await this.clock(now);
    // Before 08:00 nothing is asked at all; a claim interrupted late in the day
    // is marked by the first pass of the next morning.
    if (!clock.sending) return summary;

    const interrupted = await this.deps.store.expire(now);
    summary.interrupted = interrupted.length;
    if (interrupted.length > 0) {
      this.deps.log('projects: stage deadline alerts interrupted between claim and delivery; not retried', {
        interrupted: interrupted.length,
        deliveryIds: interrupted,
      });
    }

    const claims = await this.deps.store.claim(clock, now);
    summary.claimed = claims.length;

    let reached = 0;
    try {
      for (; reached < claims.length; reached += 1) {
        const claim = claims[reached] as ClaimedStageAlert;
        try {
          await this.#deliver(claim, now, summary);
        } catch (error) {
          // A module switched off under a delivery is never absorbed. This
          // claim is settled or given back by then (`#deliver`'s `finally`);
          // the ones not reached are given back below.
          rethrowIfModuleDisabled(error);
          this.deps.log('projects: delivering a stage deadline alert raised', {
            deliveryId: claim.id,
            projectId: claim.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      const unreached = claims.slice(reached + 1).map((claim) => claim.id);
      if (unreached.length > 0) {
        await this.deps.store.release(unreached);
        summary.released += unreached.length;
      }
    }
    return summary;
  }

  /**
   * Deliver one claimed alert and settle it — with what the delivery came to,
   * or given back when it is known that nothing was written. The settling is in
   * a `finally`, so whatever is thrown out of here leaves no claim hanging.
   */
  async #deliver(claim: ClaimedStageAlert, now: Date, summary: StageAlertSweepSummary): Promise<void> {
    const tally: StageAlertTally = { recipients: 0, bell: 0, email: 0 };
    let completed = false;
    try {
      if (!(await this.deps.store.stillDue(claim))) {
        summary.withdrawn += 1;
        completed = true;
        return;
      }
      const recipients = await this.#recipientsOf(claim.projectId);
      tally.recipients = recipients.length;
      const text = projectNotificationText.stageDeadline(
        claim.projectNumber,
        oneLine(claim.stageName),
        claim.deadlineOn,
        claim.offsetDays,
      );
      for (const recipient of recipients) {
        const bell = await this.deps.notifier.notify({
          kind: 'projects.project.stage_deadline',
          targetAdminUserId: recipient.id,
          projectId: claim.projectId,
          ...text,
        });
        if (bell === 'recorded') tally.bell += 1;
        const mail = await this.deps.email.send({
          deliveryId: claim.id,
          projectId: claim.projectId,
          adminUserId: recipient.id,
          to: recipient.email,
          preferredLanguage: recipient.preferredLanguage,
          number: claim.projectNumber,
          stageName: oneLine(claim.stageName),
          deadlineOn: claim.deadlineOn,
          daysLeft: claim.offsetDays,
        });
        if (mail.sent) tally.email += 1;
      }
      completed = true;
    } finally {
      if (completed || tally.bell > 0 || tally.email > 0) {
        const outcome = stageAlertOutcome(tally);
        await this.deps.store.settle(claim.id, outcome, tally.recipients, now);
        summary.outcomes[outcome] += 1;
      } else {
        await this.deps.store.release([claim.id]);
        summary.released += 1;
      }
    }
  }

  /**
   * Who is told: the Project's Members — Members only, never a holder of a
   * Role who is not one — each only if they may see the Project **now**
   * (`canSeeAs`: active, holding `projects:read`, within reach of every one of
   * its Organizations, and through the visibility rule).
   */
  async #recipientsOf(projectId: string) {
    const eligible: string[] = [];
    for (const adminUserId of await this.deps.store.memberIdsOf(projectId)) {
      if (await this.deps.access.canSeeAs(adminUserId, projectId)) eligible.push(adminUserId);
    }
    if (eligible.length === 0) return [];
    const people = await this.deps.adminUsers.findByIds(eligible);
    return people
      .filter((person) => person.status === 'active' && person.deletedAt === null)
      .sort((a, b) => eligible.indexOf(a.id) - eligible.indexOf(b.id));
  }
}

/** A Stage name as an alert says it: on one line — it goes into a bell sentence and an e-mail subject. */
function oneLine(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}
