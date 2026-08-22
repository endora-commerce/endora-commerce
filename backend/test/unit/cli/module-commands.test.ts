import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleCliCommand } from '@b2b/contracts';
import {
  InvalidCommandDeclarationError,
  UnknownCommandError,
  collectModuleCommands,
  findModuleCommand,
  formatCommandList,
  helpFor,
  runModuleCommand,
  type CommandDeclaringEntry,
} from '../../../src/cli/module-commands.js';
import { EventBus } from '../../../src/events/bus.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { packageModuleManifestsUnder } from '../../../src/packages/package-runtime.js';

/**
 * The host's side of a module-declared CLI command (feature 080, T042b /
 * D-160.9, D-157.8).
 *
 * Four properties are pinned here, and the third is the one the ruling turns on:
 *
 *  1. **A declaration is enumerable and addressable.** That is why D-157.8
 *     rejected path-convention dispatch — nothing can list a convention for
 *     `--help`, and a name it cannot resolve fails as *"command silently not
 *     found"*.
 *  2. **A command is invoked with a `ModuleContext`**, so its body resolves
 *     with `lazyPort` literals and `check:port-dependencies` keeps its line of
 *     sight (D-157.7).
 *  3. **A switched-off module's command does not run, and presence is decided
 *     *before* a context exists.** `contextFor` records whether it was called:
 *     a gate that fires after the module's services are resolved has already
 *     let the composition do work on behalf of an absent module.
 *  4. **A package's declared command is reachable by the same path** — the
 *     whole point of *"one shape covers core, overlay and package"*. The
 *     fixture is a real `node_modules` tree with a compiled root export, so the
 *     enumeration, the `exports` resolution and the dynamic import all run
 *     (issue #130: a fixture that enters below the defect cannot catch it).
 */

const noop = (): void => {};

function command(
  name: string,
  run: ModuleCliCommand<ModuleContext>['run'] = async () => 0,
  extra: Partial<ModuleCliCommand<ModuleContext>> = {},
): ModuleCliCommand<ModuleContext> {
  return { name, summary: `does ${name}`, run, ...extra };
}

function entry(id: string, ...commands: ModuleCliCommand<ModuleContext>[]): CommandDeclaringEntry {
  return { manifest: { id }, cliCommands: commands as unknown as readonly ModuleCliCommand<never>[] };
}

const nowhereContext = (): ModuleContext => {
  throw new Error('contextFor must not be called');
};

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('collectModuleCommands — the declaration is enumerable', () => {
  it('lists every origin in one array, module then command', () => {
    const found = collectModuleCommands([
      entry('search', command('reindex')),
      entry('acceptance_probe', command('probe')),
      entry('_i18n', command('reload'), command('coverage')),
      { manifest: { id: 'orders' } },
    ]);

    expect(found.map((c) => `${c.moduleId} ${c.name}`)).toEqual([
      '_i18n coverage',
      '_i18n reload',
      'acceptance_probe probe',
      'search reindex',
    ]);
  });

  it('refuses a name the addressing grammar cannot express', () => {
    // `<module id> <command name>` is the address, so a name with a space in it
    // is unreachable. Refused rather than skipped: a command `--list` prints and
    // the runner cannot find is the failure D-157.8 rejected conventions for.
    expect(() => collectModuleCommands([entry('search', command('re index'))])).toThrow(
      InvalidCommandDeclarationError,
    );
    expect(() => collectModuleCommands([entry('search', command('Reindex'))])).toThrow(
      InvalidCommandDeclarationError,
    );
  });

  it('refuses two commands of one module claiming one name', () => {
    expect(() =>
      collectModuleCommands([entry('search', command('reindex'), command('reindex'))]),
    ).toThrow(/two commands named 'reindex'/);
  });

  it('names the module and its commands when the address does not resolve', () => {
    const found = collectModuleCommands([entry('search', command('reindex'))]);
    expect(() => findModuleCommand(found, 'orders', 'reindex')).toThrow(UnknownCommandError);
    expect(() => findModuleCommand(found, 'search', 'rebuild')).toThrow(/It declares: reindex/);
  });

  it('prints a list an operator can read, and says so when there is none', () => {
    expect(formatCommandList(collectModuleCommands([entry('search', command('reindex'))]))).toBe(
      '  search reindex  does reindex\n',
    );
    expect(formatCommandList([])).toMatch(/No module declares a CLI command/);
  });

  it('reaches every core module declaration through the generated index', () => {
    // The forwarding chain, end to end and over the real tree: a module's
    // `cliCommands` export → the generated manifest index → `entryFor` in
    // `registered-manifests.ts` → `REGISTERED_MANIFESTS`. Every link is a field
    // that has to be copied, and a dropped copy is silent — `--list` simply
    // shows fewer commands, which is the failure mode of a declaration nothing
    // checks. Asserted as an exact set, so both directions fail.
    expect(
      collectModuleCommands(REGISTERED_MANIFESTS).map((c) => `${c.moduleId} ${c.name}`),
    ).toEqual([
      '_i18n coverage',
      '_i18n reload',
      'admin_users create',
      'audit_logs read',
      'carts abandonment-sweep',
      'search reindex',
      'settings cache-clear',
    ]);
  });

  it('answers --help from the declaration, falling back to the summary', () => {
    const [withHelp] = collectModuleCommands([
      entry('audit_logs', command('read', async () => 0, { help: 'usage: audit_logs read …' })),
    ]);
    const [without] = collectModuleCommands([entry('search', command('reindex'))]);
    expect(helpFor(withHelp as never)).toBe('usage: audit_logs read …');
    expect(helpFor(without as never)).toBe('search reindex — does reindex');
  });
});

