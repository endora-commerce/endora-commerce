/**
 * The acceptance runners' teardown, held to what it promises.
 *
 * `instance-local-registry.ts`, `separate-components.ts` and
 * `instance-public.ts` each start long-lived layers in a process group of their
 * own and stop them in a `finally`. The runs themselves need Docker and an hour,
 * so they are CI jobs; what runs here is the part that decides whether such a
 * run **ends**: a group that ignores the polite signal, a group whose leader
 * went and whose member did not, and a process the event loop would not let go.
 *
 * Every child below is a real process. A mocked `ChildProcess` would prove that
 * the helper calls `kill`, which is not the claim — the claim is that nothing
 * is left running.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, it, expect, afterEach } from 'vitest';

import {
  armExitWatchdog,
  killTrackedGroups,
  stopProcessGroup,
  trackProcessGroup,
} from '../../../scripts/acceptance/process-teardown.js';

/** Ignores both polite signals, says `ready` once it does, and stays. */
const STUBBORN = `
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
  console.log('ready ' + process.pid);
`;

/**
 * A leader that leaves on SIGINT, having started a member of its own group that
 * ignores it — the shape of `pnpm run start` over a server that will not stop.
 */
const LEADER_WITH_STUBBORN_MEMBER = `
  const { spawn } = require('node:child_process');
  const member = spawn(process.execPath, ['-e', ${JSON.stringify(STUBBORN)}], { stdio: ['ignore', 'pipe', 'ignore'] });
  member.stdout.once('data', (chunk) => console.log(String(chunk).trim()));
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
`;

const started: ChildProcess[] = [];

/** Start `script` as the leader of a new process group and wait for `ready <pid>`. */
async function startGroup(script: string): Promise<{ child: ChildProcess; readyPid: number }> {
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  started.push(child);
  const [chunk] = (await once(child.stdout!, 'data')) as [Buffer];
  const readyPid = Number(/ready (\d+)/.exec(chunk.toString('utf8'))?.[1]);
  expect(Number.isInteger(readyPid)).toBe(true);
  return { child, readyPid };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 20));
  return !alive(pid);
}

afterEach(() => {
  for (const child of started.splice(0)) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone — which is what every test here asserts
    }
  }
});

describe('stopProcessGroup', () => {
  it('kills a group that ignores the polite signal, once the grace period is over', async () => {
    const { child } = await startGroup(STUBBORN);
    const began = Date.now();

    const outcome = await stopProcessGroup(child, { graceMs: 300, killWaitMs: 5_000 });

    expect(outcome).toBe('killed');
    expect(Date.now() - began).toBeGreaterThanOrEqual(300);
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(child.signalCode).toBe('SIGKILL');
    expect(alive(child.pid!)).toBe(false);
  });

  it('answers `exited` without waiting the grace period out when the group leaves on the signal', async () => {
    const { child } = await startGroup(`setInterval(() => {}, 1000); console.log('ready ' + process.pid);`);
    const began = Date.now();

    const outcome = await stopProcessGroup(child, { graceMs: 10_000, killWaitMs: 5_000 });

    expect(outcome).toBe('exited');
    expect(Date.now() - began).toBeLessThan(5_000);
    expect(alive(child.pid!)).toBe(false);
  });

  it('does not take the leader leaving for the group leaving', async () => {
    const { child, readyPid: member } = await startGroup(LEADER_WITH_STUBBORN_MEMBER);
    expect(member).not.toBe(child.pid);

    const outcome = await stopProcessGroup(child, { graceMs: 300, killWaitMs: 5_000 });

    expect(outcome).toBe('killed');
    expect(await goneWithin(member, 2_000)).toBe(true);
  });

  it('kills what a leader that had already exited left in its group', async () => {
    const { child, readyPid: member } = await startGroup(LEADER_WITH_STUBBORN_MEMBER);
    process.kill(child.pid!, 'SIGINT');
    await once(child, 'exit');
    expect(child.exitCode).toBe(0);
    expect(alive(member)).toBe(true);

    const outcome = await stopProcessGroup(child, { graceMs: 300, killWaitMs: 5_000 });

    expect(outcome).toBe('killed');
    expect(await goneWithin(member, 2_000)).toBe(true);
  });

  it('answers `not-running` for a group with nothing left in it', async () => {
    const { child } = await startGroup(`console.log('ready ' + process.pid);`);
    if (child.exitCode === null) await once(child, 'exit');

    expect(await stopProcessGroup(child, { graceMs: 300, killWaitMs: 1_000 })).toBe('not-running');
  });

  it('leaves no timer behind to keep the event loop alive', async () => {
    const { child } = await startGroup(`setInterval(() => {}, 1000); console.log('ready ' + process.pid);`);
    const timersBefore = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

    await stopProcessGroup(child, { graceMs: 60_000, killWaitMs: 5_000 });

    expect(process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length).toBeLessThanOrEqual(timersBefore);
  });
});

describe('killTrackedGroups', () => {
  it('kills every tracked group at once, with no grace — what an exit path that skips `finally` runs', async () => {
    const { child, readyPid: member } = await startGroup(LEADER_WITH_STUBBORN_MEMBER);
    trackProcessGroup(child);

    killTrackedGroups();

    expect(await goneWithin(child.pid!, 2_000)).toBe(true);
    expect(await goneWithin(member, 2_000)).toBe(true);
  });

  it('forgets a group that was stopped, so a recycled pid is never signalled', async () => {
    const { child } = await startGroup(STUBBORN);
    trackProcessGroup(child);
    await stopProcessGroup(child, { graceMs: 100, killWaitMs: 5_000 });
    const signalled: number[] = [];

    killTrackedGroups((pid) => signalled.push(pid));

    expect(signalled).toEqual([]);
  });
});

describe('armExitWatchdog', () => {
  // The watchdog sets `process.exitCode`, and this process is the test worker.
  const exitCodeBefore = process.exitCode;
  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  it('exits with the verdict code, naming what held the loop, when the loop does not drain', async () => {
    const held = setInterval(() => undefined, 1_000);
    const reports: string[] = [];
    try {
      const code = await new Promise<number>((exited) => {
        armExitWatchdog(1, { graceMs: 50, exit: exited, report: (line) => reports.push(line) });
      });

      expect(code).toBe(1);
      expect(reports.join('\n')).toMatch(/still running 50 ms after/);
      expect(reports.join('\n')).toContain('Timeout');
    } finally {
      clearInterval(held);
    }
  });

  it('does not itself keep the loop alive', () => {
    const timer = armExitWatchdog(0, { graceMs: 60_000, exit: () => undefined, report: () => undefined });
    try {
      expect(timer.hasRef()).toBe(false);
    } finally {
      clearTimeout(timer);
    }
  });
});
