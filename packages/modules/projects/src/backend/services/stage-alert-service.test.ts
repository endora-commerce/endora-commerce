import { describe, expect, it, vi } from 'vitest';
import type { AdminUserRecord } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type { ProjectNotification, ProjectNotificationOutcome } from './project-notifier.js';
import type { StageAlertEmailInput, StageAlertEmailResult } from './stage-alert-email.js';
import {
  STAGE_ALERT_SEND_HOUR,
  StageAlertService,
  alertDueOn,
  stageAlertClock,
  stageAlertOutcome,
  type ClaimedStageAlert,
  type StageAlertClock,
  type StageAlertStorePort,
} from './stage-alert-service.js';

/**
 * Deadline alerts on Stages — the pure half and the claim/settle state machine
 * (`specs/163-projects-and-tasks/research.md` R-12; spec FR-035, SC-004).
 *
 * The store is stood in for: what is held here is what the service asks of it
 * and in which order — claim, deliver outside any transaction, then settle what
 * the delivery came to or give the claim back when nothing was written. The
 * SQL itself is `backend/test/integration/projects/stage-alerts.test.ts`'s.
 */

const ZONE = 'Europe/Warsaw';

describe('the due day of an alert', () => {
  it('is the deadline minus the offset, in calendar days', () => {
    expect(alertDueOn('2026-10-30', 3)).toBe('2026-10-27');
    expect(alertDueOn('2026-11-01', 1)).toBe('2026-10-31');
    expect(alertDueOn('2027-03-01', 1)).toBe('2027-02-28');
    expect(alertDueOn('2028-03-01', 1)).toBe('2028-02-29');
    expect(alertDueOn('2026-12-31', 365)).toBe('2025-12-31');
  });
});

describe('the alert clock — "today" and "from 08:00" in the alert zone', () => {
  it(`sends from ${STAGE_ALERT_SEND_HOUR}:00 local time, before the October DST change (UTC+2)`, () => {
    expect(stageAlertClock(ZONE, new Date('2026-10-24T05:59:00Z'))).toEqual({ today: '2026-10-24', sending: false });
    expect(stageAlertClock(ZONE, new Date('2026-10-24T06:00:00Z'))).toEqual({ today: '2026-10-24', sending: true });
  });

  it('and after it (UTC+1): the same local hour is an hour later in UTC', () => {
    expect(stageAlertClock(ZONE, new Date('2026-10-26T06:59:00Z'))).toEqual({ today: '2026-10-26', sending: false });
    expect(stageAlertClock(ZONE, new Date('2026-10-26T07:00:00Z'))).toEqual({ today: '2026-10-26', sending: true });
  });

  it('on the night of the change itself, and across local midnight', () => {
    // 25 October 2026, 01:30 UTC is 02:30 local after the clocks went back.
    expect(stageAlertClock(ZONE, new Date('2026-10-25T01:30:00Z'))).toEqual({ today: '2026-10-25', sending: false });
    expect(stageAlertClock(ZONE, new Date('2026-10-25T07:00:00Z'))).toEqual({ today: '2026-10-25', sending: true });
    // 23:30 UTC on the 26th is already the 27th in Warsaw, at half past midnight.
    expect(stageAlertClock(ZONE, new Date('2026-10-26T23:30:00Z'))).toEqual({ today: '2026-10-27', sending: false });
    // And still the 26th, late in the evening, for a zone behind UTC.
    expect(stageAlertClock('America/New_York', new Date('2026-10-27T02:00:00Z'))).toEqual({
      today: '2026-10-26',
      sending: true,
    });
  });

  it('refuses a zone that is not one', () => {
    expect(() => stageAlertClock('Mars/Olympus_Mons', new Date())).toThrow(RangeError);
  });
});

describe('what a delivered alert came to', () => {
  it.each([
    [{ recipients: 0, bell: 0, email: 0 }, 'no_recipient'],
    [{ recipients: 2, bell: 2, email: 2 }, 'bell_email'],
    [{ recipients: 2, bell: 2, email: 1 }, 'bell_email'],
    [{ recipients: 2, bell: 2, email: 0 }, 'bell'],
    [{ recipients: 2, bell: 0, email: 2 }, 'email'],
    [{ recipients: 2, bell: 0, email: 0 }, 'undeliverable'],
  ] as const)('%o → %s', (tally, outcome) => {
    expect(stageAlertOutcome(tally)).toBe(outcome);
  });
});

