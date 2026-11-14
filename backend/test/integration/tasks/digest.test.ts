import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TaskDigestSubscriptionResponseSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type TaskContextDescriptor,
  type TaskContextRegistryPort,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import type { TaskDigestService } from '../../../../packages/modules/tasks/src/backend/services/digest-service.js';
import {
  runTasksRemindersJob,
  type TasksRemindersJob,
} from '../../../../packages/modules/tasks/src/backend/workers/tasks-reminders-worker.js';

/**
 * User Story 7 — the daily digest (`specs/165-task-management/` spec US7
 * scenarios 5 and 6, FR-036, SC-007; research R-18).
 *
 * **A controlled clock** in `Europe/Warsaw`: each pass is driven with the `now`
 * a tick would have had. The claim is the subscription's `last_sent_on`, set to
 * the local day by the pass that sends — so the cases reset it between
 * timelines, which run on dates no other file uses.
 *
 * **An empty day consumes the day** (the chosen semantics, asserted below): the
 * pass at the subscriber's hour looks once, finds nothing due, sends nothing
 * and closes the day; a Task that becomes due later that day is in the next
 * day's digest (as overdue), never in a second one the same day. The next
 * day's claim is untouched.
 *
 * Ben subscribes at 08:00. His Tasks: one due today, one overdue — listed; one
 * due tomorrow, a closed one, a draft, someone else's private one he is
 * assigned to, one in a context he may not see, and one he is not assigned
 * to — not listed.
 */
