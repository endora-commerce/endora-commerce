import { describe, it, expect } from 'vitest';
import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';

function m(id: string, deps: string[] = []): ModuleManifest {
  return defineModuleManifest({
    id,
    name: id,
    version: '1.0.0',
    dependencies: deps,
  });
}

describe('ModuleDepGraph', () => {
  it('detects no cycle in a DAG', () => {
    const graph = new ModuleDepGraph([m('a'), m('b', ['a']), m('c', ['b'])]);
    expect(graph.hasCycle()).toBeNull();
  });

  it('detects a direct cycle', () => {
    const graph = new ModuleDepGraph([m('a', ['b']), m('b', ['a'])]);
    const cycle = graph.hasCycle();
    expect(cycle).not.toBeNull();
    expect(cycle!.cycle.length).toBeGreaterThanOrEqual(2);
    expect(new Set(cycle!.cycle)).toEqual(new Set(['a', 'b']));
  });

  it('detects a transitive cycle', () => {
    const graph = new ModuleDepGraph([
      m('a', ['b']),
      m('b', ['c']),
      m('c', ['a']),
    ]);
    const cycle = graph.hasCycle();
    expect(cycle).not.toBeNull();
    expect(new Set(cycle!.cycle)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns dependency-first topological order', () => {
    const graph = new ModuleDepGraph([m('a'), m('b', ['a']), m('c', ['a', 'b'])]);
    const order = graph.topologicalOrder();
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('reports direct dependents', () => {
    const graph = new ModuleDepGraph([m('a'), m('b', ['a']), m('c', ['a'])]);
    expect(graph.dependentsOf('a')).toEqual(['b', 'c']);
    expect(graph.dependentsOf('b')).toEqual([]);
  });

  it('reports transitive dependents', () => {
    const graph = new ModuleDepGraph([
      m('a'),
      m('b', ['a']),
      m('c', ['b']),
      m('d', ['a']),
    ]);
    expect(graph.transitiveDependentsOf('a').sort()).toEqual(['b', 'c', 'd']);
  });

  it('reports unresolved deps relative to an installed set', () => {
    const graph = new ModuleDepGraph([m('a'), m('b', ['a', 'c']), m('c')]);
    expect(graph.unresolvedDependenciesOf('b', new Set(['a']))).toEqual(['c']);
    expect(graph.unresolvedDependenciesOf('b', new Set(['a', 'c']))).toEqual([]);
  });
});
