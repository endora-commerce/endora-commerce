import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMailerSendInput, EmailMailerSendOutcome, ProjectDetail } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import type {
  StageAlertService,
  StageAlertStorePort,
  StageAlertSweepSummary,
} from '../../../../packages/modules/projects/src/backend/services/stage-alert-service.js';
import {
  STAGE_ALERT_EVERY_MS,
  runStageAlertJob,
} from '../../../../packages/modules/projects/src/backend/workers/stage-alert-worker.js';
import {
  PROJECTS_ADMIN,
  closeProject,
  createProject,
  deleteProjects,
  dictionaryIds,
  getProject,
  moveProjectOk,
  patchStage,
  stageNamed,
} from './helpers.js';

/**
 * User Story 8 — deadline alerts on Stages (`specs/163-projects-and-tasks/spec.md`
 * FR-035, SC-004; research R-12).
 *
 * **A controlled clock over sixty days.** The sweep is driven directly, tick by
 * tick, with the `now` a tick of the Job Scheduler would have had — every
 * fifteen minutes from 25 September to 24 November 2031, across the night the
 * clocks go back in `Europe/Warsaw` (26 October 2031). Each tick does what the
 * consumer does: asks the probe, and only when it says yes sweeps, inside the
 * system scope. What runs is the service the module composes, over the real
 * bell and the real transactional sender; only the mail transport is a
 * stand-in that records what it was handed.
 *
 * The Stage dates of the timeline are set by hand (`deadlineOn`), because the
 * module counts a Stage's start from the real "today"; everything a case
 * measures is in 2031, where no other file's Project has a deadline.
 *
 * The Members: Ada (may see the Project), Bob (deactivated), Cyd (a sales
 * representative out of the Project's Organization reach); Dan may see every
 * Project but is no Member, and alerts go to Members only.
 */
