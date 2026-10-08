import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * What became of an Event's reminder, as stored
 * (`specs/143-crm-sales-opportunities/data-model.md` → *Reminder states*).
 * `sending` is a claim whose delivery has not been recorded yet; the API folds
 * the set for a reader (`contracts/admin-api.md` §12d).
 */
export type CrmEventReminderOutcome =
  | 'sending'
  | 'bell'
  | 'bell_email'
  | 'email'
  | 'no_recipient'
  | 'undeliverable'
  | 'missed'
  | 'interrupted';

/**
 * An Event on an Opportunity — a meeting, a call, a deadline (User Stories 21
 * and 22).
 *
 * One calendar day: two instants (`endsAt` exclusive) and the IANA zone they
 * were planned in, which decides the all-day date and how a bell entry and an
 * e-mail word the time — never how a calendar draws it.
 *
 * **Nothing about a person is decided here.** Whose calendar an Event is on and
 * who is reminded are read from the Opportunity's assignee at the moment of
 * asking; `createdByAdminUserId` is only the fallback recipient of a reminder.
 *
 * A reminder exists exactly when `remindAt` is set. `reminderHandledAt` is the
 * at-most-once latch — set by the sweep's claim **before** anything is
 * delivered — and `reminderOutcome` says what the claim came to.
 *
 * The three indexes — the tab's list, the Calendar's range read and the
 * partial one the sweep reads every minute — are the migration's; the last is
 * a predicate no entity declaration carries.
 *
 * Never loaded by its own id alone: the row carries no tenant column. Load the
 * Opportunity through the scoped EntityManager first, then the Event by
 * `(opportunityId, id)`; the Calendar, which reads across Opportunities, joins
 * the parent under the caller's reach instead.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_events' })
@Index({ properties: ['opportunityId', 'startsAt'] })
@Index({ properties: ['startsAt'] })
export class CrmOpportunityEvent {
  [OptionalProps]?:
    | 'id'
    | 'description'
    | 'allDay'
    | 'remindAt'
    | 'reminderHandledAt'
    | 'reminderOutcome'
    | 'createdByAdminUserId'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Never changes after insert: an Event cannot be moved to another Opportunity. */
  @Property({ type: 'uuid' })
  opportunityId!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  /** Plain text. Reference tokens are not parsed here. */
  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'boolean', default: false })
  allDay: boolean = false;

  @Property({ type: 'datetime' })
  startsAt!: Date;

  /** Exclusive. */
  @Property({ type: 'datetime' })
  endsAt!: Date;

  @Property({ type: 'string', length: 64 })
  timeZone!: string;

  @Property({ type: 'datetime', nullable: true })
  remindAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  reminderHandledAt?: Date | null;

  @Property({ type: 'string', length: 16, nullable: true })
  reminderOutcome?: CrmEventReminderOutcome | null;

  /** By value, like every admin-user reference of this module. */
  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  /**
   * When the Event itself was last changed. The reminder's bookkeeping does
   * not move it: the sweep writes its three columns with statements of its
   * own, so a delivery is never read as an edit.
   */
  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
