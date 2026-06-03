import { describe, expect, it } from 'vitest';
import {
  buildDefaultGraph,
  computeDefaultTransitions,
  materializeUniversalTransitions,
  OrderStatusConfigError,
  OrderStatusGraph,
  resolveOrderStatusName,
  type OrderStatusDef,
} from './order-status-graph.js';

describe('resolveOrderStatusName', () => {
  const def = { code: 'paid', name: { en: 'Paid', pl: 'Zapłacone' }, defaultName: 'Paid' };

  it('returns the translation for the active language', () => {
    expect(resolveOrderStatusName(def, 'pl')).toBe('Zapłacone');
  });

  it('falls back to the default name when the language is missing', () => {
    expect(resolveOrderStatusName(def, 'de')).toBe('Paid');
  });

  it('falls back to the code when neither a translation nor a default name exists', () => {
    expect(resolveOrderStatusName({ code: 'x', name: {}, defaultName: '' }, 'pl')).toBe('x');
  });
});

describe('OrderStatusGraph — default seed', () => {
  const graph = buildDefaultGraph();

  it('starts at the immutable initial status `new`', () => {
    expect(graph.initialCode()).toBe('new');
    expect(graph.isInitial('new')).toBe(true);
  });

  it('allows the predefined explicit transitions', () => {
    expect(graph.canTransition('new', 'pending')).toBe(true);
    expect(graph.canTransition('pending', 'paid')).toBe(true);
    expect(graph.canTransition('pending', 'processing')).toBe(true);
    expect(graph.canTransition('paid', 'completed')).toBe(true);
    expect(graph.canTransition('shipment_ready', 'shipment_sent')).toBe(true);
  });

  it('rejects a transition with no configured edge (Scenario 3)', () => {
    expect(graph.canTransition('pending', 'shipment_sent')).toBe(false);
    expect(graph.canTransition('new', 'completed')).toBe(false);
  });

  it('treats completed and cancelled as terminal — no exit (Scenario 5)', () => {
    expect(graph.isTerminal('completed')).toBe(true);
    expect(graph.isTerminal('cancelled')).toBe(true);
    expect(graph.canTransition('completed', 'on_hold')).toBe(false);
    expect(graph.canTransition('cancelled', 'new')).toBe(false);
    expect(graph.allowedTargets('completed')).toEqual([]);
  });

  it('lets any non-terminal status go on_hold and cancelled (Scenario 4)', () => {
    for (const code of ['new', 'pending', 'paid', 'processing', 'shipment_ready', 'shipment_sent']) {
      expect(graph.canTransition(code, 'on_hold')).toBe(true);
      expect(graph.canTransition(code, 'cancelled')).toBe(true);
    }
  });

  it('lets on_hold go to every other status, but never to itself', () => {
    expect(graph.canTransition('on_hold', 'new')).toBe(true);
    expect(graph.canTransition('on_hold', 'completed')).toBe(true);
    expect(graph.canTransition('on_hold', 'cancelled')).toBe(true);
    expect(graph.canTransition('on_hold', 'on_hold')).toBe(false);
  });

  it('returns false for unknown status codes', () => {
    expect(graph.canTransition('new', 'does_not_exist')).toBe(false);
    expect(graph.canTransition('ghost', 'new')).toBe(false);
  });
});

describe('materializeUniversalTransitions', () => {
  it('never produces self-edges and skips terminal sources', () => {
    const edges = materializeUniversalTransitions([
      { code: 'new', name: {}, defaultName: '', isInitial: true, isTerminal: false, isSystem: true, weight: 1, color: '#64748b' },
      { code: 'on_hold', name: {}, defaultName: '', isInitial: false, isTerminal: false, isSystem: true, weight: 2, color: '#64748b' },
      { code: 'cancelled', name: {}, defaultName: '', isInitial: false, isTerminal: true, isSystem: true, weight: 3, color: '#64748b' },
    ]);
    expect(edges.every((e) => e.fromStatusCode !== e.toStatusCode)).toBe(true);
    // cancelled is terminal → no outgoing universal edge from it.
    expect(edges.some((e) => e.fromStatusCode === 'cancelled')).toBe(false);
    // new (non-terminal) → on_hold and → cancelled.
    expect(edges).toContainEqual({ fromStatusCode: 'new', toStatusCode: 'on_hold', isSystem: true });
    expect(edges).toContainEqual({ fromStatusCode: 'new', toStatusCode: 'cancelled', isSystem: true });
  });
});

describe('computeDefaultTransitions', () => {
  it('has no duplicate edges', () => {
    const edges = computeDefaultTransitions();
    const keys = edges.map((e) => `${e.fromStatusCode} ${e.toStatusCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('OrderStatusGraph.assertValid', () => {
  const base: OrderStatusDef[] = [
    { code: 'new', name: {}, defaultName: '', isInitial: true, isTerminal: false, isSystem: true, weight: 1, color: '#64748b' },
    { code: 'done', name: {}, defaultName: '', isInitial: false, isTerminal: true, isSystem: true, weight: 2, color: '#64748b' },
  ];

  it('passes a well-formed config', () => {
    expect(() => new OrderStatusGraph(base, [{ fromStatusCode: 'new', toStatusCode: 'done', isSystem: false }]).assertValid()).not.toThrow();
  });

  it('rejects more than one initial status', () => {
    const two = [...base, { code: 'new2', name: {}, defaultName: '', isInitial: true, isTerminal: false, isSystem: false, weight: 3, color: '#64748b' }];
    expect(() => new OrderStatusGraph(two, []).assertValid()).toThrow(OrderStatusConfigError);
  });

  it('rejects an outgoing edge from a terminal status', () => {
    expect(() =>
      new OrderStatusGraph(base, [{ fromStatusCode: 'done', toStatusCode: 'new', isSystem: false }]).assertValid(),
    ).toThrow(OrderStatusConfigError);
  });

  it('rejects an edge referencing an unknown status', () => {
    expect(() =>
      new OrderStatusGraph(base, [{ fromStatusCode: 'new', toStatusCode: 'ghost', isSystem: false }]).assertValid(),
    ).toThrow(OrderStatusConfigError);
  });
});
