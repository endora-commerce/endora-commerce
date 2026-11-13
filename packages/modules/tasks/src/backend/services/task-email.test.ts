import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransactionalEmailSendInput } from '@endora-commerce/contracts';
import { renderDirectives } from '@endora-commerce/email-components/directives/directive-engine';
import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
import { renderEmailText } from '@endora-commerce/email-components/render/render-email-text';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import { TASK_DIGEST_DEFAULT } from '../email-templates/digest-defaults.js';
import { TASK_REMINDER_DEFAULT } from '../email-templates/reminder-defaults.js';
import { createTaskEmail, digestItem, dueWords, taskEmailLanguage, type TaskEmailDeps } from './task-email.js';

describe('the Task e-mails (R-17, R-18)', () => {
  it('writes Polish for a Polish preference and English for everything else', () => {
    expect(taskEmailLanguage('pl')).toBe('pl-PL');
    expect(taskEmailLanguage('pl-PL')).toBe('pl-PL');
    for (const other of ['en', 'de', null, '']) expect(taskEmailLanguage(other)).toBe('en-US');
  });

  it('says a due time in the Tasks time zone, and a date alone as a date', () => {
    expect(dueWords({ dueOn: '2032-03-10', dueAt: new Date('2032-03-10T09:30:00Z') }, 'en-US', 'Europe/Warsaw')).toContain('10:30');
    expect(dueWords({ dueOn: '2032-03-10', dueAt: null }, 'en-US', 'Europe/Warsaw')).toBe('March 10, 2032');
    expect(dueWords({ dueOn: null, dueAt: null }, 'en-US', 'Europe/Warsaw')).toBeNull();
  });

  it('hands the template each digest Task’s facts, never a sentence', () => {
    expect(digestItem({ taskId: 't1', number: 'TSK-1', title: ' Call\nthe  installer ', dueOn: '2032-03-01', dueAt: null }, '2032-03-10', 'en-US')).toEqual({
      number: 'TSK-1',
      title: 'Call the installer',
      due: 'March 1, 2032',
      overdue: true,
      today: false,
    });
    expect(digestItem({ taskId: 't2', number: 'TSK-2', title: 'Due', dueOn: '2032-03-10', dueAt: null }, '2032-03-10', 'pl-PL')).toMatchObject({
      overdue: false,
      today: true,
    });
  });

  it('sends one message per delivery row and one per person and day, with no Sales Channel', async () => {
    const sent: TransactionalEmailSendInput[] = [];
    const email = createTaskEmail({
      sender: () => ({
        send: async (input) => {
          sent.push(input);
          return { status: 'sent' };
        },
      }),
      log: vi.fn(),
      adminBaseUrl: () => null,
    });
    const recipient = { adminUserId: 'a1', to: 'ann@example.test', preferredLanguage: 'pl' };
    await email.reminder({
      ...recipient,
      deliveryId: 'd1',
      taskId: 't1',
      number: 'TSK-1',
      title: 'Measure',
      dueOn: null,
      dueAt: null,
      timeZone: 'Europe/Warsaw',
    });
    await email.digest({
      ...recipient,
      date: '2032-03-10',
      timeZone: 'Europe/Warsaw',
      tasks: [{ taskId: 't1', number: 'TSK-1', title: 'Measure', dueOn: '2032-03-10', dueAt: null }],
    });
    expect(sent.map((m) => [m.code, m.messageId, m.salesChannelId, m.language])).toEqual([
      ['tasks_task_reminder', 'tasks_task_reminder:d1', null, 'pl-PL'],
      ['tasks_daily_digest', 'tasks_daily_digest:a1:2032-03-10', null, 'pl-PL'],
    ]);
  });

  it('answers what happened and never throws for a message that did not go out', async () => {
    const log = vi.fn();
    const failing = createTaskEmail({
      sender: () => ({
        send: async () => {
          throw new Error('smtp down');
        },
      }),
      log,
    });
    const input = { adminUserId: 'a1', to: 'ann@example.test', preferredLanguage: null, date: '2032-03-10', timeZone: 'UTC', tasks: [] };
    await expect(failing.digest(input)).resolves.toEqual({ sent: false, reason: 'failed' });
    await expect(createTaskEmail({ sender: () => undefined, log }).digest(input)).resolves.toEqual({ sent: false, reason: 'no_sender' });
    await expect(failing.digest({ ...input, to: '' })).resolves.toEqual({ sent: false, reason: 'no_address' });
  });
});

/**
 * The links into the admin panel (follow-up to issue #185): the reminder opens
 * its Task, the digest each Task it lists and *My tasks* — the bell entries'
 * addresses, made absolute on the platform's `ADMIN_BASE_URL`, and left out
 * when that is not configured, so no e-mail carries a relative or a guessed
 * (`localhost`) link.
 */
