import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CALENDAR_EVENTS_MAX_RESULTS,
  ERROR_CODES,
  type AdminUserReadPort,
  type CreateOpportunityEventRequest,
  type OpportunityEvent,
  type OpportunityEventReminder,
  type OpportunityEventRule,
  type UpdateOpportunityEventRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { allDayDateOf, checkEventTime } from '../domain/event-time.js';
import { CrmOpportunityEvent } from '../entities/crm-opportunity-event.entity.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';
import type { WorkflowReadService } from './workflow-read-service.js';

export interface OpportunityEventServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  /** Whether an Opportunity's status is an open one: what makes a reminder *paused*. */
  workflowRead: Pick<WorkflowReadService, 'loadGraph'>;
  /** The clock — a reminder must be later than this, and "not yet ended" is measured against it. */
  now?: () => Date;
}

function eventNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This event does not belong to this opportunity.');
}

/**
 * A well-formed Event the rules refuse: 422 `VALIDATION_FAILED`, with the
 * member a form puts the sentence under and the rule it words it from
 * (`contracts/admin-api.md` §12d). No code of its own is minted.
 */
function eventRefused(rule: OpportunityEventRule, field: string, message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message, { field, rule });
}

const RULE_SENTENCES: Record<Exclude<OpportunityEventRule, 'reminder_in_past'>, string> = {
  ends_before_start: 'An event ends after it starts.',
  spans_days: 'An event starts and ends on one calendar day.',
  not_whole_day: 'An all-day event runs from one local midnight to the next.',
  unknown_time_zone: 'The time zone is not one this server knows.',
};

/**
 * What the change history says of an Event: which one, what it is called and
 * when it is — and of its description only how long it is. The audit trail is
 * not tenant-scoped, and a description is read only under its Opportunity
 * (FR-135; research N-R6, the rule a note's text is held to).
 *
 * The literal is assigned to a name on purpose: `src/admin/index.test.ts`
 * reads the keys of every audited state off the literals assigned to `before`
 * and `after`, and holds each to a label the history tab has — a state built
 * out of its sight would reach an operator as "Other change".
 */
function eventAuditState(event: CrmOpportunityEvent): Record<string, unknown> {
  const after = {
    eventId: event.id,
    eventName: event.name,
    allDay: event.allDay,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    remindAt: event.remindAt ? event.remindAt.toISOString() : null,
    length: event.description?.length ?? 0,
  };
  return after;
}

/**
 * The stored outcome of a reminder, folded for a reader
 * (`data-model.md` → *Reminder states*): a claim whose delivery is not
 * recorded yet reads as still scheduled, and a reminder still to do on a
 * closed Opportunity reads as paused — derived here, never stored.
 */
export function foldReminder(
  event: Pick<CrmOpportunityEvent, 'remindAt' | 'reminderHandledAt' | 'reminderOutcome'>,
  opportunityOpen: boolean,
): OpportunityEventReminder | null {
  if (!event.remindAt) return null;
  const at = event.remindAt.toISOString();
  const outcome = event.reminderOutcome ?? null;
  if (!event.reminderHandledAt || outcome === null || outcome === 'sending') {
    const waiting = !event.reminderHandledAt && !opportunityOpen;
    return { at, state: waiting ? 'paused' : 'scheduled', handledAt: null, channels: [] };
  }
  const handledAt = event.reminderHandledAt.toISOString();
  switch (outcome) {
    case 'bell':
      return { at, state: 'sent', handledAt, channels: ['bell'] };
    case 'bell_email':
      return { at, state: 'sent', handledAt, channels: ['bell', 'email'] };
    case 'email':
      return { at, state: 'sent', handledAt, channels: ['email'] };
    default:
      return { at, state: outcome, handledAt, channels: [] };
  }
}