describe('runModuleCommand — the module gets a context, the host gets an exit code', () => {
  it('hands the body its module context, the remaining argv and both streams', async () => {
    registryCache.__setEnabledForTesting(['search']);
    const seen: Array<{ ctx: unknown; argv: readonly string[] }> = [];
    const ctx = { marker: 'search-context' } as unknown as ModuleContext;
    const out: string[] = [];
    const err: string[] = [];

    const code = await runModuleCommand({
      entries: [
        entry(
          'search',
          command('reindex', async (context) => {
            seen.push({ ctx: context.ctx, argv: context.argv });
            context.out('indexed');
            context.err('one channel skipped');
            return 7;
          }),
        ),
      ],
      moduleId: 'search',
      name: 'reindex',
      argv: ['--channel', 'b2b'],
      contextFor: () => ctx,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });

    expect(code).toBe(7);
    expect(seen).toEqual([{ ctx, argv: ['--channel', 'b2b'] }]);
    expect(out).toEqual(['indexed']);
    expect(err).toEqual(['one channel skipped']);
  });
});

describe('runModuleCommand — a switched-off module (Constitution XVII)', () => {
  const declaration = entry(
    'search',
    command('reindex', async () => {
      throw new Error('the body of a switched-off module must not run');
    }),
  );

  const invoke = (contextFor: (moduleId: string) => ModuleContext): Promise<number> =>
    runModuleCommand({
      entries: [declaration],
      moduleId: 'search',
      name: 'reindex',
      argv: [],
      contextFor,
      out: noop,
      err: noop,
    });

  it('refuses with MODULE_DISABLED when the platform axis is off', async () => {
    registryCache.__setEnabledForTesting([]);
    await expect(invoke(nowhereContext)).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      moduleId: 'search',
    });
  });

  it('refuses when the operator has deactivated it, with the platform axis on', async () => {
    // The other axis, specifically: platform-available and operator-deactivated
    // is the case Principle XVII item 6 asks for by name, and it is the one a
    // registry-only check would pass.
    registryCache.__setEnabledForTesting(['search'], { deactivated: ['search'] });
    await expect(invoke(nowhereContext)).rejects.toMatchObject({
      code: 'MODULE_DISABLED',
      moduleId: 'search',
    });
  });

  it('decides before a context exists, so nothing is resolved on an absent module', async () => {
    registryCache.__setEnabledForTesting([]);
    const built: string[] = [];
    await expect(
      invoke((moduleId) => {
        built.push(moduleId);
        return {} as ModuleContext;
      }),
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(built).toEqual([]);
  });

  it('runs again the moment the module is switched back on', async () => {
    registryCache.__setEnabledForTesting(['search']);
    const ran: string[] = [];
    const code = await runModuleCommand({
      entries: [
        entry(
          'search',
          command('reindex', async () => {
            ran.push('reindex');
            return 0;
          }),
        ),
      ],
      moduleId: 'search',
      name: 'reindex',
      argv: [],
      contextFor: () => ({}) as ModuleContext,
      out: noop,
      err: noop,
    });
    expect(code).toBe(0);
    expect(ran).toEqual(['reindex']);
  });
});