describe('tasks — the daily digest (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void; email: string };
  let ben: Person;
  let cal: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];
  const PROBE = 'digest_probe';
  const hiddenContext = randomUUID();

  const mail: { sent: EmailMailerSendInput[] } = { sent: [] };
  const mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      mail.sent.push(input);
      return { status: 'sent' };
    },
  };

  const composed = () => h.container.resolve('tasksDigestService') as TaskDigestService;
  const pass = (now: Date) => enterSystemScope('test: tasks digest', () => composed().pass(now));
  const job = (now: Date): Promise<void> =>
    runWithoutTenantContext(() => runTasksRemindersJob(h.container.resolve('tasksRemindersJob') as TasksRemindersJob, now));

  function call(method: 'GET' | 'PUT' | 'DELETE' | 'PATCH', path: string, payload?: unknown, cookies = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  const person = async (label: string, permissions: string[]): Promise<Person> => {
    const seeded = await seedCrmAdmin(h.em(), `digest-${label}`, permissions);
    const rows = (await h.em().getConnection().execute(`select "email" from "admin_users" where "id" = ?`, [
      seeded.adminUserId,
    ])) as Array<{ email: string }>;
    return { ...seeded, email: rows[0]!.email };
  };

  /** A Task seeded directly — the digest reads the table, and drafts are written in US8. */
  async function seedTask(input: {
    title: string;
    dueOn: string | null;
    assignee?: Person | null;
    status?: string;
    draft?: boolean;
    private?: boolean;
    context?: string | null;
  }): Promise<{ id: string; number: string }> {
    const id = randomUUID();
    const number = `TSK-D${id.slice(0, 6).toUpperCase()}`;
    const connection = h.em().getConnection();
    await connection.execute(
      `insert into "tasks" ("id", "number", "title", "status", "due_on", "is_draft", "is_private",
                            "created_by_admin_user_id", "context_type", "context_id", "published_at", "created_at", "updated_at")
       values (?, ?, ?, ?, ?::date, ?, ?, ?, ?, ?, now(), now(), now())`,
      [
        id,
        number,
        input.title,
        input.status ?? 'todo',
        input.dueOn,
        input.draft ?? false,
        input.private ?? false,
        TEST_ADMIN_ID,
        input.context ? PROBE : null,
        input.context ?? null,
      ],
    );
    const assignee = input.assignee === undefined ? ben : input.assignee;
    if (assignee) {
      await connection.execute(`insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, now())`, [
        id,
        assignee.adminUserId,
      ]);
    }
    created.push(id);
    return { id, number };
  }

  /** Clears the claims of this file's own two subscribers, nobody else's (issue #607). */
  const resetClaims = () =>
    h
      .em()
      .getConnection()
      .execute(`update "task_digest_subscriptions" set "last_sent_on" = null where "admin_user_id" in (?)`, [
        [ben.adminUserId, cal.adminUserId],
      ]);
  const digestsTo = (who: Person) => mail.sent.filter((message) => message.to === who.email);
  const bellsFor = (who: Person) =>
    h.em().find(
      AdminNotification,
      { kind: 'tasks.digest.daily', targetAdminUserId: who.adminUserId },
      { filters: false, orderBy: { createdAt: 'asc' } },
    );

  /** `local` is a wall-clock time in Europe/Warsaw; `offset` its UTC offset in hours that day. */
  const at = (local: string, offset: 1 | 2): Date => new Date(`${local}:00.000+0${offset}:00`);

  let dueToday: { id: string; number: string };
  let overdue: { id: string; number: string };
  const excluded: Array<{ id: string; number: string }> = [];

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const zone = await call('PUT', '/settings/time-zone', { timeZone: 'Europe/Warsaw' });
    expect(zone.statusCode, zone.body).toBe(200);
    const probe: TaskContextDescriptor = {
      contextType: PROBE,
      ownerModuleId: 'crm',
      allVisibleContextIds: async () => [],
      visibleContextIds: async () => new Set(),
      canSeeAs: async () => false,
      canChangeTasks: async () => false,
      describe: async () => new Map(),
    };
    h.container.resolve<TaskContextRegistryPort>('taskContextRegistry').register(probe);

    ben = await person('ben', ['tasks:read']);
    cal = await person('cal', ['tasks:read']);

    dueToday = await seedTask({ title: 'Call the installer', dueOn: '2032-03-10' });
    overdue = await seedTask({ title: 'Measure the showroom', dueOn: '2032-03-01' });
    excluded.push(
      await seedTask({ title: 'Due tomorrow', dueOn: '2032-03-11' }),
      await seedTask({ title: 'Already done', dueOn: '2032-03-01', status: 'done' }),
      await seedTask({ title: 'A draft', dueOn: '2032-03-01', draft: true }),
      await seedTask({ title: 'Someone else’s private task', dueOn: '2032-03-01', private: true }),
      await seedTask({ title: 'In a record Ben may not see', dueOn: '2032-03-01', context: hiddenContext }),
      await seedTask({ title: 'Not Ben’s', dueOn: '2032-03-01', assignee: cal }),
    );
  });

  beforeEach(() => {
    mail.sent.length = 0;
  });

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from "task_digest_subscriptions" where "admin_user_id" = any(?::uuid[])`, [
      `{${[ben?.adminUserId, cal?.adminUserId].filter(Boolean).join(',')}}`,
    ]);
    for (const who of [ben, cal]) who?.undo();
    if (created.length > 0) {
      await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  it('is off by default; a subscription is the caller’s own hour, and DELETE turns it off', async () => {
    const off = await call('GET', '/me/digest', undefined, ben.cookies);
    expect(off.statusCode, off.body).toBe(200);
    expect(TaskDigestSubscriptionResponseSchema.parse(off.json()).data).toBeNull();

    const on = await call('PUT', '/me/digest', { hour: 8 }, ben.cookies);
    expect(on.statusCode, on.body).toBe(200);
    expect(TaskDigestSubscriptionResponseSchema.parse(on.json()).data).toEqual({ hour: 8 });
    const read = await call('GET', '/me/digest', undefined, ben.cookies);
    expect(TaskDigestSubscriptionResponseSchema.parse(read.json()).data).toEqual({ hour: 8 });
    // Cal's is his own.
    const cals = await call('GET', '/me/digest', undefined, cal.cookies);
    expect(TaskDigestSubscriptionResponseSchema.parse(cals.json()).data).toBeNull();

    const refused = await call('PUT', '/me/digest', { hour: 24 }, ben.cookies);
    expect(refused.statusCode, refused.body).toBe(400);
    const audited = await h.auditLogService.query({ objectType: 'task_digest_subscription', objectId: ben.adminUserId });
    expect(audited.map((entry) => entry.action)).toContain('tasks.digest.subscribe');
  });

  it('sends exactly one at the hour — passes at 07:55, 08:05 and 08:20 — listing only the right Tasks', async () => {
    await call('PUT', '/me/digest', { hour: 8 }, ben.cookies);
    await resetClaims();

    await pass(at('2032-03-10T07:55', 1));
    expect(digestsTo(ben)).toHaveLength(0);
    await pass(at('2032-03-10T08:05', 1));
    await pass(at('2032-03-10T08:20', 1));

    expect(digestsTo(ben)).toHaveLength(1);
    const [message] = digestsTo(ben);
    expect(message!.messageId).toMatch(/^tasks_daily_digest:/);
    for (const listed of [dueToday, overdue]) expect(message!.text).toContain(listed.number);
    for (const left of excluded) expect(message!.text).not.toContain(left.number);
    const bells = await bellsFor(ben);
    expect(bells).toHaveLength(1);
    expect(bells[0]!.titleMessage).toMatchObject({ scope: 'tasks', key: 'notifications.digest.title', params: { count: 2 } });
    expect(bells[0]!.linkPath).toBe('/tasks/mine');

    // The next day, one more.
    await pass(at('2032-03-11T08:05', 1));
    await pass(at('2032-03-11T09:30', 1));
    expect(digestsTo(ben)).toHaveLength(2);
    expect(await bellsFor(ben)).toHaveLength(2);
  });

  it.each([
    ['the autumn change, 2026-10-25', ['2026-10-24', '2026-10-25', '2026-10-26']],
    ['the spring change, 2027-03-28', ['2027-03-27', '2027-03-28', '2027-03-29']],
  ])('sends one a day across %s in Europe/Warsaw', async (_change, days) => {
    await call('PUT', '/me/digest', { hour: 2 }, ben.cookies);
    await resetClaims();
    // The 2032 Tasks are not due yet in these years: one long overdue, for the length of the case.
    const longOverdue = await seedTask({ title: 'Long overdue', dueOn: '2020-01-01' });
    // Every fifteen minutes, from just after local midnight starting the first day to just after the last ends.
    const start = Date.parse(`${days[0]}T00:00:00.000Z`) - 60 * 60_000;
    const end = Date.parse(`${days[2]}T23:00:00.000Z`);
    for (let t = start; t <= end; t += 15 * 60_000) await pass(new Date(t));

    expect(digestsTo(ben)).toHaveLength(3);
    await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [longOverdue.id]);
  });

  it('sends nothing on an empty day, and the day is closed — the next day is not', async () => {
    await call('PUT', '/me/digest', { hour: 8 }, cal.cookies);
    await call('DELETE', '/me/digest', undefined, ben.cookies);
    await resetClaims();
    // Cal's only Task (`Not Ben’s`) is overdue from 2032-03-01; before that day he has none due.
    await pass(at('2032-02-20T08:05', 1));
    expect(digestsTo(cal)).toHaveLength(0);
    expect(await bellsFor(cal)).toHaveLength(0);
    const claimed = (await h
      .em()
      .getConnection()
      .execute(`select to_char("last_sent_on", 'YYYY-MM-DD') as "day" from "task_digest_subscriptions" where "admin_user_id" = ?`, [
        cal.adminUserId,
      ])) as Array<{ day: string | null }>;
    expect(claimed[0]!.day).toBe('2032-02-20');

    // A Task falling due later that day goes into no second digest the same day…
    const later = await seedTask({ title: 'Due the same afternoon', dueOn: '2032-02-20', assignee: cal });
    await pass(at('2032-02-20T15:00', 1));
    expect(digestsTo(cal)).toHaveLength(0);
    // …and into the next day's, as overdue.
    await pass(at('2032-02-21T08:05', 1));
    expect(digestsTo(cal)).toHaveLength(1);
    expect(digestsTo(cal)[0]!.text).toContain(later.number);
  });

  it('stops after an unsubscribe', async () => {
    await call('PUT', '/me/digest', { hour: 8 }, ben.cookies);
    await resetClaims();
    await pass(at('2032-03-12T08:05', 1));
    expect(digestsTo(ben)).toHaveLength(1);
    const off = await call('DELETE', '/me/digest', undefined, ben.cookies);
    expect(off.statusCode, off.body).toBe(204);
    await pass(at('2032-03-13T08:05', 1));
    expect(digestsTo(ben)).toHaveLength(1);
  });

  it('sends nothing while Tasks is off, and catches nothing up', async () => {
    await call('PUT', '/me/digest', { hour: 8 }, ben.cookies);
    await resetClaims();
    await withModuleOff('tasks', 'deactivated', () => job(at('2032-03-14T08:05', 1)));
    expect(mail.sent).toEqual([]);
    // Back on the next day: that day's digest only.
    await job(at('2032-03-15T08:05', 1));
    expect(digestsTo(ben)).toHaveLength(1);
    await job(at('2032-03-15T08:30', 1));
    expect(digestsTo(ben)).toHaveLength(1);
  });
});
