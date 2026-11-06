import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentPlatformLogger, platformLogger } from '../../kernel/logging.js';
import { attachOperatorDiagnostics } from './operator-diagnostics.js';

/**
 * Issue #819 — a `module:*` command's stdout is its answer, and with `--json`
 * that answer is parsed by a machine. The platform's own diagnostics (the
 * tenancy-chain notice the ORM bootstrap emits, a convergence warning) go to
 * `platformLogger()`, whose fallback is `console.info` — stdout — because a
 * server's boot line belongs there. A command builds no server, so nothing ever
 * attached a destination and the notice landed in front of the JSON.
 */
describe('attachOperatorDiagnostics', () => {
  let detach: (() => void) | undefined;
  afterEach(() => {
    detach?.();
    detach = undefined;
    vi.restoreAllMocks();
  });

  it('routes every platform log line to the error channel, one JSON line each, and none to stdout', () => {
    const err: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    detach = attachOperatorDiagnostics((line) => err.push(line));

    platformLogger().info({ chain: 'A -> B' }, 'a notice');
    platformLogger().warn({ moduleId: 'x' }, 'a warning');
    platformLogger().error({}, 'an error');

    expect(stdout).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(err).toHaveLength(3);
    for (const line of err) expect(line.endsWith('\n')).toBe(true);
    expect(err.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: 'info', msg: 'a notice', chain: 'A -> B' },
      { level: 'warn', msg: 'a warning', moduleId: 'x' },
      { level: 'error', msg: 'an error' },
    ]);
  });

  it('the level and the message are the line\'s own, not something a caller\'s fields can shadow', () => {
    const err: string[] = [];
    detach = attachOperatorDiagnostics((line) => err.push(line));
    platformLogger().info({ level: 'error', msg: 'spoofed' }, 'real');
    expect(JSON.parse(err[0]!)).toEqual({ level: 'info', msg: 'real' });
  });

  it('detach leaves the slot as it found it', () => {
    expect(currentPlatformLogger()).toBeUndefined();
    detach = attachOperatorDiagnostics(() => undefined);
    expect(currentPlatformLogger()).toBeDefined();
    detach();
    detach = undefined;
    expect(currentPlatformLogger()).toBeUndefined();
  });
});
