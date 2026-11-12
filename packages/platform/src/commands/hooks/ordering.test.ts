import { describe, expect, it } from 'vitest';
import { CommandHookOrderContradictionError, UnorderedCommandHooksError } from './errors.js';
import { orderCommandHooks, type CommandHookRegistration } from './ordering.js';

/**
 * `specs/176-command-hooks-outbox/` T023 (FR-013, FR-014): the order of one
 * action's `beforeCommit` hooks is derived from the manifest dependency graph,
 * a module's own hooks keep their registration order, a deployment may break a
 * tie the graph leaves open, and identical inputs give an identical order.
 */

const ACTION = 'organization.create';
let seq = 0;
function hook(moduleId: string, id: string): CommandHookRegistration {
  seq += 1;
  return { moduleId, id, action: ACTION, phase: 'beforeCommit', handler: () => undefined, seq };
}

function order(
  registrations: readonly CommandHookRegistration[],
  dependencies: Readonly<Record<string, readonly string[]>>,
  tieBreak?: readonly string[],
): string[] {
  return orderCommandHooks(ACTION, 'beforeCommit', registrations, dependencies, tieBreak).map(
    (registration) => `${registration.moduleId}#${registration.id}`,
  );
}

describe('orderCommandHooks (176 T023)', () => {
  it('runs a module after every module it transitively depends on', () => {
    const a = hook('acme_a', 'one');
    const b = hook('acme_b', 'one');
    const c = hook('acme_c', 'one');
    // The closure is what the root derives: c reaches a only through b.
    const dependencies = { acme_a: ['organizations'], acme_b: ['acme_a', 'organizations'], acme_c: ['acme_b', 'acme_a', 'organizations'] };
    expect(order([c, a, b], dependencies)).toEqual(['acme_a#one', 'acme_b#one', 'acme_c#one']);
  });

  it("keeps one module's hooks in the order it registered them", () => {
    const first = hook('acme_a', 'first');
    const other = hook('acme_b', 'only');
    const second = hook('acme_a', 'second');
    const dependencies = { acme_a: [], acme_b: ['acme_a'] };
    expect(order([second, other, first], dependencies)).toEqual(['acme_a#first', 'acme_a#second', 'acme_b#only']);
  });

  it('breaks a tie the graph leaves open with the deployment order, first runs first', () => {
    const x = hook('acme_x', 'one');
    const y = hook('acme_y', 'one');
    expect(order([x, y], { acme_x: [], acme_y: [] }, ['acme_y', 'acme_x'])).toEqual(['acme_y#one', 'acme_x#one']);
  });

  it('refuses two unrelated modules with no deployment order, naming both and the action', () => {
    const x = hook('acme_x', 'one');
    const y = hook('acme_y', 'two');
    let thrown: unknown;
    try {
      order([x, y], { acme_x: [], acme_y: [] });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnorderedCommandHooksError);
    const message = (thrown as Error).message;
    expect(message).toContain('acme_x');
    expect(message).toContain('acme_y');
    expect(message).toContain(ACTION);
    expect(message).toContain('commandHookOrder');
  });

  it('refuses a deployment order that contradicts a dependency path', () => {
    const a = hook('acme_a', 'one');
    const b = hook('acme_b', 'one');
    expect(() => order([a, b], { acme_a: [], acme_b: ['acme_a'] }, ['acme_b', 'acme_a'])).toThrow(
      CommandHookOrderContradictionError,
    );
    expect(() => order([a, b], { acme_a: [], acme_b: ['acme_a'] }, ['acme_b', 'acme_a'])).toThrow(
      /acme_a[\s\S]*acme_b|acme_b[\s\S]*acme_a/,
    );
  });

  it('gives the same order for every permutation of the same input', () => {
    const hooks = [hook('acme_a', 'one'), hook('acme_b', 'one'), hook('acme_c', 'one'), hook('acme_d', 'one')];
    const dependencies = { acme_a: [], acme_b: ['acme_a'], acme_c: ['acme_a'], acme_d: ['acme_c', 'acme_b', 'acme_a'] };
    const tieBreak = ['acme_c', 'acme_b'];
    const expected = order(hooks, dependencies, tieBreak);
    expect(expected).toEqual(['acme_a#one', 'acme_c#one', 'acme_b#one', 'acme_d#one']);
    for (const permutation of [
      [hooks[3]!, hooks[2]!, hooks[1]!, hooks[0]!],
      [hooks[1]!, hooks[3]!, hooks[0]!, hooks[2]!],
      [hooks[2]!, hooks[0]!, hooks[3]!, hooks[1]!],
    ]) {
      expect(order(permutation, dependencies, tieBreak)).toEqual(expected);
    }
  });
});