/**
 * Events on an Opportunity — a meeting, a call, a deadline
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12d;
 * `data-model.md` § *`crm_opportunity_events`*; research N-CAL8).
 *
 * **An Event is the Opportunity's plan, not its author's property** (FR-132):
 * whoever may change the Opportunity may edit and delete any of its Events —
 * unlike a note, which only its author edits. So there is no ownership test
 * here at all; the gate is `crm:write` and the reach to the Opportunity.
 *
 * An Event is a child of an Opportunity and carries no tenant column, so every
 * method loads the Opportunity through the scoped EntityManager first and
 * addresses the Event by `(opportunityId, id)`. An Opportunity the caller may
 * not see answers 404 before anything about an Event is said.
 *
 * Every write is a Command recorded against the Opportunity, which is what
 * puts it in the Opportunity's change history. **It takes no lock on the
 * Opportunity and does not bump its `version`**: adding an Event must not make
 * a colleague's open edit form fail with 409. No event is emitted — nobody
 * subscribes.
 */
export class OpportunityEventService {
  readonly #now: () => Date;

  constructor(private readonly deps: OpportunityEventServiceDeps) {
    this.#now = deps.now ?? ((): Date => new Date());
  }

  /** Every Event of the Opportunity, by start, then id. */
  async list(opportunityId: string): Promise<OpportunityEvent[]> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const rows = await em.find(
      CrmOpportunityEvent,
      { opportunityId: opportunity.id },
      { orderBy: { startsAt: 'asc', id: 'asc' }, limit: CALENDAR_EVENTS_MAX_RESULTS },
    );
    return this.#render(em, rows, opportunity.statusCode);
  }

  /** The Events of an Opportunity that have not ended yet — the tab's count. */
  async upcomingCount(opportunityId: string): Promise<number> {
    return this.deps.emFactory().count(CrmOpportunityEvent, { opportunityId, endsAt: { $gt: this.#now() } });
  }

  async add(opportunityId: string, input: CreateOpportunityEventRequest): Promise<OpportunityEvent> {
    const author = this.#author();
    // The parent first: an Opportunity the caller cannot see is a 404, whatever the body says.
    await loadOpportunity(this.deps.emFactory(), opportunityId);

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.#assertTime({ allDay: input.allDay, startsAt, endsAt, timeZone: input.timeZone });
    const remindAt = input.remindAt ? new Date(input.remindAt) : null;
    if (remindAt) this.#assertFuture(remindAt);

    const written = await this.deps.commandBus.run({
      action: 'crm.opportunity.event_add',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        const event = em.create(CrmOpportunityEvent, {
          id: randomUUID(),
          opportunityId: opportunity.id,
          name: input.name,
          description: input.description ?? null,
          allDay: input.allDay,
          startsAt,
          endsAt,
          timeZone: input.timeZone,
          remindAt,
          createdByAdminUserId: author,
        });
        return {
          result: { event, statusCode: opportunity.statusCode },
          before: null,
          after: eventAuditState(event),
        };
      },
    });
    return this.#renderOne(written.event, written.statusCode);
  }

  /**
   * Change what the body names. The rules are applied to the Event **as it
   * would be after the change**; a reminder time equal to the stored one is
   * not judged against the clock, so an Event whose reminder already went out
   * can still have its name corrected, and a different one arms it again.
   */
  async update(
    opportunityId: string,
    eventId: string,
    patch: UpdateOpportunityEventRequest,
  ): Promise<OpportunityEvent> {
    const written = await this.deps.commandBus.run({
      action: 'crm.opportunity.event_update',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        const event = await this.#load(em, opportunity.id, eventId);
        const before = eventAuditState(event);
        const descriptionBefore = event.description ?? null;

        const next = {
          allDay: patch.allDay ?? event.allDay,
          startsAt: patch.startsAt !== undefined ? new Date(patch.startsAt) : event.startsAt,
          endsAt: patch.endsAt !== undefined ? new Date(patch.endsAt) : event.endsAt,
          timeZone: patch.timeZone ?? event.timeZone,
        };
        const timeChanged =
          next.allDay !== event.allDay ||
          next.startsAt.getTime() !== event.startsAt.getTime() ||
          next.endsAt.getTime() !== event.endsAt.getTime() ||
          next.timeZone !== event.timeZone;
        if (timeChanged) this.#assertTime(next);

        if (patch.name !== undefined) event.name = patch.name;
        if (patch.description !== undefined) event.description = patch.description;
        if (timeChanged) Object.assign(event, next);
        if (patch.remindAt !== undefined) this.#setReminder(event, patch.remindAt);

        const after = eventAuditState(event);
        const unchanged =
          JSON.stringify(before) === JSON.stringify(after) &&
          descriptionBefore === (event.description ?? null) &&
          !timeChanged;
        const result = { event, statusCode: opportunity.statusCode };
        return unchanged ? { result, skipAudit: true } : { result, before, after };
      },
    });
    return this.#renderOne(written.event, written.statusCode);
  }

  async remove(opportunityId: string, eventId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.event_remove',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        const event = await this.#load(em, opportunity.id, eventId);
        const before = eventAuditState(event);
        em.remove(event);
        return { result: undefined, before, after: { eventId: event.id, deleted: true } };
      },
    });
  }

  /**
   * The reminder as the body asks for it (FR-137, FR-140): `null` removes it
   * and everything that was recorded about it; a time different from the
   * stored one must be in the future and arms the reminder again; the stored
   * time again changes nothing.
   */
  #setReminder(event: CrmOpportunityEvent, value: string | null): void {
    if (value === null) {
      event.remindAt = null;
      event.reminderHandledAt = null;
      event.reminderOutcome = null;
      return;
    }
    const remindAt = new Date(value);
    if (event.remindAt && event.remindAt.getTime() === remindAt.getTime()) return;
    this.#assertFuture(remindAt);
    event.remindAt = remindAt;
    event.reminderHandledAt = null;
    event.reminderOutcome = null;
  }

  #assertTime(time: { allDay: boolean; startsAt: Date; endsAt: Date; timeZone: string }): void {
    const refusal = checkEventTime(time);
    if (refusal) throw eventRefused(refusal.rule, refusal.field, RULE_SENTENCES[refusal.rule]);
  }

  #assertFuture(remindAt: Date): void {
    if (remindAt.getTime() <= this.#now().getTime()) {
      throw eventRefused('reminder_in_past', 'remindAt', 'A reminder is set for a time that is still to come.');
    }
  }

  /** The administrator writing. The routes are admin-gated, so there always is one. */
  #author(): string {
    const author = actingAdminUserId();
    if (author === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can plan an event on an opportunity.');
    }
    return author;
  }

  /** The Event at `(opportunityId, eventId)` — the Opportunity having been loaded through the scoped EntityManager. */
  async #load(em: EntityManager, opportunityId: string, eventId: string): Promise<CrmOpportunityEvent> {
    if (!isUuid(eventId)) throw eventNotFound();
    const event = await em.findOne(CrmOpportunityEvent, { id: eventId, opportunityId });
    if (!event) throw eventNotFound();
    return event;
  }

  async #renderOne(event: CrmOpportunityEvent, statusCode: string): Promise<OpportunityEvent> {
    const [rendered] = await this.#render(this.deps.emFactory(), [event], statusCode);
    if (!rendered) throw new Error('crm: a written event produced no rendering.');
    return rendered;
  }

  async #render(
    em: EntityManager,
    rows: readonly CrmOpportunityEvent[],
    statusCode: string,
  ): Promise<OpportunityEvent[]> {
    if (rows.length === 0) return [];
    const authorIds = [...new Set(rows.map((row) => row.createdByAdminUserId).filter((id): id is string => Boolean(id)))];
    const [authors, graph] = await Promise.all([
      authorIds.length > 0 ? this.deps.adminUsers.findByIds(authorIds) : Promise.resolve([]),
      this.deps.workflowRead.loadGraph(em),
    ]);
    const names = new Map(
      authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    // "Active" is the status's kind, read the way the list and the Calendar read it (research N-CAL3).
    const opportunityOpen = graph.kindOf(statusCode) === 'open';
    return rows.map((row) => {
      const authorId = row.createdByAdminUserId ?? null;
      const authorName = authorId === null ? undefined : names.get(authorId);
      return {
        id: row.id,
        opportunityId: row.opportunityId,
        name: row.name,
        description: row.description ?? null,
        allDay: row.allDay,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        timeZone: row.timeZone,
        allDayDate: row.allDay ? allDayDateOf(row.startsAt, row.timeZone) : null,
        reminder: foldReminder(row, opportunityOpen),
        // An author who is no longer an administrator is nobody a reader can be shown.
        createdBy: authorId !== null && authorName !== undefined ? { id: authorId, name: authorName } : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
