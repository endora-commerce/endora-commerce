import { describe, expect, it } from 'vitest';
import { orderByModuleGraph, type ModuleGraphOrderOptions } from './ordering.js';

/**
 * `specs/189-command-middleware/` T007 (FR-030, FR-031): the ordering shared by
 * command hooks (176) and `admit` command middleware (189). A module's items
 * run after those of every module it transitively depends on, one module's
 * items keep their registration order, a deployment tie-break ranks what the
 * graph leaves open, and identical inputs give an identical order however they
 * arrived.
 */

interface Item {
  readonly moduleId: string;
  readonly id: string;
  readonly seq: number;
}

class Unordered extends Error {
  constructor(readonly pair: readonly [string, string]) {
    super(`unordered ${pair.join(' ')}`);
  }
}
class Contradiction extends Error {
  constructor(readonly before: string, readonly after: string) {
    super(`contradiction ${before} before ${after}`);
  }
}

let seq = 0;
const item = (moduleId: string, id = 'one'): Item => ({ moduleId, id, seq: (seq += 1) });

function order(
  items: readonly Item[],
  dependencies: Readonly<Record<string, readonly string[]>>,
  extra: Partial<ModuleGraphOrderOptions> = {},
): string[] {
  return orderByModuleGraph(items, {
    dependencies,
    unordered: (a, b) => new Unordered([a, b]),
    contradiction: (before, after) => new Contradiction(before, after),
    ...extra,
  }).map((entry) => `${entry.moduleId}#${entry.id}`);
}

describe('orderByModuleGraph (189 T007)', () => {
  it('runs a module after every module it transitively depends on', () => {
    const dependencies = { a: [], b: ['a'], c: ['b', 'a'] };
    expect(order([item('c'), item('a'), item('b')], dependencies)).toEqual(['a#one', 'b#one', 'c#one']);
  });

  it("keeps one module's items in registration order", () => {
    const second = item('a', 'second');
    const other = item('b', 'only');
    const first = { ...item('a', 'first'), seq: 0 };
    expect(order([second, other, first], { a: [], b: ['a'] })).toEqual(['a#first', 'a#second', 'b#only']);
  });

  it('breaks a tie the graph leaves open with the deployment order, first runs first', () => {
    expect(order([item('x'), item('y')], { x: [], y: [] }, { tieBreak: ['y', 'x'] })).toEqual(['y#one', 'x#one']);
  });

  it('refuses an unordered pair through the caller’s error, in sorted pair order', () => {
    let thrown: unknown;
    try {
      order([item('z'), item('y'), item('x')], { x: [], y: [], z: [] });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Unordered);
    expect((thrown as Unordered).pair).toEqual(['x', 'y']);
  });

  it('refuses a tie-break that contradicts a dependency path', () => {
    let thrown: unknown;
    try {
      order([item('a'), item('b')], { a: [], b: ['a'] }, { tieBreak: ['b', 'a'] });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Contradiction);
    expect(thrown).toMatchObject({ before: 'a', after: 'b' });
  });

  it('leaves a pair the caller says needs no order unranked, and still orders deterministically', () => {
    // `b` and `c` are disjoint (no order needed), `c` depends on `a`.
    const requiresOrder = (left: string, right: string): boolean => !(new Set([left, right]).has('b') && new Set([left, right]).has('c'));
    const dependencies = { a: [], b: ['a'], c: ['a'] };
    expect(order([item('c'), item('b'), item('a')], dependencies, { requiresOrder })).toEqual(['a#one', 'b#one', 'c#one']);
  });

  it('respects a dependency even where the module-id order says otherwise', () => {
    // `m` depends on `z`; `a` is unrelated to both and needs no order.
    const requiresOrder = (left: string, right: string): boolean => left !== 'a' && right !== 'a';
    const dependencies = { a: [], m: ['z'], z: [] };
    const result = order([item('m'), item('a'), item('z')], dependencies, { requiresOrder });
    expect(result.indexOf('z#one')).toBeLessThan(result.indexOf('m#one'));
    expect(result).toEqual(['a#one', 'z#one', 'm#one']);
  });

  it('gives the same order for every arrival order of the same input', () => {
    const items = [item('d'), item('a'), item('c'), item('b'), item('a', 'two')];
    const dependencies = { a: [], b: ['a'], c: ['a'], d: ['c', 'a'] };
    const tieBreak = ['c', 'b', 'd'];
    const expected = order(items, dependencies, { tieBreak });
    for (let i = 0; i < 20; i += 1) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      expect(order(shuffled, dependencies, { tieBreak })).toEqual(expected);
    }
    expect(expected).toEqual(['a#one', 'a#two', 'c#one', 'b#one', 'd#one']);
  });
});
