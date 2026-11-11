import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentPlatformLogger } from '../../kernel/logging.js';
import {
  instanceSchemaExtensionsRuntime,
  runInstanceSchemaExtensionsCommand,
} from './schema-extensions-entry.js';
import { SCHEMA_EXTENSIONS_EXIT } from './schema-extensions.js';

/**
 * The half of an instance's `module:schema-extensions` entry point that
 * answers with no database (issue #1036). What it does against one — the
 * audited drop, the refusal of a live declaration, `audit-packages` over an
 * installed package — is `backend/test/integration/_lifecycle/
 * schema-extensions-instance.test.ts`.
 *
 * The ORM configuration handed in **throws**, as in `operator-entry.test.ts`:
 * a working one would pass whether or not the laziness held.
 */
const refusingConfig = (): Promise<never> => {
  throw new Error('the ORM configuration was read, and this run should not have opened one');
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('instanceSchemaExtensionsRuntime', () => {
  it('composes nothing and opens nothing while it is built', async () => {
    const { runtime, dispose } = instanceSchemaExtensionsRuntime({ ormConfig: refusingConfig, env: {} });
    // No container, no Redis, no manifest set: the five fields the command reads.
    expect(Object.keys(runtime).sort()).toEqual([
      'commandBus',
      'declarations',
      'err',
      'orm',
      'out',
      'packages',
    ]);
    // Reaching for the ORM is what opens it.
    await expect(runtime.orm()).rejects.toThrow('should not have opened one');
    await expect(dispose()).resolves.toBeUndefined();
    expect(currentPlatformLogger()).toBeUndefined();
  });

  it('refuses to answer "nothing is declared" when no ORM configuration recorded the declarations', () => {
    const { runtime } = instanceSchemaExtensionsRuntime({ ormConfig: refusingConfig, env: {} });
    // Read as an empty set, `drop` would remove a live extension's columns.
    expect(() => runtime.declarations()).toThrow(/recorded no schema-extension declarations/);
  });
});

describe('runInstanceSchemaExtensionsCommand', () => {
  it('answers a misuse out of argv with the usage and exit 64, and opens no database', async () => {
    const err: string[] = [];
    let exitCode: number | undefined;
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitCode = Number(code);
      return undefined as never;
    });
    await runInstanceSchemaExtensionsCommand({
      ormConfig: refusingConfig,
      env: {},
      argv: ['vacuum'],
      out: () => undefined,
      err: (line) => void err.push(line),
    });
    expect(exitCode).toBe(SCHEMA_EXTENSIONS_EXIT.usage);
    const text = err.join('');
    for (const verb of ['list', 'drop <moduleId>', 'audit-packages']) {
      expect(text).toContain(`module:schema-extensions ${verb}`);
    }
    expect(text).not.toContain('should not have opened one');
  });
});
