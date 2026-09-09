import { describe, expect, it } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { createRootContainer } from '../../../src/kernel/container.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import { composeModules, type ModuleEntry } from '../../../src/kernel/compose.js';
import {
  DuplicateModuleIdError,
  assertUniqueModuleIds,
  duplicateModuleIds,
} from '../../../src/kernel/lifecycle/unique-module-ids.js';

/**
 * T030c / D-155.7, second placement — module id uniqueness is **structural at
 * the composition seam**, for any entry source: core, overlay, package, or
 * whatever composes next.
 *
 * The first placement is at discovery, where both vendors' `package.json`
 * paths still exist. This one exists because a loader-level refusal is a
 * property of one loader, and `migration-identity.md` §2's sufficiency argument
 * — *"module ids are unique platform-wide, the lifecycle refuses a second
 * module claiming an id"* — is a claim about the platform.
 *
 * What it replaces, measured: `composeModules` composed both entries and what
 * surfaced was a `DuplicateRegistrationError` on the first colliding
 * registration name, whose message named the module id twice and neither
 * vendor. Two claimants registering disjoint names collided on nothing and both
 * composed.
 */

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function entry(id: string, registerModule: (ctx: ModuleContext) => void = () => {}): ModuleEntry {
  return { id, version: '1.0.0', registerModule };
}

function compose(entries: readonly ModuleEntry[]): ReturnType<typeof composeModules> {
  return composeModules(entries, {
    container: createRootContainer(),
    eventBus: new EventBus(),
    log: log(),
  });
}

describe('the analysis', () => {
  it('reports every id claimed more than once, with how many claimed it', () => {
    expect(duplicateModuleIds(['blog', 'catalog', 'blog', 'crm', 'blog'])).toEqual([
      { id: 'blog', count: 3 },
    ]);
  });

  it('reports several colliding ids in first-seen order', () => {
    expect(duplicateModuleIds(['blog', 'crm', 'blog', 'crm'])).toEqual([
      { id: 'blog', count: 2 },
      { id: 'crm', count: 2 },
    ]);
  });

  it('is silent on a list with no repeat', () => {
    expect(duplicateModuleIds(['blog', 'catalog', 'crm'])).toEqual([]);
    expect(() => assertUniqueModuleIds(['blog', 'catalog', 'crm'])).not.toThrow();
  });
});

describe('composeModules refuses two entries claiming one id', () => {
  it('refuses two entries that register nothing at all', () => {
    // The case the `DuplicateRegistrationError` could never reach: disjoint
    // registrations (here, none) collide on no name, so before this refusal
    // both modules composed and the platform ran two strangers as one.
    let thrown: unknown;
    try {
      compose([entry('blog'), entry('blog')]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DuplicateModuleIdError);
    expect((thrown as Error).message).toContain('blog');
  });

  it('refuses before the first module registers', () => {
    // Same slot as `assertRequiredModulesPresent`, and for the same reason: a
    // composition that is going to be refused must not half-run first.
    const registered: string[] = [];
    expect(() =>
      compose([
        entry('blog', () => {
          registered.push('first');
        }),
        entry('blog', () => {
          registered.push('second');
        }),
      ]),
    ).toThrow(DuplicateModuleIdError);
    expect(registered).toEqual([]);
  });

  it('composes a list whose ids are all distinct', () => {
    const registered: string[] = [];
    compose([
      entry('blog', () => {
        registered.push('blog');
      }),
      entry('crm', () => {
        registered.push('crm');
      }),
    ]);
    expect(registered).toEqual(['blog', 'crm']);
  });
});
