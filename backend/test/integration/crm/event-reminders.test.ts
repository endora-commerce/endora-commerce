import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailMailerSendInput, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { crmEventReminderRow, seedCrmEventRow } from '../../helpers/seed-crm-events.js';
import type { CrmNotifier } from '../../../../packages/modules/crm/src/backend/services/crm-notifier.js';
import type {
  EventReminderService,
  EventReminderSweepSummary,
} from '../../../../packages/modules/crm/src/backend/services/event-reminder-service.js';

/**
 * The reminder of an Event, delivered by the sweep
 * (`specs/143-crm-sales-opportunities/spec.md` FR-137 – FR-141;
 * `data-model.md` → *Reminder states*; research N-CAL4 – N-CAL7).
 *
 * The sweep is driven directly with a given `now`, as the orders sweep's tests
 * drive theirs — BullMQ is the clock and nothing more, so there is nothing to
 * wait for. What runs is the service the module composes, over the real bell,
 * the real session table and the real transactional sender; only the mail
 * transport is a stand-in that records what it was handed.
 *
 * Every case takes a `now` of its own, a month after the last: a sweep is
 * platform-wide, and whatever an earlier case left behind is by then more than
 * a day overdue and can only be marked missed.
 */
describe('crm event reminders', () => {
  let h: BackendServerHandle;
  let organization: string;
  let admins: Array<{ undo: () => void }> = [];

  /** The mail transport: what `transactional_emails` handed over, and a way to make it fail. */
  const mail: { sent: EmailMailerSendInput[]; failWith: Error | null; logOnly: boolean } = {
    sent: [],
    failWith: null,
    logOnly: false,
  };
  const mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      if (mail.failWith) throw mail.failWith;
      mail.sent.push(input);
      // `logOnly` is an instance with no mail server: the console driver's answer.
      return mail.logOnly ? { status: 'logged' } : { status: 'sent' };
    },
  };

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  let clock = Date.parse('2031-01-01T12:00:00.000Z');
  /** A `now` no other case has used, a month after the last. */
  const nextNow = (): Date => {
    clock += 30 * 24 * HOUR;
    return new Date(clock);
  };

  const composed = () => h.container.resolve('crmEventReminderService') as EventReminderService;
  const sweep = (now: Date): Promise<EventReminderSweepSummary> =>
    enterSystemScope('test: crm event reminders', () => composed().sweep(now));

  const bellAbout = (opportunityId: string) =>
    h.em().find(
      AdminNotification,
      { subjectId: opportunityId, kind: 'crm.opportunity.event_reminder' },
      { filters: false, orderBy: { createdAt: 'asc' } },
    );
  const mailAbout = (eventId: string) => mail.sent.filter((message) => message.messageId.includes(eventId));

  const person = async (label: string, options: { language?: string; active?: boolean } = {}) => {
    const admin = await seedCrmAdmin(h.em(), label, ['crm:read', 'crm:write', 'orders:read']);
    admins.push(admin);
    if (options.language !== undefined || options.active === false) {
      await h
        .em()
        .getConnection()
        .execute(`update "admin_users" set "preferred_language" = ?, "status" = ? where "id" = ?`, [
          options.language ?? null,
          options.active === false ? 'inactive' : 'active',
          admin.adminUserId,
        ]);
    }
    const rows = (await h.em().getConnection().execute(`select "email" from "admin_users" where "id" = ?`, [
      admin.adminUserId,
    ])) as Array<{ email: string }>;
    return { ...admin, email: rows[0]!.email };
  };

  /** Mark `adminUserId` as seen in the Admin UI `minutesBefore` the given `now`. */
  const seen = async (adminUserId: string, now: Date, minutesBefore: number) => {
    const { session } = await h.sessionService.createSession({ kind: 'admin', adminUserId });
    await h
      .em()
      .getConnection()
      .execute(`update "sessions" set "last_seen_at" = ? where "id" = ?`, [
        new Date(now.getTime() - minutesBefore * MINUTE),
        session.id,
      ]);
  };

  /** An Opportunity with one Event whose reminder was due a minute before `now`. */
  const due = async (
    now: Date,
    options: {
      assignee?: string | null;
      creator?: string | null;
      organizationId?: string;
      name?: string;
      allDay?: boolean;
      dueMinutesAgo?: number;
    } = {},
  ) => {
    const opportunity = await createCrmOpportunity(h, {
      organizationId: options.organizationId ?? organization,
      assignedAdminUserId: options.assignee ?? null,
    });
    const startsAt = new Date(now.getTime() + HOUR);
    const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
      name: options.name ?? 'Demo at the warehouse',
      description: 'Bring the price list — never said in a reminder.',
      allDay: options.allDay ?? false,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      timeZone: 'UTC',
      remindAt: new Date(now.getTime() - (options.dueMinutesAgo ?? 1) * MINUTE),
      createdByAdminUserId: options.creator === undefined ? TEST_ADMIN_ID : options.creator,
    });
    return { opportunity, eventId, startsAt };
  };

  /** A date and a time as a reminder words them: `Intl`, in the zone the cases plan in, on one plain line. */
  const worded = (language: string, options: Intl.DateTimeFormatOptions) => (instant: Date) =>
    new Intl.DateTimeFormat(language, { timeZone: 'UTC', ...options }).format(instant).replace(/\s+/gu, ' ');
  const enDate = worded('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const enTime = worded('en-US', { hour: 'numeric', minute: '2-digit' });
  const plDate = worded('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  const plTime = worded('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const outcomeOf = async (eventId: string) => (await crmEventReminderRow(h.em(), eventId))?.outcome ?? null;

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await restoreDefaultCrmWorkflow(h.em());
    organization = await seedCrmOrganization(h.em(), 'Reminders');
  });

  beforeEach(() => {
    mail.sent.length = 0;
    mail.failWith = null;
    mail.logOnly = false;
  });

  afterAll(async () => {
    for (const admin of admins) admin.undo();
    admins = [];
    await h
      .em()
      .getConnection()
      .execute(`update "transactional_emails" set "active" = true where "code" = 'crm_event_reminder'`);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('who is reminded (FR-138)', () => {
    it('the assignee at that moment — not a former one', async () => {
      const now = nextNow();
      const former = await person('former');
      const current = await person('current');
      const { opportunity, eventId } = await due(now, { assignee: former.adminUserId });
      const reassigned = await h.app.inject({
        method: 'POST',
        url: `${CRM_API}/opportunities/${opportunity.id}/assign`,
        cookies: CRM_ADMIN,
        payload: { adminUserId: current.adminUserId },
      });
      expect(reassigned.statusCode, reassigned.body).toBe(200);

      const summary = await sweep(now);
      expect(summary.claimed).toBeGreaterThanOrEqual(1);
      const entries = await bellAbout(opportunity.id);
      expect(entries.map((entry) => entry.targetAdminUserId)).toEqual([current.adminUserId]);
      expect(mailAbout(eventId).map((message) => message.to)).toEqual([current.email]);
    });

    it('nobody assigned — the person who created the Event', async () => {
      const now = nextNow();
      const creator = await person('creator');
      const { opportunity, eventId } = await due(now, { assignee: null, creator: creator.adminUserId });
      await sweep(now);
      expect((await bellAbout(opportunity.id)).map((entry) => entry.targetAdminUserId)).toEqual([creator.adminUserId]);
      expect(await outcomeOf(eventId)).toBe('bell_email');
    });

    it('an assignee who was deactivated — the creator, under the same two tests', async () => {
      const now = nextNow();
      const gone = await person('deactivated', { active: false });
      const creator = await person('creator-of-deactivated');
      const { opportunity } = await due(now, { assignee: null, creator: creator.adminUserId });
      // No request assigns an inactive administrator; one becomes inactive afterwards.
      await h
        .em()
        .getConnection()
        .execute(`update "crm_opportunities" set "assigned_admin_user_id" = ? where "id" = ?`, [
          gone.adminUserId,
          opportunity.id,
        ]);
      await sweep(now);
      expect((await bellAbout(opportunity.id)).map((entry) => entry.targetAdminUserId)).toEqual([creator.adminUserId]);
    });

    it('an assignee who can no longer reach the Organization — the creator; and nobody when the creator cannot either', async () => {
      const now = nextNow();
      const elsewhere = await seedCrmOrganization(h.em(), 'Reminders elsewhere');
      const rep = await seedCrmSalesRep(h.em(), [organization], ['crm:read', 'crm:write', 'orders:read']);
      admins.push(rep);
      const outsider = await seedCrmSalesRep(h.em(), [elsewhere], ['crm:read', 'crm:write', 'orders:read']);
      admins.push(outsider);
      const creator = await person('creator-with-reach');

      const fallsBack = await due(now, { assignee: rep.adminUserId, creator: creator.adminUserId });
      const nobody = await due(now, { assignee: rep.adminUserId, creator: outsider.adminUserId });
      const creatorGone = await due(now, { assignee: null, creator: null });
      // The Organization is taken away from the assignee after the assignment.
      await h
        .em()
        .getConnection()
        .execute(`delete from "organization_sales_rep_assignments" where "admin_user_id" = ?`, [rep.adminUserId]);

      await sweep(now);

      expect((await bellAbout(fallsBack.opportunity.id)).map((entry) => entry.targetAdminUserId)).toEqual([
        creator.adminUserId,
      ]);
      // Nobody qualifies: nothing is written anywhere, and the Event says so.
      for (const event of [nobody, creatorGone]) {
        expect(await bellAbout(event.opportunity.id)).toEqual([]);
        expect(mailAbout(event.eventId)).toEqual([]);
        expect(await outcomeOf(event.eventId)).toBe('no_recipient');
      }
    });
  });

  describe('what is delivered, and how (FR-139)', () => {
    it('a bell entry that names the Event, its time and the number, and opens the Events tab on that Event', async () => {
      const now = nextNow();
      const assignee = await person('bell');
      await seen(assignee.adminUserId, now, 1);
      const { opportunity, eventId, startsAt } = await due(now, { assignee: assignee.adminUserId, name: 'Price talk' });

      await sweep(now);

      const [entry, ...others] = await bellAbout(opportunity.id);
      expect(others).toEqual([]);
      // In the recipient's language — English, with no preference saved — and the Event's own zone.
      const when = `${enDate(startsAt)}, ${enTime(startsAt)} (UTC)`;
      expect(entry).toMatchObject({
        audience: 'admin_user',
        targetAdminUserId: assignee.adminUserId,
        kind: 'crm.opportunity.event_reminder',
        subjectType: 'crm_opportunity',
        subjectId: opportunity.id,
        linkPath: `/crm/opportunities/${opportunity.id}?tab=events&event=${eventId}`,
        title: `Reminder: Price talk, ${when} — opportunity ${opportunity.number}`,
        titleMessage: {
          scope: 'crm',
          key: 'notifications.eventReminder.title',
          params: { name: 'Price talk', when, number: opportunity.number },
        },
      });
      expect(entry?.body ?? null).toBeNull();
      // The English template filled with the params is the title.
      const template = 'Reminder: {name}, {when} — opportunity {number}';
      const params = entry?.titleMessage?.params as Record<string, string>;
      expect(template.replace(/\{(\w+)\}/g, (_whole, key: string) => params[key] ?? '')).toBe(entry?.title);
      // Never the description, never the Opportunity's title.
      expect(JSON.stringify(entry)).not.toContain('price list');
      expect(JSON.stringify(entry)).not.toContain('Fixture opportunity');
    });

    it('an all-day Event is worded as its date, under its own key', async () => {
      const now = nextNow();
      const assignee = await person('all-day');
      await seen(assignee.adminUserId, now, 1);
      const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: assignee.adminUserId });
      const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      await seedCrmEventRow(h.em(), opportunity.id, {
        name: 'Offer deadline',
        allDay: true,
        startsAt: midnight,
        endsAt: new Date(midnight.getTime() + 24 * HOUR),
        timeZone: 'UTC',
        remindAt: new Date(now.getTime() - MINUTE),
        createdByAdminUserId: TEST_ADMIN_ID,
      });
      await sweep(now);
      const [entry] = await bellAbout(opportunity.id);
      const date = enDate(midnight);
      expect(entry?.title).toBe(`Reminder: Offer deadline, all day on ${date} — opportunity ${opportunity.number}`);
      expect(entry?.titleMessage).toMatchObject({ key: 'notifications.eventReminderAllDay.title', params: { when: date } });
    });

    it('seen in the last five minutes — the bell alone; not seen — one e-mail as well, to their address', async () => {
      const now = nextNow();
      const online = await person('online');
      const idle = await person('idle');
      const never = await person('never-seen');
      await seen(online.adminUserId, now, 4);
      await seen(idle.adminUserId, now, 6);
      const here = await due(now, { assignee: online.adminUserId });
      const away = await due(now, { assignee: idle.adminUserId });
      const absent = await due(now, { assignee: never.adminUserId });

      await sweep(now);

      expect(await outcomeOf(here.eventId)).toBe('bell');
      expect(mailAbout(here.eventId)).toEqual([]);
      for (const [event, who] of [
        [away, idle],
        [absent, never],
      ] as const) {
        expect(await outcomeOf(event.eventId)).toBe('bell_email');
        expect(await bellAbout(event.opportunity.id)).toHaveLength(1);
        expect(mailAbout(event.eventId).map((message) => message.to)).toEqual([who.email]);
      }
    });

    it('the e-mail is in Polish for a Polish preference and in English otherwise, with no Sales Channel', async () => {
      const now = nextNow();
      const polish = await person('polish', { language: 'pl' });
      const english = await person('english', { language: 'en' });
      const unset = await person('no-preference');
      const forPolish = await due(now, { assignee: polish.adminUserId, name: 'Rozmowa o cenie' });
      const forEnglish = await due(now, { assignee: english.adminUserId });
      const forUnset = await due(now, { assignee: unset.adminUserId });

      await sweep(now);

      const [toPolish] = mailAbout(forPolish.eventId);
      expect(toPolish).toMatchObject({
        to: polish.email,
        kind: 'crm_event_reminder',
        // The platform-wide content: an administrator is not a channel's customer.
        salesChannelId: null,
        document: { type: 'crm_opportunity', id: forPolish.opportunity.id },
        messageId: expect.stringMatching(new RegExp(`^crm_event_reminder:${forPolish.eventId}:\\d+$`)),
      });
      // When it starts is said in the recipient's language too, in the Event's own zone.
      const plWhen = `${plDate(forPolish.startsAt)}, ${plTime(forPolish.startsAt)} (UTC)`;
      expect(toPolish?.subject).toBe(`Przypomnienie: Rozmowa o cenie — ${plWhen}`);
      expect(toPolish?.text).toContain(`Kiedy: ${plWhen}`);
      const [polishEntry] = await bellAbout(forPolish.opportunity.id);
      expect(polishEntry?.titleMessage?.params).toMatchObject({ when: plWhen });
      expect(toPolish?.text).toContain(forPolish.opportunity.number);
      for (const event of [forEnglish, forUnset]) {
        const [message] = mailAbout(event.eventId);
        const enWhen = `${enDate(event.startsAt)}, ${enTime(event.startsAt)} (UTC)`;
        expect(message?.subject).toBe(`Reminder: Demo at the warehouse — ${enWhen}`);
        expect(message?.text).toContain(`When: ${enWhen}`);
        expect(message?.text).toContain(event.opportunity.number);
        // The same facts as the bell entry and no more.
        expect(`${message?.subject} ${message?.text} ${message?.html ?? ''}`).not.toContain('price list');
      }
    });

    it('an e-mail that cannot be sent never costs the bell entry — switched off by the operator, or a transport that throws', async () => {
      const off = nextNow();
      const first = await person('mail-off');
      const deactivated = await due(off, { assignee: first.adminUserId });
      await h.em().getConnection().execute(`update "transactional_emails" set "active" = false where "code" = 'crm_event_reminder'`);
      try {
        await sweep(off);
      } finally {
        await h.em().getConnection().execute(`update "transactional_emails" set "active" = true where "code" = 'crm_event_reminder'`);
      }
      expect(await bellAbout(deactivated.opportunity.id)).toHaveLength(1);
      expect(mailAbout(deactivated.eventId)).toEqual([]);
      expect(await outcomeOf(deactivated.eventId)).toBe('bell');

      const broken = nextNow();
      const second = await person('mail-broken');
      const thrown = await due(broken, { assignee: second.adminUserId });
      mail.failWith = new Error('smtp is away');
      await sweep(broken);
      expect(await bellAbout(thrown.opportunity.id)).toHaveLength(1);
      expect(await outcomeOf(thrown.eventId)).toBe('bell');
      // Not retried: the reminder was delivered, by the bell.
      mail.failWith = null;
      await sweep(new Date(broken.getTime() + 2 * MINUTE));
      expect(mailAbout(thrown.eventId)).toEqual([]);
      expect(await bellAbout(thrown.opportunity.id)).toHaveLength(1);
    });

    it('an e-mail that was only written to the log is not a delivery — the bell alone, or nothing at all (issue #186)', async () => {
      // An instance with no mail server: the transport takes the message, logs
      // it and says so. Recording "bell and e-mail" for it names a channel that
      // reached nobody.
      mail.logOnly = true;
      const now = nextNow();
      const away = await person('no-mail-server');
      const logged = await due(now, { assignee: away.adminUserId });
      await sweep(now);
      expect(mailAbout(logged.eventId)).toHaveLength(1);
      expect(await bellAbout(logged.opportunity.id)).toHaveLength(1);
      expect(await outcomeOf(logged.eventId)).toBe('bell');

      const later = nextNow();
      const nothing = await due(later, { assignee: away.adminUserId });
      await withModuleOff('admin_notifications', 'deactivated', () => sweep(later));
      expect(mailAbout(nothing.eventId)).toHaveLength(1);
      expect(await bellAbout(nothing.opportunity.id)).toEqual([]);
      expect(await outcomeOf(nothing.eventId)).toBe('undeliverable');
    });

    it('with the bell switched off the e-mail goes out whether or not the recipient is online; with both unavailable nothing does', async () => {
      const now = nextNow();
      const online = await person('online-no-bell');
      await seen(online.adminUserId, now, 1);
      const byMail = await due(now, { assignee: online.adminUserId });
      await withModuleOff('admin_notifications', 'deactivated', () => sweep(now));
      expect(await bellAbout(byMail.opportunity.id)).toEqual([]);
      expect(mailAbout(byMail.eventId).map((message) => message.to)).toEqual([online.email]);
      expect(await outcomeOf(byMail.eventId)).toBe('email');

      const later = nextNow();
      const nothing = await due(later, { assignee: online.adminUserId });
      await h.em().getConnection().execute(`update "transactional_emails" set "active" = false where "code" = 'crm_event_reminder'`);
      try {
        await withModuleOff('admin_notifications', 'deactivated', () => sweep(later));
      } finally {
        await h.em().getConnection().execute(`update "transactional_emails" set "active" = true where "code" = 'crm_event_reminder'`);
      }
      expect(await bellAbout(nothing.opportunity.id)).toEqual([]);
      expect(mailAbout(nothing.eventId)).toEqual([]);
      expect(await outcomeOf(nothing.eventId)).toBe('undeliverable');
    });
  });

  describe('at most once (FR-140)', () => {
    it('two sweeps in a row, and two at once, write one entry', async () => {
      const now = nextNow();
      const assignee = await person('once');
      const inARow = await due(now, { assignee: assignee.adminUserId });
      await sweep(now);
      await sweep(new Date(now.getTime() + MINUTE));
      expect(await bellAbout(inARow.opportunity.id)).toHaveLength(1);
      expect(mailAbout(inARow.eventId)).toHaveLength(1);

      const again = nextNow();
      const atOnce = await due(again, { assignee: assignee.adminUserId });
      const summaries = await Promise.all([sweep(again), sweep(again), sweep(again)]);
      expect(await bellAbout(atOnce.opportunity.id)).toHaveLength(1);
      expect(mailAbout(atOnce.eventId)).toHaveLength(1);
      // Between them the three passes claimed it exactly once.
      expect(summaries.reduce((sum, summary) => sum + summary.claimed, 0)).toBe(1);
      const row = await crmEventReminderRow(h.em(), atOnce.eventId);
      expect(row).toMatchObject({ outcome: 'bell_email' });
      expect(row?.handledAt?.toISOString()).toBe(again.toISOString());
    });

    it('a delivery does not read as an edit of the Event', async () => {
      const now = nextNow();
      const assignee = await person('not-an-edit');
      const { eventId } = await due(now, { assignee: assignee.adminUserId });
      const before = await crmEventReminderRow(h.em(), eventId);
      await sweep(now);
      const after = await crmEventReminderRow(h.em(), eventId);
      expect(after?.outcome).toBe('bell_email');
      expect(after?.updatedAt).toEqual(before?.updatedAt);
    });

    it('a reminder that is not due yet is left alone', async () => {
      const now = nextNow();
      const assignee = await person('not-yet');
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: -1 });
      await sweep(now);
      expect(await bellAbout(opportunity.id)).toEqual([]);
      expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ handledAt: null, outcome: null });
      // A minute later it is due.
      await sweep(new Date(now.getTime() + 2 * MINUTE));
      expect(await bellAbout(opportunity.id)).toHaveLength(1);
    });

    it('a closed Opportunity’s reminder is neither sent nor consumed, and is sent late once it is reopened inside 24 hours', async () => {
      const now = nextNow();
      const assignee = await person('reopened');
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId });
      expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);

      await sweep(now);
      await sweep(new Date(now.getTime() + 5 * HOUR));
      expect(await bellAbout(opportunity.id)).toEqual([]);
      expect(mailAbout(eventId)).toEqual([]);
      // Held, not consumed.
      expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ handledAt: null, outcome: null });

      expect((await transitionCrmOpportunity(h, opportunity.id, 'new')).statusCode).toBe(200);
      const late = new Date(now.getTime() + 23 * HOUR);
      await sweep(late);
      expect(await bellAbout(opportunity.id)).toHaveLength(1);
      expect(await outcomeOf(eventId)).toBe('bell_email');
    });

    it('one found more than 24 hours late is not sent, and is marked missed — closed or not', async () => {
      const now = nextNow();
      const assignee = await person('missed');
      const open = await due(now, { assignee: assignee.adminUserId });
      const closed = await due(now, { assignee: assignee.adminUserId });
      expect((await transitionCrmOpportunity(h, closed.opportunity.id, 'lost')).statusCode).toBe(200);

      const late = new Date(now.getTime() + 24 * HOUR);
      const summary = await sweep(late);

      expect(summary.missed).toBeGreaterThanOrEqual(2);
      for (const event of [open, closed]) {
        expect(await bellAbout(event.opportunity.id)).toEqual([]);
        expect(mailAbout(event.eventId)).toEqual([]);
        expect(await crmEventReminderRow(h.em(), event.eventId)).toMatchObject({ outcome: 'missed', handledAt: late });
      }
      // Reopening does not bring a missed reminder back.
      expect((await transitionCrmOpportunity(h, closed.opportunity.id, 'new')).statusCode).toBe(200);
      await sweep(new Date(late.getTime() + MINUTE));
      expect(await bellAbout(closed.opportunity.id)).toEqual([]);
    });

    it('a reminder due exactly 24 hours ago is still delivered', async () => {
      const now = nextNow();
      const assignee = await person('edge');
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 24 * 60 });
      await sweep(now);
      expect(await bellAbout(opportunity.id)).toHaveLength(1);
      expect(await outcomeOf(eventId)).toBe('bell_email');
    });

    it('a claim left unrecorded for ten minutes becomes interrupted and is never tried again', async () => {
      const now = nextNow();
      const assignee = await person('interrupted');
      const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: assignee.adminUserId });
      // What a process that died between claiming and recording leaves behind.
      const claimedAt = new Date(now.getTime() - 9 * MINUTE);
      const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
        startsAt: new Date(now.getTime() + HOUR),
        endsAt: new Date(now.getTime() + 2 * HOUR),
        remindAt: new Date(now.getTime() - 10 * MINUTE),
        reminderHandledAt: claimedAt,
        reminderOutcome: 'sending',
        createdByAdminUserId: TEST_ADMIN_ID,
      });

      // Nine minutes in, it may still be on its way.
      await sweep(now);
      expect(await outcomeOf(eventId)).toBe('sending');

      const summary = await sweep(new Date(now.getTime() + 2 * MINUTE));
      expect(summary.interrupted).toBeGreaterThanOrEqual(1);
      expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ outcome: 'interrupted', handledAt: claimedAt });

      await sweep(new Date(now.getTime() + 20 * MINUTE));
      expect(await bellAbout(opportunity.id)).toEqual([]);
      expect(mailAbout(eventId)).toEqual([]);
      expect(await outcomeOf(eventId)).toBe('interrupted');
    });

    it('a bell write that throws releases the claim, and the next sweep delivers — once', async () => {
      const now = nextNow();
      const assignee = await person('released');
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId });

      // The module's own notifier, made to fail once: the sweep holds this
      // very object, so what throws is the bell write of the composed service.
      const notifier = h.container.resolve('crmNotifier') as CrmNotifier;
      const real = notifier.notify;
      let failures = 1;
      notifier.notify = async (notification) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('the bell is away');
        }
        return real.call(notifier, notification);
      };
      try {
        const failed = await sweep(now);
        expect(failed.released).toBe(1);
        expect(failed.outcomes).toEqual({ bell: 0, bell_email: 0, email: 0, no_recipient: 0, undeliverable: 0 });
        expect(await bellAbout(opportunity.id)).toEqual([]);
        // It is known that nothing was written, so nothing was sent by e-mail either.
        expect(mailAbout(eventId)).toEqual([]);
        expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ handledAt: null, outcome: null });

        await sweep(new Date(now.getTime() + MINUTE));
        await sweep(new Date(now.getTime() + 2 * MINUTE));
      } finally {
        notifier.notify = real;
      }
      expect(await bellAbout(opportunity.id)).toHaveLength(1);
      expect(mailAbout(eventId)).toHaveLength(1);
      expect(await outcomeOf(eventId)).toBe('bell_email');
    });

    it('a new reminder time arms a handled reminder again', async () => {
      const assignee = await person('armed-again');
      const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: assignee.adminUserId });
      // The Event is created through the API, so its reminder is in the real future.
      const first = new Date(Date.now() + 2 * HOUR);
      const second = new Date(Date.now() + 4 * HOUR);
      const startsAt = new Date(Date.UTC(2040, 0, 10, 8));
      const created = await h.app.inject({
        method: 'POST',
        url: `${CRM_API}/opportunities/${opportunity.id}/events`,
        cookies: CRM_ADMIN,
        payload: {
          name: 'Follow-up',
          allDay: false,
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + HOUR).toISOString(),
          timeZone: 'UTC',
          remindAt: first.toISOString(),
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const eventId = (created.json() as { data: { id: string } }).data.id;

      await sweep(new Date(first.getTime() + MINUTE));
      expect(await bellAbout(opportunity.id)).toHaveLength(1);

      const moved = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${opportunity.id}/events/${eventId}`,
        cookies: CRM_ADMIN,
        payload: { remindAt: second.toISOString() },
      });
      expect(moved.statusCode, moved.body).toBe(200);
      await sweep(new Date(first.getTime() + 2 * MINUTE));
      expect(await bellAbout(opportunity.id)).toHaveLength(1);

      await sweep(new Date(second.getTime() + MINUTE));
      expect(await bellAbout(opportunity.id)).toHaveLength(2);
      // A message of its own for the second reminder time.
      expect(new Set(mailAbout(eventId).map((message) => message.messageId)).size).toBe(2);
    });

    it('a removed reminder and a deleted Event send nothing', async () => {
      const now = nextNow();
      const assignee = await person('nothing-to-send');
      const removed = await due(now, { assignee: assignee.adminUserId });
      const deleted = await due(now, { assignee: assignee.adminUserId });
      const cleared = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${removed.opportunity.id}/events/${removed.eventId}`,
        cookies: CRM_ADMIN,
        payload: { remindAt: null },
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      const gone = await h.app.inject({
        method: 'DELETE',
        url: `${CRM_API}/opportunities/${deleted.opportunity.id}/events/${deleted.eventId}`,
        cookies: CRM_ADMIN,
      });
      expect(gone.statusCode, gone.body).toBe(204);

      await sweep(now);
      for (const event of [removed, deleted]) {
        expect(await bellAbout(event.opportunity.id)).toEqual([]);
        expect(mailAbout(event.eventId)).toEqual([]);
      }
    });
  });
});
