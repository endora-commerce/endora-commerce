import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailMailerSendInput, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
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
} from '../../helpers/seed-crm.js';
import { createCrmEvent, crmEventReminderRow, seedCrmEventRow, timedEventBody } from '../../helpers/seed-crm-events.js';
import type { CrmNotifier } from '../../../../packages/modules/crm/src/backend/services/crm-notifier.js';
import type {
  EventReminderService,
  EventReminderSweepSummary,
} from '../../../../packages/modules/crm/src/backend/services/event-reminder-service.js';

/**
 * What the independent review of Events, reminders and the Calendar found
 * (`specs/143-crm-sales-opportunities/research.md` N-CALR1 …; tasks T390 …).
 * Each case here was red before its repair.
 */
describe('crm events — review regressions', () => {
  let h: BackendServerHandle;
  let organization: string;
  let admins: Array<{ undo: () => void }> = [];

  const mail: { sent: EmailMailerSendInput[] } = { sent: [] };
  const mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      mail.sent.push(input);
      return { status: 'sent' };
    },
  };

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  let clock = Date.parse('2041-01-01T12:00:00.000Z');
  /** A `now` no other case has used, a month after the last. */
  const nextNow = (): Date => {
    clock += 30 * 24 * HOUR;
    return new Date(clock);
  };

  const composed = () => h.container.resolve('crmEventReminderService') as EventReminderService;
  const sweep = (now: Date): Promise<EventReminderSweepSummary> =>
    enterSystemScope('test: crm event reminders, review', () => composed().sweep(now));

  const bellAbout = (opportunityId: string) =>
    h.em().find(
      AdminNotification,
      { subjectId: opportunityId, kind: 'crm.opportunity.event_reminder' },
      { filters: false, orderBy: { createdAt: 'asc' } },
    );
  const mailAbout = (eventId: string) => mail.sent.filter((message) => message.messageId.includes(eventId));
  const outcomeOf = async (eventId: string) => (await crmEventReminderRow(h.em(), eventId))?.outcome ?? null;

  const person = async (label: string, permissions: string[] = ['crm:read', 'crm:write', 'orders:read']) => {
    const admin = await seedCrmAdmin(h.em(), label, permissions);
    admins.push(admin);
    return admin;
  };

  /** An Opportunity with one Event whose reminder was due `dueMinutesAgo` before `now`. */
  const due = async (
    now: Date,
    options: { assignee?: string | null; creator?: string | null; name?: string; dueMinutesAgo?: number } = {},
  ) => {
    const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: null });
    if (options.assignee) {
      // Straight to the column: what is asked here is what the sweep does with
      // the row, whatever an assignment would have accepted.
      await h
        .em()
        .getConnection()
        .execute(`update "crm_opportunities" set "assigned_admin_user_id" = ? where "id" = ?`, [
          options.assignee,
          opportunity.id,
        ]);
    }
    const startsAt = new Date(now.getTime() + HOUR);
    const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
      name: options.name ?? 'Demo at the warehouse',
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      timeZone: 'UTC',
      remindAt: new Date(now.getTime() - (options.dueMinutesAgo ?? 1) * MINUTE),
      createdByAdminUserId: options.creator === undefined ? TEST_ADMIN_ID : options.creator,
    });
    return { opportunity, eventId };
  };

  /** Run `during` in the middle of the delivery of the reminder about `opportunityId`. */
  const whileDelivering = async (opportunityId: string, during: () => Promise<void>, run: () => Promise<void>) => {
    const notifier = h.container.resolve('crmNotifier') as CrmNotifier;
    const real = notifier.notify;
    notifier.notify = async (notification) => {
      const outcome = await real.call(notifier, notification);
      if (notification.opportunityId === opportunityId) await during();
      return outcome;
    };
    try {
      await run();
    } finally {
      notifier.notify = real;
    }
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await restoreDefaultCrmWorkflow(h.em());
    organization = await seedCrmOrganization(h.em(), 'Events review');
  });

  beforeEach(() => {
    mail.sent.length = 0;
  });

  afterAll(async () => {
    for (const admin of admins) admin.undo();
    admins = [];
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('who is reminded (FR-138): somebody who may no longer see the Opportunity is not', () => {
    it('an assignee who does not hold crm:read is passed over for the creator; and nobody when the creator does not either', async () => {
      const now = nextNow();
      const blind = await person('no-crm-read', ['orders:read']);
      const creator = await person('creator-sees');
      const blindCreator = await person('creator-no-crm-read', ['orders:read']);

      const fallsBack = await due(now, { assignee: blind.adminUserId, creator: creator.adminUserId });
      const nobody = await due(now, { assignee: blind.adminUserId, creator: blindCreator.adminUserId });

      await sweep(now);

      expect((await bellAbout(fallsBack.opportunity.id)).map((entry) => entry.targetAdminUserId)).toEqual([
        creator.adminUserId,
      ]);
      expect(await bellAbout(nobody.opportunity.id)).toEqual([]);
      expect(mailAbout(nobody.eventId)).toEqual([]);
      expect(await outcomeOf(nobody.eventId)).toBe('no_recipient');
    });

    it('a Sales Rep who keeps the Organization and loses crm:read is not reminded', async () => {
      const now = nextNow();
      const rep = await seedCrmSalesRep(h.em(), [organization], ['orders:read']);
      admins.push(rep);
      // The shared role may carry `crm:read` from another suite: this
      // representative gets a role of their own without it.
      const own = await person('rep-without-crm', ['orders:read']);
      await h
        .em()
        .getConnection()
        .execute(
          `update "admin_users" set "admin_role_id" = (select "admin_role_id" from "admin_users" where "id" = ?) where "id" = ?`,
          [own.adminUserId, rep.adminUserId],
        );
      const { opportunity, eventId } = await due(now, { assignee: rep.adminUserId, creator: null });

      await sweep(now);

      expect(await bellAbout(opportunity.id)).toEqual([]);
      expect(mailAbout(eventId)).toEqual([]);
      expect(await outcomeOf(eventId)).toBe('no_recipient');
    });
  });

  describe('a claim that changes under its pass (FR-137, FR-140, FR-141)', () => {
    it('an Event deleted, or its reminder removed, after the claim and before its turn is not delivered', async () => {
      const now = nextNow();
      const assignee = await person('claimed-then-gone');
      const first = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 5 });
      const deleted = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 3 });
      const cleared = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 2 });

      await whileDelivering(
        first.opportunity.id,
        async () => {
          const gone = await h.app.inject({
            method: 'DELETE',
            url: `${CRM_API}/opportunities/${deleted.opportunity.id}/events/${deleted.eventId}`,
            cookies: CRM_ADMIN,
          });
          expect(gone.statusCode, gone.body).toBe(204);
          const removed = await h.app.inject({
            method: 'PATCH',
            url: `${CRM_API}/opportunities/${cleared.opportunity.id}/events/${cleared.eventId}`,
            cookies: CRM_ADMIN,
            payload: { remindAt: null },
          });
          expect(removed.statusCode, removed.body).toBe(200);
        },
        async () => {
          await sweep(now);
        },
      );

      expect(await bellAbout(first.opportunity.id)).toHaveLength(1);
      expect(await bellAbout(deleted.opportunity.id)).toEqual([]);
      expect(mailAbout(deleted.eventId)).toEqual([]);
      expect(await bellAbout(cleared.opportunity.id)).toEqual([]);
      expect(mailAbout(cleared.eventId)).toEqual([]);
      expect(await crmEventReminderRow(h.em(), cleared.eventId)).toMatchObject({ remindAt: null, outcome: null });
    });

    it('a reminder that was delivered never reads as interrupted, however long its pass took', async () => {
      const now = nextNow();
      const assignee = await person('slow-pass');
      const slow = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 5 });
      const queued = await due(now, { assignee: assignee.adminUserId, dueMinutesAgo: 2 });

      let marked = 0;
      await whileDelivering(
        slow.opportunity.id,
        async () => {
          // Another worker process ticks eleven minutes into this pass — a mail
          // server that answers nobody is enough to make a pass that long.
          marked = (await sweep(new Date(now.getTime() + 11 * MINUTE))).interrupted;
        },
        async () => {
          await sweep(now);
        },
      );
      expect(marked).toBeGreaterThanOrEqual(2);

      for (const event of [slow, queued]) {
        const entries = await bellAbout(event.opportunity.id);
        const outcome = await outcomeOf(event.eventId);
        // Either it was delivered and says so, or it reads interrupted and nothing was written.
        if (outcome === 'interrupted') expect(entries, 'interrupted, yet a bell entry was written').toEqual([]);
        else expect(entries).toHaveLength(1);
      }
      expect(await outcomeOf(slow.eventId)).toBe('bell_email');
    });
  });

  describe('instants at the edge of the calendar are answered, never a 500', () => {
    const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: Record<string, unknown>) =>
      h.app.inject({ method, url: `${CRM_API}${path}`, cookies: CRM_ADMIN, ...(payload ? { payload } : {}) });

    it('an Event, a reminder and a Calendar range in the year 9999 and in the year 0', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organization });
      const base = `/opportunities/${opportunity.id}/events`;
      const bodies: Array<Record<string, unknown>> = [
        timedEventBody('9999-12-31', { timeZone: 'UTC', startsAt: '9999-12-31T22:00:00.000Z', endsAt: '9999-12-31T23:59:59.999Z' }),
        timedEventBody('9999-12-31', { timeZone: 'UTC', remindAt: '9999-12-31T23:59:59.999Z' }),
        // An offset that carries the instant past the year 9999.
        timedEventBody('9999-12-31', { timeZone: 'UTC', startsAt: '9999-12-31T22:00:00-14:00', endsAt: '9999-12-31T23:00:00-14:00' }),
        timedEventBody('9999-12-31', { timeZone: 'UTC', remindAt: '9999-12-31T23:00:00-14:00' }),
        timedEventBody('0000-01-01', { timeZone: 'UTC' }),
        timedEventBody('0000-01-01', { timeZone: 'UTC', startsAt: '0000-01-01T00:00:00+14:00', endsAt: '0000-01-01T01:00:00+14:00' }),
      ];
      for (const body of bodies) {
        const response = await call('POST', base, body);
        expect(response.statusCode, `${JSON.stringify(body)} → ${response.body}`).toBeLessThan(500);
      }
      const listed = await call('GET', base);
      expect(listed.statusCode, listed.body).toBe(200);
      const detail = await call('GET', `/opportunities/${opportunity.id}`);
      expect(detail.statusCode, detail.body).toBe(200);

      const event = await createCrmEvent(h, opportunity.id, timedEventBody('2043-05-10'));
      for (const patch of [
        { remindAt: '9999-12-31T23:00:00-14:00' },
        { startsAt: '9999-12-31T22:00:00-14:00', endsAt: '9999-12-31T23:00:00-14:00' },
        { startsAt: '9999-12-31T22:00:00.000Z' },
        { endsAt: '0000-01-01T00:00:00+14:00' },
      ]) {
        const response = await call('PATCH', `${base}/${event.id}`, patch);
        expect(response.statusCode, `${JSON.stringify(patch)} → ${response.body}`).toBeLessThan(500);
      }

      for (const [from, to] of [
        ['9999-12-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z'],
        ['9999-12-31T00:00:00-14:00', '9999-12-31T23:00:00-14:00'],
        ['0000-01-01T00:00:00.000Z', '0000-01-31T00:00:00.000Z'],
        ['0000-01-01T00:00:00+14:00', '0000-01-02T00:00:00+14:00'],
      ]) {
        const params = new URLSearchParams({ from: from as string, to: to as string });
        const response = await call('GET', `/calendar/events?${params.toString()}`);
        expect(response.statusCode, `${from} … ${to} → ${response.body}`).toBeLessThan(500);
      }
      // And the sweep reads past all of it.
      await sweep(nextNow());
    });
  });

  describe('what a reminder says', () => {
    it('a line break in an Event name reaches neither the subject of the e-mail nor the bell entry', async () => {
      const now = nextNow();
      const assignee = await person('line-break');
      const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: assignee.adminUserId });
      // Through the API: a name may be typed, or pasted, with a line break in it.
      const event = await createCrmEvent(
        h,
        opportunity.id,
        timedEventBody('2043-06-10', {
          name: 'Call\r\nBcc: somebody@example.com\nagain',
          startsAt: new Date(now.getTime() + HOUR).toISOString(),
          endsAt: new Date(now.getTime() + 2 * HOUR).toISOString(),
          timeZone: 'UTC',
        }),
      );
      await h
        .em()
        .getConnection()
        .execute(`update "crm_opportunity_events" set "remind_at" = ? where "id" = ?`, [new Date(now.getTime() - MINUTE), event.id]);

      await sweep(now);

      const [entry] = await bellAbout(opportunity.id);
      const [message] = mailAbout(event.id);
      expect(message?.subject).toBeDefined();
      expect(message?.subject).not.toMatch(/[\r\n]/);
      expect(message?.subject).toContain('Call Bcc: somebody@example.com again');
      expect(entry?.title).not.toMatch(/[\r\n]/);
      expect(JSON.stringify(entry?.titleMessage)).not.toMatch(/\\[rn]/);
    });

    it('an Event with the longest name there is still gets its reminder — the bell sentence is cut, the name is kept whole', async () => {
      const now = nextNow();
      const assignee = await person('long-name');
      const name = `${'Quarterly review of the framework agreement '.repeat(4)}${'x'.repeat(24)}`;
      expect(name).toHaveLength(200);
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId, name });

      const summary = await sweep(now);

      expect(summary.released).toBe(0);
      const [entry] = await bellAbout(opportunity.id);
      expect(entry, 'no bell entry was written').toBeDefined();
      expect(entry?.title.length).toBeLessThanOrEqual(255);
      expect(entry?.title.endsWith('…')).toBe(true);
      // The translated sentence is built from the params, and those are whole.
      expect(entry?.titleMessage?.params).toMatchObject({ name });
      expect(await outcomeOf(eventId)).toBe('bell_email');
      expect(mailAbout(eventId)[0]?.subject).toContain(name);
    });

    it('a name that looks like a template directive or like markup is said as it was written', async () => {
      const now = nextNow();
      const assignee = await person('directive');
      const name = '{{var opportunity.number}} <script>alert(1)</script> {{if event.when}}x{{/if}}';
      const { opportunity, eventId } = await due(now, { assignee: assignee.adminUserId, name });

      await sweep(now);

      const [entry] = await bellAbout(opportunity.id);
      expect(entry?.title).toContain(name);
      const [message] = mailAbout(eventId);
      expect(message?.subject).toContain(name);
      expect(message?.text).toContain(name);
      expect(message?.html).not.toContain('<script>');
      expect(message?.html).toContain('{{var opportunity.number}} &lt;script&gt;');
      // Nothing beyond the name, the time and the number: never the title.
      expect(`${message?.subject}\n${message?.text}`).not.toContain('Fixture opportunity');
    });
  });
});
