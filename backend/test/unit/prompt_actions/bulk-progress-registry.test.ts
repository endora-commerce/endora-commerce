import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CONTRIBUTION_POLICY_STATED } from '../../../scripts/check-port-dependencies.js';
import { PromptActionBulkProgressRegistry } from '../../../src/modules/prompt_actions/services/bulk-progress-registry.js';
import type { PromptActionRequest } from '../../../src/modules/prompt_actions/entities/prompt-action-request.entity.js';

/**
 * `PromptActionBulkProgressRegistry` — D-72 point 4.
 *
 * The seam that let the last member of the D-44 family leave both composition
 * roots. It replaces a single container name `prompt_actions` defaulted to
 * `undefined` and a root overwrote with `catalog`'s resolver, which is the one
 * shape a module cannot push into: a module may not write a name another module
 * owns, so the contribution had nowhere to go but a root.
 *
 * Two properties, and only the second is new work. The first is the D-39
 * contribution-seam contract every registry in this tree is held to: the entry
 * records its contributor and the class states, and implements, what it does
 * with an absent one.
 */

const backendRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** A row shaped only where the resolvers below touch it. */
const row = (): PromptActionRequest => ({ id: 'req-1' }) as unknown as PromptActionRequest;
const em = (): EntityManager => ({}) as unknown as EntityManager;

describe('PromptActionBulkProgressRegistry', () => {
  it('states a skip policy for an absent contributor', () => {
    expect(CONTRIBUTION_POLICY_STATED['prompt_actions:promptActionBulkProgressRegistry']).toBe(
      'skip',
    );
  });

  it('runs a present contributor’s resolver', async () => {
    const seen: string[] = [];
    const registry = new PromptActionBulkProgressRegistry(() => true);
    registry.register('catalog', async () => {
      seen.push('catalog');
    });

    await registry.apply(row(), em());
    expect(seen).toEqual(['catalog']);
  });

  it('skips a resolver whose owner is absent', async () => {
    const seen: string[] = [];
    const registry = new PromptActionBulkProgressRegistry((moduleId) => moduleId !== 'catalog');
    registry.register('catalog', async () => {
      seen.push('catalog');
    });
    registry.register('inventory', async () => {
      seen.push('inventory');
    });

    await registry.apply(row(), em());

    // The policy, behaviourally: the switched-off module's resolver is not
    // called, and the other contributor's still is. Folding progress reads the
    // contributor's own tables through the contributor's own services, so a
    // module that is off must not be read through.
    expect(seen).toEqual(['inventory']);
    expect(registry.resolvers()).toHaveLength(1);
  });

  it('keeps naming an absent contributor, so a diagnostic can say who is missing', () => {
    const registry = new PromptActionBulkProgressRegistry(() => false);
    registry.register('catalog', async () => {});

    // The deliberate asymmetry every registry in this tree carries: enumeration
    // filters, identity does not. Losing the name would make "no progress" and
    // "progress from a module you switched off" indistinguishable to an
    // operator looking at the request.
    expect(registry.contributors()).toEqual(['catalog']);
    expect(registry.resolvers()).toEqual([]);
  });

  it('applies contributors in registration order, one at a time', async () => {
    const order: string[] = [];
    const registry = new PromptActionBulkProgressRegistry(() => true);
    registry.register('first', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
    });
    registry.register('second', async () => {
      order.push('second');
    });

    await registry.apply(row(), em());

    // Sequential, not concurrent: every resolver mutates the same managed row,
    // and two of them writing `row.result` in parallel would make the last
    // write win by scheduling accident.
    expect(order).toEqual(['first', 'second']);
  });

  it('is an ungated registration wired to the kernel effective state', () => {
    // The half a class-level assertion cannot see, and the half that made this
    // a defect for the four PSP registries before feature 074: the class
    // defaults its probe to always-present, so a perfect skip skips nothing
    // unless the one instance the platform composes is handed the real
    // presence. And it must stay `ctx.di.register` — a `providePort` here would
    // 503 a contributor's boot hook when the assistant itself is switched off.
    const source = readFileSync(`${backendRoot}src/modules/prompt_actions/backend.ts`, 'utf8');
    expect(source).toContain('promptActionBulkProgressRegistry: ctx');
    expect(source.replace(/\s+/g, '')).toContain(
      'newPromptActionBulkProgressRegistry((moduleId)=>effectiveState.isPresent(moduleId))',
    );
    expect(source).not.toContain("providePort('promptActionBulkProgressRegistry'");
  });
});
