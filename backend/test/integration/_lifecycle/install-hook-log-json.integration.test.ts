import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import {
  attachOperatorDiagnostics,
  runInstallCommand,
  type OperatorRuntime,
} from '@endora-commerce/platform/lifecycle';

/**
 * Issue #825 — `module:install --json` answers with one JSON document on
 * stdout, and a module's install hook that logs at info level must not put a
 * line in front of it.
 *
 * #819 sent the platform's own log lines to the command's error channel
 * (`attachOperatorDiagnostics`). The orchestrator's default install-hook
 * logger did not follow: it called `console.log`, so the hook's `log.info`
 * still landed on stdout and the document was no longer parseable.
 *
 * The command body runs exactly as the entry point runs it — the runtime is
 * `scripts/install.ts`' shape over the test database, with the diagnostics
 * channel attached the way the entry point attaches it — and the fixture
 * module's hook is the only thing that logs.
 */

const MODULE_ID = 'fixture_hook_logger';
const HOOK_LINE = 'fixture hook seeded its defaults';

const manifest = defineModuleManifest({
  id: MODULE_ID,
  name: 'Fixture hook logger',
  version: '1.0.0',
  dependencies: [],
});

describe('module:install --json with an install hook that logs [integration]', () => {
  let db: TestDb;
  let redis: Redis;
  let detach: (() => void) | undefined;

  beforeAll(async () => {
    db = await setupTestDb();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
  });

  afterEach(async () => {
    detach?.();
    detach = undefined;
    vi.restoreAllMocks();
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('keeps stdout to the JSON answer and sends the hook line to the error channel', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const consoleLog = vi.spyOn(console, 'log');
    const consoleInfo = vi.spyOn(console, 'info');
    detach = attachOperatorDiagnostics((line) => err.push(line));

    const rt: OperatorRuntime = {
      resources: async () => ({ orm: db.orm, em: () => db.em(), redis }),
      entries: [
        {
          manifest,
          filePath: '<test>',
          origin: 'overlay',
          installHook: async ({ log }) => {
            log.info(HOOK_LINE);
          },
        },
      ],
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    };

    expect(await runInstallCommand([MODULE_ID, '--json'], rt)).toBe(0);

    // stdout: what the command wrote, and nothing written around it.
    const stdout = out.join('');
    expect(stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout)).toMatchObject({ moduleId: MODULE_ID, state: 'installed' });
    const consoleLines = [...consoleLog.mock.calls, ...consoleInfo.mock.calls].map((c) =>
      c.map(String).join(' '),
    );
    expect(consoleLines.filter((line) => line.includes(HOOK_LINE))).toEqual([]);

    // stderr: the hook's line, in the channel's one-JSON-object-per-line shape.
    const hookLines = err
      .map((line) => JSON.parse(line) as { level: string; msg: string })
      .filter((line) => line.msg.includes(HOOK_LINE));
    expect(hookLines).toEqual([expect.objectContaining({ level: 'info', msg: HOOK_LINE })]);
  });
});