describe('projects — Stage deadline alerts (US8)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void; email: string };
  let ada: Person;
  let bob: Person;
  let cyd: Person;
  let dan: Person;
  let organization: string;
  const created: string[] = [];

  const mail: { sent: EmailMailerSendInput[] } = { sent: [] };
  const mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      mail.sent.push(input);
      return { status: 'sent' };
    },
  };

  const ZONE = 'Europe/Warsaw';
  const DAY = 24 * 60 * 60 * 1000;
  const composed = () => h.container.resolve('projectsStageAlertService') as StageAlertService;
  const sweep = (now: Date): Promise<StageAlertSweepSummary> =>
    enterSystemScope('test: projects stage alerts', () => composed().sweep(now));
  /** One tick as the consumer runs it: the probe outside any scope, then the pass inside one. */
  const tick = (now: Date): Promise<void> =>
    runWithoutTenantContext(() =>
      runStageAlertJob({
        isPresent: () => true,
        hasWork: () => composed().hasWork(now),
        tick: async () => {
          await composed().sweep(now);
        },
      }),
    );

  const local = (instant: Date): { date: string; hour: number } => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);
    const part = (type: string): string => {
      const found = parts.find((p) => p.type === type);
      if (!found) throw new Error(`no ${type} in ${instant.toISOString()}`);
      return found.value;
    };
    return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
  };

  const person = async (label: string, permissions = ['projects:read', 'projects:write']): Promise<Person> => {
    const seeded = await seedCrmAdmin(h.em(), `alerts-${label}`, permissions);
    return { ...seeded, email: await emailOf(seeded.adminUserId) };
  };
  const emailOf = async (adminUserId: string): Promise<string> => {
    const rows = (await h.em().getConnection().execute(`select "email" from "admin_users" where "id" = ?`, [
      adminUserId,
    ])) as Array<{ email: string }>;
    return rows[0]!.email;
  };

  const MEMBERS = () => [ada, bob, cyd].map((member) => ({ adminUserId: member.adminUserId, roleIds: [] }));

  /** A Project of the Organization with Stages Design, Build, Handover; `alerts` per Stage name. */
  const project = async (
    title: string,
    alerts: Partial<Record<'Design' | 'Build' | 'Handover', number[]>>,
    options: { members?: Array<{ adminUserId: string; roleIds: string[] }> } = {},
  ): Promise<ProjectDetail> => {
    const detail = await createProject(h, {
      title: `alerts ${title}`,
      organizationIds: [organization],
      visibility: 'everyone',
      members: options.members ?? MEMBERS(),
      stages: (['Design', 'Build', 'Handover'] as const).map((name, index) => ({
        name,
        color: ['#3b82f6', '#f59e0b', '#22c55e'][index]!,
        plannedDurationDays: 5,
        alertOffsetsDays: alerts[name] ?? [],
      })),
    });
    created.push(detail.id);
    return detail;
  };
  const setDeadline = (detail: ProjectDetail, stage: string, deadlineOn: string) =>
    patchStage(h, detail.id, stageNamed(detail, stage), { deadlineOn });

  /** The delivery rows of one Stage, oldest first. */
  const deliveries = async (stageId: string) =>
    (await h
      .em()
      .getConnection()
      .execute(
        `select "offset_days", to_char("deadline_on", 'YYYY-MM-DD') as "deadline_on", "claimed_at", "outcome", "recipient_count"
           from "project_stage_alert_deliveries" where "stage_id" = ? order by "claimed_at", "offset_days"`,
        [stageId],
      )) as Array<{ offset_days: number; deadline_on: string; claimed_at: Date; outcome: string | null; recipient_count: number | null }>;

  const bells = async (projectId: string, who: Person) =>
    h
      .em()
      .find(
        AdminNotification,
        { subjectId: projectId, targetAdminUserId: who.adminUserId, kind: 'projects.project.stage_deadline' },
        { filters: false, orderBy: { createdAt: 'asc' } },
      );
  const mailsAbout = (projectNumber: string) =>
    mail.sent.filter((message) => message.subject.includes(projectNumber) || message.text.includes(projectNumber));

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    // The default zone — set, not assumed: another file may have written it.
    const zone = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/projects.alerts_time_zone/value',
      cookies: PROJECTS_ADMIN,
      payload: { scope: 'all', value: ZONE },
    });
    expect(zone.statusCode, zone.body).toBeLessThan(400);
    organization = await seedCrmOrganization(h.em(), 'Alerts');
    const elsewhere = await seedCrmOrganization(h.em(), 'Alerts elsewhere');
    ada = await person('ada');
    bob = await person('bob');
    const rep = await seedCrmSalesRep(h.em(), [elsewhere], ['projects:read', 'projects:write']);
    cyd = { ...rep, email: await emailOf(rep.adminUserId) };
    dan = await person('dan', ['projects:read', 'projects:see_all']);
  });

  beforeEach(() => {
    mail.sent.length = 0;
  });

  afterAll(async () => {
    await deleteProjects(h, created);
    for (const who of [ada, bob, cyd, dan]) who?.undo();
    await teardownBackendServer(h);
  });

  describe('a sixty-day timeline across the October DST change', () => {
    const START = Date.parse('2031-09-25T00:00:00.000Z');
    const DAYS = 60;
    let reasons: Record<string, string>;
    const p = {} as Record<
      'acrossDst' | 'afterDst' | 'leftStage' | 'closed' | 'movedDeadline' | 'enteredLate' | 'enteredOnDueDay',
      ProjectDetail
    >;
    /** What happens at 00:00 UTC of a simulated day, before that day's ticks. */
    const onDay: Record<string, () => Promise<void>> = {};

    beforeAll(async () => {
      reasons = await dictionaryIds(h, 'project_loss_reasons');

      // Due 10 and 17 October (offsets 10 and 3 of the 20th) — before the clocks go back.
      p.acrossDst = await project('across DST', { Design: [3, 10] });
      await setDeadline(p.acrossDst, 'Design', '2031-10-20');
      // Due 8 November — after.
      p.afterDst = await project('after DST', { Design: [2] });
      await setDeadline(p.afterDst, 'Design', '2031-11-10');

      // Due 10 October, but the Project moves on to Build on the 5th.
      p.leftStage = await project('left stage', { Design: [2] });
      await setDeadline(p.leftStage, 'Design', '2031-10-12');
      onDay['2031-10-05'] = async () => {
        const fresh = await getProject(h, p.leftStage.id);
        await moveProjectOk(h, fresh.id, stageNamed(fresh, 'Build'), fresh.version);
      };

      // Due 10 October, but the Project is closed as lost on the 6th.
      p.closed = await project('closed', { Design: [2] });
      await setDeadline(p.closed, 'Design', '2031-10-12');
      onDay['2031-10-06'] = async () => {
        const fresh = await getProject(h, p.closed.id);
        const response = await closeProject(h, fresh.id, { outcome: 'lost', lossReasonId: reasons.price, version: fresh.version });
        expect(response.statusCode, response.body).toBe(200);
      };

      // Due 14 October; the deadline then moves to the 22nd (due the 21st,
      // re-armed once), then — on the 23rd — to the 23rd, whose due day, the
      // 22nd, is already gone: nothing backdated.
      p.movedDeadline = await project('moved deadline', { Design: [1] });
      await setDeadline(p.movedDeadline, 'Design', '2031-10-15');
      onDay['2031-10-16'] = () => setDeadline(p.movedDeadline, 'Design', '2031-10-22');
      onDay['2031-10-23'] = () => setDeadline(p.movedDeadline, 'Design', '2031-10-23');

      // Build's alert is due on the 15th; the Project only enters Build on the 17th.
      p.enteredLate = await project('entered late', { Build: [5] });
      await setDeadline(p.enteredLate, 'Build', '2031-10-20');
      onDay['2031-10-17'] = async () => {
        const fresh = await getProject(h, p.enteredLate.id);
        await moveProjectOk(h, fresh.id, stageNamed(fresh, 'Build'), fresh.version);
      };

      // Build's alert is due on 10 November, the day the Project enters Build.
      p.enteredOnDueDay = await project('entered on the due day', { Build: [5] });
      await setDeadline(p.enteredOnDueDay, 'Build', '2031-11-15');
      onDay['2031-11-10'] = async () => {
        const fresh = await getProject(h, p.enteredOnDueDay.id);
        await moveProjectOk(h, fresh.id, stageNamed(fresh, 'Build'), fresh.version);
      };

      // Bob is a Member and is deactivated before the first alert.
      await h.em().getConnection().execute(`update "admin_users" set "status" = 'inactive' where "id" = ?`, [bob.adminUserId]);

      for (let day = 0; day < DAYS; day += 1) {
        const midnight = START + day * DAY;
        await onDay[new Date(midnight).toISOString().slice(0, 10)]?.();
        for (let at = midnight; at < midnight + DAY; at += STAGE_ALERT_EVERY_MS) await tick(new Date(at));
      }
    }, 600_000);

    afterAll(async () => {
      await h.em().getConnection().execute(`update "admin_users" set "status" = 'active' where "id" = ?`, [bob.adminUserId]);
    });

    it('delivers each (Stage, offset, deadline) once, on its due day, from 08:00 local time — either side of the change', async () => {
      const design = stageNamed(p.acrossDst, 'Design');
      const rows = await deliveries(design);
      expect(rows.map((row) => [row.offset_days, row.deadline_on])).toEqual([
        [10, '2031-10-20'],
        [3, '2031-10-20'],
      ]);
      expect(rows.map((row) => local(new Date(row.claimed_at)))).toEqual([
        { date: '2031-10-10', hour: 8 },
        { date: '2031-10-17', hour: 8 },
      ]);
      // UTC+2 before the change: 08:00 local is 06:00 UTC.
      expect(rows.map((row) => new Date(row.claimed_at).toISOString())).toEqual([
        '2031-10-10T06:00:00.000Z',
        '2031-10-17T06:00:00.000Z',
      ]);

      const after = await deliveries(stageNamed(p.afterDst, 'Design'));
      // UTC+1 after it: 08:00 local is 07:00 UTC.
      expect(after.map((row) => new Date(row.claimed_at).toISOString())).toEqual(['2031-11-08T07:00:00.000Z']);
    });

    it('tells every eligible Member, in the bell and by e-mail: bell_email, one recipient', async () => {
      expect(await bells(p.acrossDst.id, ada)).toHaveLength(2);
      expect(await bells(p.afterDst.id, ada)).toHaveLength(1);
      const [first] = await bells(p.acrossDst.id, ada);
      expect(first!.title).toContain(p.acrossDst.number);
      expect(first!.title).toContain('Design');
      expect(first!.title).toContain('2031-10-20');
      expect(first!.linkPath).toBe(`/projects/${p.acrossDst.id}?tab=stages`);
      for (const row of await deliveries(stageNamed(p.acrossDst, 'Design'))) {
        expect(row).toMatchObject({ outcome: 'bell_email', recipient_count: 1 });
      }
    });

    it('skips a deactivated Member, a Member out of reach, and everybody who is not a Member', async () => {
      for (const project of Object.values(p)) {
        expect(await bells(project.id, bob)).toEqual([]);
        expect(await bells(project.id, cyd)).toEqual([]);
        expect(await bells(project.id, dan)).toEqual([]);
      }
    });

    it('sends nothing for a Stage the Project has left, or for a closed Project', async () => {
      expect(await deliveries(stageNamed(p.leftStage, 'Design'))).toEqual([]);
      expect(await deliveries(stageNamed(p.closed, 'Design'))).toEqual([]);
      expect(await bells(p.leftStage.id, ada)).toEqual([]);
      expect(await bells(p.closed.id, ada)).toEqual([]);
    });

    it('a moved deadline re-arms the alert once; a deadline moved past its due day sends nothing', async () => {
      const rows = await deliveries(stageNamed(p.movedDeadline, 'Design'));
      expect(rows.map((row) => [row.deadline_on, local(new Date(row.claimed_at)).date])).toEqual([
        ['2031-10-15', '2031-10-14'],
        ['2031-10-22', '2031-10-21'],
      ]);
      expect(await bells(p.movedDeadline.id, ada)).toHaveLength(2);
    });

    it('none backdated on entering a Stage late; entering it on the due day still sends that day', async () => {
      expect(await deliveries(stageNamed(p.enteredLate, 'Build'))).toEqual([]);
      const onTime = await deliveries(stageNamed(p.enteredOnDueDay, 'Build'));
      expect(onTime.map((row) => local(new Date(row.claimed_at)))).toEqual([{ date: '2031-11-10', hour: 8 }]);
    });
  });

  describe('outcomes outside the timeline', () => {
    /** A Project whose Design alert (1 day before) is due on `dueOn`; Ada its one Member unless said otherwise. */
    const dueOn = async (
      title: string,
      dueOn: string,
      members: Array<{ adminUserId: string; roleIds: string[] }> = [{ adminUserId: ada.adminUserId, roleIds: [] }],
    ) => {
      const detail = await project(title, { Design: [1] }, { members });
      const [year, month, day] = dueOn.split('-').map(Number) as [number, number, number];
      await setDeadline(detail, 'Design', new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10));
      return detail;
    };
    /** 08:30 in Warsaw in December (UTC+1). */
    const at = (date: string) => new Date(`${date}T07:30:00.000Z`);

    it('with the bell switched off, Members are told by e-mail only: outcome email', async () => {
      const detail = await dueOn('bell off', '2031-12-10');
      await withModuleOff('admin_notifications', 'deactivated', () => sweep(at('2031-12-10')));
      expect(await bells(detail.id, ada)).toEqual([]);
      expect(mailsAbout(detail.number).map((message) => message.to)).toEqual([ada.email]);
      expect(await deliveries(stageNamed(detail, 'Design'))).toMatchObject([{ outcome: 'email', recipient_count: 1 }]);
    });

    it('nobody to tell is an outcome of its own: no_recipient', async () => {
      const none = await dueOn('no members', '2031-12-12', []);
      const outOfReach = await dueOn('only out of reach', '2031-12-12', [{ adminUserId: cyd.adminUserId, roleIds: [] }]);
      await sweep(at('2031-12-12'));
      expect(await deliveries(stageNamed(none, 'Design'))).toMatchObject([{ outcome: 'no_recipient', recipient_count: 0 }]);
      expect(await deliveries(stageNamed(outOfReach, 'Design'))).toMatchObject([{ outcome: 'no_recipient', recipient_count: 0 }]);
      expect(mailsAbout(none.number)).toEqual([]);
      expect(mailsAbout(outOfReach.number)).toEqual([]);
    });

    it('an alert whose Stage was left, or whose deadline moved, between claim and delivery is not sent (T144 F5)', async () => {
      const moved = await dueOn('moved after claim', '2031-12-18');
      const left = await dueOn('left after claim', '2031-12-18');
      // The store the composed service holds: between its claim and the
      // delivery, somebody moves one deadline and moves the other Project on.
      const store = (composed() as unknown as { deps: { store: { claim: (...args: unknown[]) => Promise<unknown> } } }).deps
        .store;
      const claim = store.claim;
      store.claim = async (...args: unknown[]) => {
        const claimed = await claim.apply(store, args);
        await h
          .em()
          .getConnection()
          .execute(`update "project_stages" set "deadline_on" = '2031-12-30' where "id" = ?`, [stageNamed(moved, 'Design')]);
        await h
          .em()
          .getConnection()
          .execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageNamed(left, 'Build'), left.id]);
        return claimed;
      };
      let summary: StageAlertSweepSummary;
      try {
        summary = await sweep(at('2031-12-18'));
      } finally {
        store.claim = claim;
      }
      expect(summary.claimed).toBe(2);
      expect(summary.withdrawn).toBe(2);
      for (const detail of [moved, left]) {
        expect(await bells(detail.id, ada)).toEqual([]);
        expect(mailsAbout(detail.number)).toEqual([]);
        expect(await deliveries(stageNamed(detail, 'Design'))).toMatchObject([{ outcome: 'no_recipient', recipient_count: 0 }]);
      }
    });

    it('two sweeps at once deliver once', async () => {
      const detail = await dueOn('concurrent', '2031-12-14');
      await Promise.all([sweep(at('2031-12-14')), sweep(at('2031-12-14'))]);
      expect(await deliveries(stageNamed(detail, 'Design'))).toHaveLength(1);
      expect(await bells(detail.id, ada)).toHaveLength(1);
      expect(mailsAbout(detail.number)).toHaveLength(1);
    });

    it('writes the e-mail in the Member’s language', async () => {
      await h.em().getConnection().execute(`update "admin_users" set "preferred_language" = 'pl' where "id" = ?`, [ada.adminUserId]);
      try {
        const detail = await dueOn('polish', '2031-12-16');
        await sweep(at('2031-12-16'));
        const [message] = mailsAbout(detail.number);
        expect(message?.subject).toContain('Termin etapu');
        expect(message?.text).toContain('Design');
      } finally {
        await h.em().getConnection().execute(`update "admin_users" set "preferred_language" = null where "id" = ?`, [ada.adminUserId]);
      }
    });

    it('a tick with nothing due asks the probe, outside any scope, and does not sweep', async () => {
      const pass = vi.fn(async () => undefined);
      const nothingDue = at('2031-12-20');
      await runWithoutTenantContext(() =>
        runStageAlertJob({ isPresent: () => true, hasWork: () => composed().hasWork(nothingDue), tick: pass }),
      );
      expect(pass).not.toHaveBeenCalled();
      // And one with an alert due does.
      await dueOn('probe', '2031-12-21');
      await runWithoutTenantContext(() =>
        runStageAlertJob({ isPresent: () => true, hasWork: () => composed().hasWork(at('2031-12-21')), tick: pass }),
      );
      expect(pass).toHaveBeenCalledTimes(1);
    });

    describe('a claim its pass never settled (issue #462)', () => {
      const MINUTE = 60 * 1000;
      /**
       * The clock of these cases is in 2040, after every other file's: a claim
       * is stale to any clock thirty minutes past it, so one left unsettled here
       * for a moment must not look interrupted to another file's probe — the
       * idle-tick audit's, in 2033, asks the same table.
       */
      const CLOCK = (day: number) => new Date(Date.UTC(2040, 0, day, 7, 30));
      /** A claim as a pass that died after claiming leaves it: inserted, with no outcome. */
      const claimLeftBy = async (detail: ProjectDetail, claimedAt: Date): Promise<string> => {
        const rows = (await h
          .em()
          .getConnection()
          .execute(
            `insert into "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on", "claimed_at")
             select s."id", 1, s."deadline_on", ? from "project_stages" s where s."id" = ? returning "id"`,
            [claimedAt, stageNamed(detail, 'Design')],
          )) as Array<{ id: string }>;
        return rows[0]!.id;
      };
      const store = () =>
        (composed() as unknown as { deps: { store: StageAlertStorePort } }).deps.store;

      it('is marked interrupted by the next pass once it is thirty minutes old, and is never delivered', async () => {
        const crashed = await dueOn('crashed', '2031-12-26');
        const recent = await dueOn('still sending', '2031-12-26');
        const now = CLOCK(2);
        await claimLeftBy(crashed, new Date(now.getTime() - 31 * MINUTE));
        const recentId = await claimLeftBy(recent, new Date(now.getTime() - 5 * MINUTE));

        const summary = await sweep(now);

        // Platform-wide: another file's abandoned claim would be marked by the same pass.
        expect(summary.interrupted).toBeGreaterThanOrEqual(1);
        expect(await deliveries(stageNamed(crashed, 'Design'))).toMatchObject([{ outcome: 'interrupted', recipient_count: null }]);
        // A claim younger than the bound may belong to a pass still delivering it.
        expect(await deliveries(stageNamed(recent, 'Design'))).toMatchObject([{ outcome: null }]);
        for (const detail of [crashed, recent]) {
          expect(await bells(detail.id, ada)).toEqual([]);
          expect(mailsAbout(detail.number)).toEqual([]);
        }
        // Settled by its pass after all: what it delivered stands, and nothing is left unsettled here.
        await enterSystemScope('test: projects stage alerts', () =>
          store().settle(recentId, 'bell', 1, new Date(now.getTime() + MINUTE)),
        );
        // Marked once, and still not delivered by a later pass.
        await sweep(new Date(now.getTime() + 15 * MINUTE));
        expect(await deliveries(stageNamed(crashed, 'Design'))).toMatchObject([{ outcome: 'interrupted' }]);
        expect(mailsAbout(crashed.number)).toEqual([]);
      });

      it('is work for the probe, so a tick with nothing else due still marks it', async () => {
        const crashed = await dueOn('crashed probe', '2031-12-27');
        const now = CLOCK(3);
        // The alert was claimed and lost; nothing is due that day.
        await claimLeftBy(crashed, new Date(now.getTime() - 45 * MINUTE));
        const pass = vi.fn(async () => undefined);
        await runWithoutTenantContext(() =>
          runStageAlertJob({ isPresent: () => true, hasWork: () => composed().hasWork(now), tick: pass }),
        );
        expect(pass).toHaveBeenCalledTimes(1);
        await tick(now);
        expect(await deliveries(stageNamed(crashed, 'Design'))).toMatchObject([{ outcome: 'interrupted' }]);
      });

      it('a pass that outlives the bound replaces the presumption with what it delivered, or gives the claim back', async () => {
        const slow = await dueOn('slow pass', '2031-12-28');
        const givenBack = await dueOn('slow pass given back', '2031-12-28');
        const now = CLOCK(4);
        const settled = await claimLeftBy(slow, new Date(now.getTime() - 40 * MINUTE));
        const released = await claimLeftBy(givenBack, new Date(now.getTime() - 40 * MINUTE));
        await enterSystemScope('test: projects stage alerts', async () => {
          await store().expire(now);
          await store().settle(settled, 'bell', 1, now);
          await store().release([released]);
        });
        expect(await deliveries(stageNamed(slow, 'Design'))).toMatchObject([{ outcome: 'bell', recipient_count: 1 }]);
        expect(await deliveries(stageNamed(givenBack, 'Design'))).toEqual([]);
      });
    });

    it('the alert-zone setting is honoured: the same instant is another day in another zone', async () => {
      const detail = await dueOn('zone', '2031-12-23');
      const setZone = (value: string) =>
        h.app.inject({
          method: 'PUT',
          url: '/api/v1/admin/settings/projects.alerts_time_zone/value',
          cookies: PROJECTS_ADMIN,
          payload: { scope: 'all', value },
        });
      try {
        expect((await setZone('Pacific/Kiritimati')).statusCode).toBeLessThan(400);
        // 22 December, 20:00 UTC is already 23 December, 10:00 at UTC+14.
        await sweep(new Date('2031-12-22T20:00:00.000Z'));
      } finally {
        expect((await setZone(ZONE)).statusCode).toBeLessThan(400);
      }
      expect(await deliveries(stageNamed(detail, 'Design'))).toHaveLength(1);
    });
  });
});
