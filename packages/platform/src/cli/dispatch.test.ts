import type { ModuleManifest } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { cliFailureExitCode, dispatchCli, type CliComposition } from './dispatch.js';

/**
 * The operator CLI's decidable half (`specs/123-oss-install-experience/` G2,
 * T2-B).
 *
 * Everything here is answered **before** anything is composed and before a
 * database is opened, which is the property D-102 attached as a condition to
 * `audit_logs read` and the reason the dispatch could move into this package at
 * all: the manifest set, the composition and a tree's own demo composition are
 * parameters, so a test supplies them and no process is spawned.
 *
 * What the composing half does is `test/integration/`'s and the acceptance
 * criterion's — A15 runs it on a real scaffolded instance, which is the only
 * place the claim *"a client can create an administrator"* can be made.
 */
function entry(
  id: string,
  commands?: readonly { name: string; summary: string; help?: string }[],
): { manifest: ModuleManifest } {
  return {
    manifest: { id, name: id, version: '1.0.0', dependencies: [] } as unknown as ModuleManifest,
    // `cliCommands` sits on the resolved **entry**, beside the manifest rather
    // than inside it: the manifest is the declaration a package ships and the
    // entry is what the loader made of it.
    ...(commands === undefined
      ? {}
      : { cliCommands: commands.map((command) => ({ ...command, run: async () => 0 })) }),
  };
}

interface Captured {
  readonly out: string[];
  readonly err: string[];
}

function run(
  argv: readonly string[],
  entries: readonly { manifest: ModuleManifest }[],
  captured: Captured,
  compose?: () => Promise<CliComposition>,
): Promise<number> {
  return dispatchCli({
    deploymentRoot: '/nowhere',
    argv,
    resolveEntries: async () => entries as never,
    out: (chunk) => captured.out.push(chunk),
    err: (chunk) => captured.err.push(chunk),
    ...(compose === undefined ? {} : { compose }),
  });
}

function captured(): Captured {
  return { out: [], err: [] };
}

describe('the dispatch composes nothing to answer a declaration-level question', () => {
  /**
   * The premise of the whole move. A supplier that throws is the strongest
   * available statement of *"this path does not compose"*: if any of the three
   * cases below reached it, the test would fail with that error rather than
   * with an assertion.
   */
  const refuses = (): Promise<CliComposition> => {
    throw new Error('composed, and this path must not');
  };

  it('--list names the host verbs and every declared command', async () => {
    const seen = captured();
    const code = await run(
      ['--list'],
      [entry('settings', [{ name: 'cache-clear', summary: 'Drop the settings cache.' }])],
      seen,
      refuses,
    );
    expect(code).toBe(0);
    const text = seen.out.join('');
    expect(text).toContain('demo seed');
    expect(text).toContain('demo reset');
    expect(text).toContain('settings cache-clear');
  });

  it('--help on a module command answers from the declaration', async () => {
    const seen = captured();
    const code = await run(
      ['admin_users', 'create', '--help'],
      [entry('admin_users', [{ name: 'create', summary: 'Create an admin.', help: 'usage: …' }])],
      seen,
      refuses,
    );
    expect(code).toBe(0);
    expect(seen.out.join('')).toContain('usage: …');
  });

  it('an address with no command is a refusal that names the grammar', async () => {
    const seen = captured();
    const code = await run(['admin_users'], [entry('admin_users')], seen, refuses);
    expect(code).toBe(1);
    expect(seen.err.join('')).toContain("'<module id> <command>'");
  });

  it('no argument at all prints the usage and exits non-zero', async () => {
    const seen = captured();
    expect(await run([], [], seen, refuses)).toBe(1);
    expect(seen.out.join('')).toContain('usage: endora');
    // `--help` is the same text and a success.
    const asked = captured();
    expect(await run(['--help'], [], asked, refuses)).toBe(0);
    expect(asked.out.join('')).toContain('usage: endora');
  });

  it('`demo` with no verb refuses, and `demo <verb> --help` answers', async () => {
    const bare = captured();
    expect(await run(['demo'], [], bare, refuses)).toBe(1);
    expect(bare.out.join('')).toContain('demo seed');

    const helped = captured();
    expect(await run(['demo', 'reset', '--help'], [], helped, refuses)).toBe(0);
    expect(helped.out.join('')).toContain('endora demo reset');
  });

  it('an unknown demo verb refuses rather than guessing a direction', async () => {
    await expect(run(['demo', 'wipe'], [], captured(), refuses)).rejects.toThrow(
      /is not a demo command/,
    );
  });
});

describe('the failure path an entry point turns into an exit code', () => {
  it('reports an ordinary throw as 1, with its stack', () => {
    const lines: string[] = [];
    expect(cliFailureExitCode(new Error('boom'), (chunk) => lines.push(chunk))).toBe(1);
    expect(lines.join('')).toContain('boom');
  });

  it('a non-Error is still reported rather than swallowed', () => {
    const lines: string[] = [];
    expect(cliFailureExitCode('just a string', (chunk) => lines.push(chunk))).toBe(1);
    expect(lines.join('')).toContain('just a string');
  });
});
