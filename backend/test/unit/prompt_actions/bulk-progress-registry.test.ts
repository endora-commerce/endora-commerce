import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BulkProgressSnapshot } from '@endora-commerce/contracts';
import { CONTRIBUTION_POLICY_STATED } from '../../../scripts/check-port-dependencies.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { PromptActionBulkProgressRegistry } from '../../../../packages/modules/prompt_actions/src/backend/services/bulk-progress-registry.js';

/**
 * `PromptActionBulkProgressRegistry` — D-72 point 4, and D-76.
 *
 * The seam that let the last member of the D-44 family leave both composition
 * roots. It replaces a single container name `prompt_actions` defaulted to
 * `undefined` and a root overwrote with `catalog`'s resolver, which is the one
 * shape a module cannot push into: a module may not write a name another module
 * owns, so the contribution had nowhere to go but a root.
 *
 * Two properties, and only the second was new work at the time. The first is
 * the D-39 contribution-seam contract every registry in this tree is held to:
 * the entry records its contributor and the class states, and implements, what
 * it does with an absent one.
 *
 * **D-76 inverted what a contributor hands back.** The callback took the host's
 * request entity and an `EntityManager` and mutated the first — the manager was
 * never bound at all — so a contributing module decided whether the host's
 * request was `completed`, `failed` or `completed_with_errors`. It returns a
 * snapshot now, and `null` for an id it does not recognise, so the assertions
 * below are about *what comes back* rather than about what was written where.
 */


const layout = await requireModuleLayout('[bulk-progress-registry]');

/** A module's `registerModule` source file, in either layout. */
function backendEntryPointOf(moduleId: string): string {
  const dir = layout.moduleDirectoryOf(moduleId);
  if (dir === null) throw new Error(`[bulk-progress-registry] no such module: ${moduleId}`);
  for (const candidate of [join(dir, 'backend.ts'), join(dir, 'src', 'backend', 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`[bulk-progress-registry] ${moduleId} has no backend entry point under ${dir}`);
}

const snapshot = (overrides: Partial<BulkProgressSnapshot> = {}): BulkProgressSnapshot => ({
  total: 3,
  succeeded: 3,
  failed: 0,
  failures: [],
  terminal: 'completed',
  ...overrides,
});

describe('PromptActionBulkProgressRegistry', () => {
  it('states a skip policy for an absent contributor', () => {
    expect(CONTRIBUTION_POLICY_STATED['prompt_actions:promptActionBulkProgressRegistry']).toBe(
      'skip',
    );
  });

  it('returns a present contributor’s snapshot', async () => {
    const seen: string[] = [];
    const registry = new PromptActionBulkProgressRegistry(() => true);
    registry.register('catalog', async (id) => {
      seen.push(id);
      return snapshot();
    });

    expect(await registry.apply('bulk-1')).toEqual(snapshot());
    expect(seen).toEqual(['bulk-1']);
  });

  it('skips a reader whose owner is absent', async () => {
    const seen: string[] = [];
    const registry = new PromptActionBulkProgressRegistry((moduleId) => moduleId !== 'catalog');
    registry.register('catalog', async () => {
      seen.push('catalog');
      return snapshot({ succeeded: 1 });
    });
    registry.register('inventory', async () => {
      seen.push('inventory');
      return snapshot({ succeeded: 2 });
    });

    const answer = await registry.apply('bulk-1');

    // The policy, behaviourally: the switched-off module's reader is not
    // called, and the other contributor's still is. Reading progress reads the
    // contributor's own tables through the contributor's own services, so a
    // module that is off must not be read through.
    expect(seen).toEqual(['inventory']);
    expect(answer?.succeeded).toBe(2);
    expect(registry.readers()).toHaveLength(1);
  });

  it('answers null when every present contributor disclaims the id', async () => {
    const registry = new PromptActionBulkProgressRegistry(() => true);
    registry.register('catalog', async () => null);

    // Not an error, and not an empty snapshot: a bulk operation id belongs to
    // exactly one contributor, and "none of mine" is what lets the host leave
    // the request reporting no progress rather than reporting zero of zero.
    expect(await registry.apply('bulk-nobody-owns')).toBeNull();
  });

  it('keeps naming an absent contributor, so a diagnostic can say who is missing', () => {
    const registry = new PromptActionBulkProgressRegistry(() => false);
    registry.register('catalog', async () => null);

    // The deliberate asymmetry every registry in this tree carries: enumeration
    // filters, identity does not. Losing the name would make "no progress" and
    // "progress from a module you switched off" indistinguishable to an
    // operator looking at the request.
    expect(registry.contributors()).toEqual(['catalog']);
    expect(registry.readers()).toEqual([]);
  });

  it('asks contributors in registration order and stops at the first answer', async () => {
    const asked: string[] = [];
    const registry = new PromptActionBulkProgressRegistry(() => true);
    registry.register('first', async () => {
      asked.push('first');
      return null;
    });
    registry.register('second', async () => {
      asked.push('second');
      return snapshot();
    });
    registry.register('third', async () => {
      asked.push('third');
      return snapshot();
    });

    await registry.apply('bulk-1');

    // Sequential and first-answer-wins: an id belongs to one contributor, so a
    // second answer would be a second module claiming the same run.
    expect(asked).toEqual(['first', 'second']);
  });

  it('is an ungated registration wired to the kernel effective state', () => {
    // The half a class-level assertion cannot see, and the half that made this
    // a defect for the four PSP registries before feature 074: the class
    // defaults its probe to always-present, so a perfect skip skips nothing
    // unless the one instance the platform composes is handed the real
    // presence. And it must stay `ctx.di.register` — a `providePort` here would
    // 503 a contributor's boot hook when the assistant itself is switched off.
    // Where this module keeps its `registerModule` is resolved, not spelled
    // (feature 080, T040b): `prompt_actions` is a package, so the file is its
    // `./backend` entry point rather than `src/modules/<id>/backend.ts`, and a
    // reader that answered `''` for a module it could not place would pass
    // every assertion below.
    const source = readFileSync(backendEntryPointOf('prompt_actions'), 'utf8');
    expect(source).toContain('promptActionBulkProgressRegistry: ctx');
    expect(source.replace(/\s+/g, '')).toContain(
      'newPromptActionBulkProgressRegistry((moduleId)=>effectiveState.isPresent(moduleId))',
    );
    expect(source).not.toContain("providePort('promptActionBulkProgressRegistry'");
  });
});
