import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createLockClaimsFixture } from '../../helpers/lock-claims-check-fixture.js';
import { checkRunner } from '../../helpers/moved-module-tree-fixture.js';
import { createNulBytesFixture } from '../../helpers/nul-bytes-check-fixture.js';
import { createShellCheckFixture } from '../../helpers/shell-check-fixture.js';

/**
 * Issue #80 — a check fixture whose child was killed says so, and names the
 * signal, in the words `test/helpers/check-process.ts` gives every other spawn.
 *
 * Each case replaces the fixture's copy of the check with a program that kills
 * itself, so what is under proof is the fixture's own spawn and nothing about
 * the check. Before the repair each `run` returned `{ status: null }` or
 * `{ status: 137 }` with empty output, and the test reading it failed on an
 * assertion about content — the report never said the child had been killed.
 *
 * The TypeScript checks are spawned through `tsx`, whose launcher survives the
 * kill and relays it as `128 + signum`; the bash checks are the direct child and
 * the kernel reports the signal itself. Both readings name the signal.
 */

const SELF_KILLING_TS = "process.kill(process.pid, 'SIGKILL');\n";
const SELF_KILLING_SH = 'kill -KILL $$\n';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('a check fixture whose child was killed', () => {
  it('nul-bytes reports the kill', () => {
    const fixture = createNulBytesFixture();
    cleanups.push(fixture.cleanup);
    fixture.write(
      'node_modules/scripts/check-nul-bytes.ts',
      new TextEncoder().encode(SELF_KILLING_TS),
    );

    expect(() => fixture.run()).toThrow(/killed by SIGKILL/);
  });

  it('lock-claims reports the kill', () => {
    const fixture = createLockClaimsFixture();
    cleanups.push(fixture.cleanup);
    writeFileSync(join(fixture.root, 'backend', 'scripts', 'check-lock-claims.ts'), SELF_KILLING_TS);

    expect(() => fixture.run()).toThrow(/killed by SIGKILL/);
  });

  it('the shell-check fixture reports the kill', () => {
    const fixture = createShellCheckFixture();
    cleanups.push(fixture.cleanup);
    fixture.write('scripts/check-naming.sh', SELF_KILLING_SH);

    expect(() => fixture.run('check-naming.sh')).toThrow(/check-naming\.sh was killed by SIGKILL/);
  });

  describe('the moved-module tree fixture', () => {
    const backendWithSelfKillingCheck = (): string => {
      const backend = mkdtempSync(join(tmpdir(), 'check-fixture-termination-'));
      cleanups.push(() => rmSync(backend, { recursive: true, force: true }));
      mkdirSync(join(backend, 'scripts'), { recursive: true });
      writeFileSync(join(backend, 'scripts', 'check-dies.ts'), SELF_KILLING_TS);
      return backend;
    };

    it('reports the kill from a synchronous run', () => {
      const runner = checkRunner(backendWithSelfKillingCheck());

      expect(() => runner.run('check-dies.ts')).toThrow(/killed by SIGKILL/);
    });

    it('reports the kill from a prefetch', async () => {
      const runner = checkRunner(backendWithSelfKillingCheck());

      await expect(runner.prefetch([{ script: 'check-dies.ts' }], 1)).rejects.toThrow(
        /killed by SIGKILL/,
      );
    });
  });
});