describe('ComposedModules.contextFor — the composition builds the context (D-157.7)', () => {
  it('resolves the module own registrations, and refuses an id it did not compose', () => {
    const container = createRootContainer();
    const composed = composeModules(
      [
        {
          id: 'example',
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.di.register({
              exampleGreeter: ctx.asFunction(() => ({ greet: () => 'hello' })).singleton(),
            });
          },
        },
      ],
      {
        container,
        eventBus: new EventBus(),
        log: { info: noop, warn: noop, error: noop },
      },
    );

    const ctx = composed.contextFor('example');
    // The phase guard is off: every module has registered, so resolving is
    // exactly what this context is for.
    expect(ctx.cradle<{ exampleGreeter: { greet: () => string } }>().exampleGreeter.greet()).toBe(
      'hello',
    );
    expect(() => composed.contextFor('orders')).toThrow(/no module 'orders' in this composition/);
  });
});

/**
 * A package's declared command, over a real installed-package fixture.
 *
 * This is the origin the shape was designed for: a file under `node_modules`
 * can name no specifier that resolves to the instance's
 * `backend/src/composition.ts`, so its CLI can only ever be a declaration the
 * host invokes. Nothing below hands the runner a pre-built entry — the scan,
 * the `exports` resolution and the dynamic import of the compiled root export
 * all run.
 */
describe('a package declares a command and the host runs it (D-157.8)', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'endora-cli-commands-'));
    const dir = join(root, 'instance', 'node_modules', '@vendor', 'mod-probe');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: '@vendor/mod-probe',
          version: '1.0.0',
          type: 'module',
          endora: { type: 'module', id: 'vendor_probe', platform: '0.x' },
          exports: { '.': './dist/manifest.js', './package.json': './package.json' },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(dir, 'dist', 'manifest.js'),
      `export const manifest = ${JSON.stringify({
        id: 'vendor_probe',
        name: '@vendor/mod-probe',
        version: '1.0.0',
        dependencies: [],
      })};\n` +
        `export const cliCommands = [{\n` +
        `  name: 'probe',\n` +
        `  summary: 'A command a package declares.',\n` +
        `  help: 'usage: vendor_probe probe',\n` +
        `  run: async (context) => { context.out('probed:' + context.ctx.marker + ':' + context.argv.join(',')); return 0; },\n` +
        `}];\n` +
        `export default manifest;\n`,
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is enumerated, helped and run exactly as a core module command is', async () => {
    const manifests = await packageModuleManifestsUnder([join(root, 'instance', 'node_modules')]);
    expect(manifests.map((m) => m.id)).toEqual(['vendor_probe']);

    const declared = collectModuleCommands(manifests);
    expect(formatCommandList(declared)).toBe(
      '  vendor_probe probe  A command a package declares.\n',
    );
    expect(helpFor(declared[0] as never)).toBe('usage: vendor_probe probe');

    registryCache.__setEnabledForTesting(['vendor_probe']);
    const out: string[] = [];
    const code = await runModuleCommand({
      entries: manifests,
      moduleId: 'vendor_probe',
      name: 'probe',
      argv: ['--dry-run'],
      contextFor: () => ({ marker: 'vendor-context' }) as unknown as ModuleContext,
      out: (line) => out.push(line),
      err: noop,
    });

    expect(code).toBe(0);
    expect(out).toEqual(['probed:vendor-context:--dry-run']);
  });

  it('does not run while the package module is switched off', async () => {
    const manifests = await packageModuleManifestsUnder([join(root, 'instance', 'node_modules')]);
    registryCache.__setEnabledForTesting([]);
    await expect(
      runModuleCommand({
        entries: manifests,
        moduleId: 'vendor_probe',
        name: 'probe',
        argv: [],
        contextFor: nowhereContext,
        out: noop,
        err: noop,
      }),
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED', moduleId: 'vendor_probe' });
  });
});