// --- the state machine ---------------------------------------------------------

const PROJECT = '00000000-0000-4000-8000-000000000001';
const SENDING = new Date('2026-10-26T07:15:00Z'); // 08:15 in Warsaw
const BEFORE_EIGHT = new Date('2026-10-26T06:45:00Z'); // 07:45 in Warsaw

const claim = (id: string, overrides: Partial<ClaimedStageAlert> = {}): ClaimedStageAlert => ({
  id,
  stageId: `stage-${id}`,
  offsetDays: 3,
  deadlineOn: '2026-10-29',
  projectId: PROJECT,
  projectNumber: 'PRJ-000042',
  stageName: 'Design',
  ...overrides,
});

const admin = (id: string, overrides: Partial<AdminUserRecord> = {}): AdminUserRecord => ({
  id,
  email: `${id}@example.test`,
  firstName: id,
  lastName: 'Member',
  adminRoleId: null,
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
  preferredLanguage: null,
  avatarAssetId: null,
  bio: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  ...overrides,
});

interface Harness {
  service: StageAlertService;
  store: {
    [K in keyof StageAlertStorePort]: ReturnType<typeof vi.fn>;
  };
  bells: ProjectNotification[];
  mails: StageAlertEmailInput[];
}

function harness(options: {
  claims?: ClaimedStageAlert[];
  members?: string[];
  /** Whether a claim still stands when its delivery begins (default: yes). */
  stillDue?: boolean;
  visible?: (adminUserId: string) => boolean;
  people?: AdminUserRecord[];
  bell?: (notification: ProjectNotification) => Promise<ProjectNotificationOutcome>;
  mail?: (input: StageAlertEmailInput) => Promise<StageAlertEmailResult>;
} = {}): Harness {
  const bells: ProjectNotification[] = [];
  const mails: StageAlertEmailInput[] = [];
  const members = options.members ?? ['ada', 'bob'];
  const people = options.people ?? members.map((id) => admin(id));
  const store = {
    hasSweepWork: vi.fn(async (_clock: StageAlertClock) => true),
    claim: vi.fn(async (_clock: StageAlertClock, _now: Date) => options.claims ?? [claim('a1')]),
    stillDue: vi.fn(async (_claim: ClaimedStageAlert) => options.stillDue ?? true),
    memberIdsOf: vi.fn(async (_projectId: string) => members),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const service = new StageAlertService({
    store,
    timeZone: async () => ZONE,
    access: { canSeeAs: vi.fn(async (adminUserId: string) => (options.visible ?? (() => true))(adminUserId)) },
    adminUsers: { findByIds: vi.fn(async (ids: string[]) => people.filter((person) => ids.includes(person.id))) },
    notifier: {
      notify: async (notification) => {
        bells.push(notification);
        return options.bell ? options.bell(notification) : 'recorded';
      },
    },
    email: {
      send: async (input) => {
        mails.push(input);
        return options.mail ? options.mail(input) : { sent: true };
      },
    },
    log: () => undefined,
  });
  return { service, store, bells, mails };
}

describe('StageAlertService — claim, deliver, settle', () => {
  it('claims nothing before 08:00 local time, and asks the store nothing', async () => {
    const { service, store } = harness();
    const summary = await service.sweep(BEFORE_EIGHT);
    expect(summary.claimed).toBe(0);
    expect(store.claim).not.toHaveBeenCalled();
    expect(await service.hasWork(BEFORE_EIGHT)).toBe(false);
    expect(store.hasSweepWork).not.toHaveBeenCalled();
  });

  it('from 08:00 asks the store for today in the alert zone', async () => {
    const { service, store } = harness();
    expect(await service.hasWork(SENDING)).toBe(true);
    expect(store.hasSweepWork).toHaveBeenCalledWith({ today: '2026-10-26', sending: true });
    await service.sweep(SENDING);
    expect(store.claim).toHaveBeenCalledWith({ today: '2026-10-26', sending: true }, SENDING);
  });

  it('tells every Member who may see the Project, in the bell and by e-mail, and settles bell_email', async () => {
    const { service, store, bells, mails } = harness({ members: ['ada', 'bob', 'cyd'], visible: (id) => id !== 'cyd' });
    const summary = await service.sweep(SENDING);

    expect(bells.map((bell) => bell.targetAdminUserId)).toEqual(['ada', 'bob']);
    expect(bells[0]).toMatchObject({ kind: 'projects.project.stage_deadline', projectId: PROJECT });
    expect(mails.map((mail) => mail.to)).toEqual(['ada@example.test', 'bob@example.test']);
    expect(mails[0]).toMatchObject({ deliveryId: 'a1', number: 'PRJ-000042', stageName: 'Design', deadlineOn: '2026-10-29', daysLeft: 3 });
    expect(store.settle).toHaveBeenCalledWith('a1', 'bell_email', 2, SENDING);
    expect(store.release).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ claimed: 1, released: 0, outcomes: { bell_email: 1 } });
  });

  it('a claim no longer due when its delivery begins tells nobody and settles no_recipient (T144 F5)', async () => {
    const { service, store, bells, mails } = harness({ stillDue: false });
    const summary = await service.sweep(SENDING);
    expect(store.stillDue).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(store.memberIdsOf).not.toHaveBeenCalled();
    expect(bells).toEqual([]);
    expect(mails).toEqual([]);
    expect(store.settle).toHaveBeenCalledWith('a1', 'no_recipient', 0, SENDING);
    expect(summary).toMatchObject({ claimed: 1, released: 0, withdrawn: 1, outcomes: { no_recipient: 1 } });
  });

  it('a deactivated Member is skipped even if the access check let them through', async () => {
    const { service, store, bells } = harness({
      members: ['ada', 'bob'],
      people: [admin('ada'), admin('bob', { status: 'inactive' })],
    });
    await service.sweep(SENDING);
    expect(bells.map((bell) => bell.targetAdminUserId)).toEqual(['ada']);
    expect(store.settle).toHaveBeenCalledWith('a1', 'bell_email', 1, SENDING);
  });

  it('nobody eligible is an outcome of its own: no_recipient, nothing written', async () => {
    const { service, store, bells, mails } = harness({ members: ['ada'], visible: () => false });
    await service.sweep(SENDING);
    expect(bells).toEqual([]);
    expect(mails).toEqual([]);
    expect(store.settle).toHaveBeenCalledWith('a1', 'no_recipient', 0, SENDING);
  });

  it('with the bell switched off it is e-mail only: outcome email', async () => {
    const { service, store } = harness({ bell: async () => 'not-present' });
    await service.sweep(SENDING);
    expect(store.settle).toHaveBeenCalledWith('a1', 'email', 2, SENDING);
  });

  it('an alert neither channel delivered is undeliverable — and still settled, never retried', async () => {
    const { service, store } = harness({ bell: async () => 'not-present', mail: async () => ({ sent: false, reason: 'deactivated' }) });
    await service.sweep(SENDING);
    expect(store.settle).toHaveBeenCalledWith('a1', 'undeliverable', 2, SENDING);
    expect(store.release).not.toHaveBeenCalled();
  });

  it('gives a claim back when its delivery failed before anything was written, and goes on with the next', async () => {
    const { service, store, bells } = harness({ claims: [claim('a1'), claim('a2', { projectId: 'other' })] });
    store.memberIdsOf.mockImplementationOnce(async () => {
      throw new Error('connection reset');
    });
    const summary = await service.sweep(SENDING);
    expect(store.release).toHaveBeenCalledWith(['a1']);
    expect(store.settle).toHaveBeenCalledWith('a2', 'bell_email', 2, SENDING);
    expect(bells).toHaveLength(2);
    expect(summary).toMatchObject({ claimed: 2, released: 1 });
  });

  it('settles what it knows when a delivery failed after a bell entry was written', async () => {
    let calls = 0;
    const { service, store } = harness({
      bell: async () => {
        calls += 1;
        if (calls === 2) throw new Error('bell table locked');
        return 'recorded';
      },
    });
    await service.sweep(SENDING);
    expect(store.settle).toHaveBeenCalledWith('a1', 'bell_email', 2, SENDING);
    expect(store.release).not.toHaveBeenCalled();
  });

  it('a module switched off under a delivery is re-thrown, and the claims not reached are given back', async () => {
    const { service, store } = harness({ claims: [claim('a1'), claim('a2'), claim('a3')] });
    store.memberIdsOf.mockImplementationOnce(async () => {
      throw new ModuleDisabledError('admin_users');
    });
    await expect(service.sweep(SENDING)).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(store.release).toHaveBeenCalledWith(['a1']);
    expect(store.release).toHaveBeenCalledWith(['a2', 'a3']);
    expect(store.settle).not.toHaveBeenCalled();
  });
});