describe('the Task e-mails’ links into the admin panel', () => {
  const ORIGINAL = process.env['ADMIN_BASE_URL'];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['ADMIN_BASE_URL'];
    else process.env['ADMIN_BASE_URL'] = ORIGINAL;
  });

  const BASE = 'https://shop.example.com/admin';
  const recipient = { adminUserId: 'a1', to: 'ann@example.test', preferredLanguage: null };
  const reminder = { ...recipient, deliveryId: 'd1', taskId: 't1', number: 'TSK-1', title: 'Measure', dueOn: null, dueAt: null, timeZone: 'UTC' };
  const digest = {
    ...recipient,
    date: '2032-03-10',
    timeZone: 'UTC',
    tasks: [
      { taskId: 't1', number: 'TSK-1', title: 'Measure', dueOn: '2032-03-01', dueAt: null },
      { taskId: 't2', number: 'TSK-2', title: 'Call', dueOn: '2032-03-10', dueAt: null },
    ],
  };

  function sending(deps: Partial<TaskEmailDeps> = {}) {
    const sent: TransactionalEmailSendInput[] = [];
    const email = createTaskEmail({
      sender: () => ({ send: async (input) => (sent.push(input), { status: 'sent' as const }) }),
      log: vi.fn(),
      ...deps,
    });
    return { email, sent };
  }

  it('links the reminder to its Task, and the digest to each Task and to My tasks', async () => {
    const { email, sent } = sending({ adminBaseUrl: () => BASE });
    await email.reminder(reminder);
    await email.digest(digest);
    expect(sent[0]?.variables).toMatchObject({ task: { adminUrl: `${BASE}/tasks/t1` } });
    expect(sent[1]?.variables).toMatchObject({
      digest: {
        adminUrl: `${BASE}/tasks/mine`,
        tasks: [{ adminUrl: `${BASE}/tasks/t1` }, { adminUrl: `${BASE}/tasks/t2` }],
      },
    });
  });

  it('carries no link variable at all when the admin address is not configured', async () => {
    const { email, sent } = sending({ adminBaseUrl: () => null });
    await email.reminder(reminder);
    await email.digest(digest);
    expect(sent[0]?.variables?.['task']).not.toHaveProperty('adminUrl');
    const sentDigest = sent[1]?.variables?.['digest'] as { tasks: object[] };
    expect(sentDigest).not.toHaveProperty('adminUrl');
    for (const task of sentDigest.tasks) expect(task).not.toHaveProperty('adminUrl');
  });

  it('reads the platform’s ADMIN_BASE_URL when no reader is injected', async () => {
    process.env['ADMIN_BASE_URL'] = `${BASE}/`;
    const { email, sent } = sending();
    await email.reminder(reminder);
    expect(sent[0]?.variables).toMatchObject({ task: { adminUrl: `${BASE}/tasks/t1` } });
  });

  const html = (content: PuckDataTree, ctx: Record<string, unknown>) =>
    renderDirectives(renderEmailHtml(content), ctx, { escape: true });
  const text = (content: PuckDataTree, ctx: Record<string, unknown>) => renderDirectives(renderEmailText(content), ctx);

  it.each(['en-US', 'pl-PL'] as const)('the %s reminder default shows a button to the Task, and nothing without one', (language) => {
    const content = TASK_REMINDER_DEFAULT.defaultContent.languages[language] as PuckDataTree;
    const base = { task: { number: 'TSK-1', title: 'Measure', due: '' } };
    const linked = { task: { ...base.task, adminUrl: `${BASE}/tasks/t1` } };
    expect(html(content, linked)).toContain(`href="${BASE}/tasks/t1"`);
    expect(text(content, linked)).toContain(`${BASE}/tasks/t1`);
    expect(html(content, base)).not.toContain('<a href');
    expect(text(content, base)).not.toContain('http');
  });

  it.each(['en-US', 'pl-PL'] as const)('the %s digest default links each Task and My tasks, and nothing without them', (language) => {
    const content = TASK_DIGEST_DEFAULT.defaultContent.languages[language] as PuckDataTree;
    const tasks = [
      { number: 'TSK-1', title: 'Measure', due: 'March 1', overdue: true, today: false },
      { number: 'TSK-2', title: 'Call', due: 'March 10', overdue: false, today: true },
    ];
    const base = { digest: { date: 'March 10', taskCount: '2', taskList: '', tasks } };
    const linked = {
      digest: {
        ...base.digest,
        adminUrl: `${BASE}/tasks/mine`,
        tasks: tasks.map((task, i) => ({ ...task, adminUrl: `${BASE}/tasks/t${i + 1}` })),
      },
    };
    const linkedHtml = html(content, linked);
    for (const href of [`${BASE}/tasks/t1`, `${BASE}/tasks/t2`, `${BASE}/tasks/mine`]) {
      expect(linkedHtml).toContain(`href="${href}"`);
    }
    expect(linkedHtml).toContain('TSK-1 Measure');
    expect(text(content, linked)).toContain(`${BASE}/tasks/mine`);
    expect(text(content, linked)).toContain('TSK-2 Call');

    const bare = html(content, base);
    expect(bare).toContain('TSK-1 Measure');
    expect(bare).toContain('TSK-2 Call');
    expect(bare).not.toContain('<a href');
    expect(text(content, base)).not.toContain('http');
  });
});
