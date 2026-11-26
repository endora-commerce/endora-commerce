import { describe, expect, it } from 'vitest';
import type { CommandMiddlewareCompositionInput } from '../commands/middleware/registry.js';
import { CommandMiddlewareRegistry } from '../commands/middleware/registry.js';
import { EventBus } from '../events/index.js';
import { composeModules, type ModuleEntry } from './compose.js';
import { createRootContainer } from './container.js';

/**
 * `specs/189-command-middleware/` T040 (FR-004, `contracts/module-origin.md`
 * §2): the composer hands every origin-reading registry one origin map, from
 * each entry's loader-stamped `origin`, or — when a loader stamped none — from
 * the `overlay` and `installedPackage` flags.
 */

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

function originsFor(entries: readonly ModuleEntry[]): CommandMiddlewareCompositionInput['origins'] {
  const registry = new CommandMiddlewareRegistry({ log: quiet });
  let seen: CommandMiddlewareCompositionInput['origins'] | undefined;
  const seal = registry.seal.bind(registry);
  registry.seal = (input) => {
    seen = input.origins;
    seal(input);
  };
  composeModules(entries, {
    container: createRootContainer(),
    eventBus: new EventBus(),
    log: quiet,
    commandMiddlewareRegistry: registry,
  });
  return seen!;
}

const entry = (id: string, extra: Partial<ModuleEntry> = {}): ModuleEntry => ({
  id,
  version: '1.0.0',
  registerModule: () => undefined,
  ...extra,
});

describe('composeModules — the origin map (189 T040)', () => {
  it('falls back to the flags when no loader stamped an origin', () => {
    expect(
      originsFor([entry('organizations'), entry('acme_overlay', { overlay: true }), entry('acme_pkg', { installedPackage: true })]),
    ).toEqual({ organizations: 'core', acme_overlay: 'deployment', acme_pkg: 'package' });
  });

  it('takes a stamped origin over the flags: an installed first-party package is core', () => {
    expect(
      originsFor([
        entry('organizations', { installedPackage: true, origin: 'core', installedPackageName: '@endora-commerce/mod-organizations' }),
        entry('acme_pkg', { installedPackage: true, origin: 'package', installedPackageName: 'acme-pkg' }),
      ]),
    ).toEqual({ organizations: 'core', acme_pkg: 'package' });
  });
});
