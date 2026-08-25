import { describe, expect, it } from 'vitest';
import {
  buildDefaultReturnGraph,
  computeDefaultTransitions,
  DEFAULT_RETURN_STATUSES,
  ReturnStatusConfigError,
  ReturnStatusGraph,
  type ReturnStatusDef,
} from '../../../../packages/modules/returns/src/backend/domain/return-status-graph.js';

describe('ReturnStatusGraph — default seed', () => {
  const graph = buildDefaultReturnGraph();

  it('has exactly one initial status (new)', () => {
    const initials = DEFAULT_RETURN_STATUSES.filter((s) => s.isInitial);
    expect(initials).toHaveLength(1);
    expect(initials[0]!.code).toBe('new');
    expect(graph.initialCode()).toBe('new');
  });

  it('marks rejected / closed / cancelled as terminal', () => {
    expect(graph.isTerminal('rejected')).toBe(true);
    expect(graph.isTerminal('closed')).toBe(true);
    expect(graph.isTerminal('cancelled')).toBe(true);
    expect(graph.isTerminal('new')).toBe(false);
  });

  it('allows the default forward edges', () => {
    expect(graph.canTransition('new', 'authorized')).toBe(true);
    expect(graph.canTransition('authorized', 'received')).toBe(true);
    expect(graph.canTransition('received', 'resolved')).toBe(true);
    expect(graph.canTransition('resolved', 'closed')).toBe(true);
  });

  it('rejects edges that are not configured', () => {
    expect(graph.canTransition('new', 'resolved')).toBe(false);
    expect(graph.canTransition('new', 'closed')).toBe(false);
  });

  it('never allows leaving a terminal status', () => {
    for (const terminal of ['rejected', 'closed', 'cancelled']) {
      expect(graph.allowedTargets(terminal)).toEqual([]);
      expect(graph.canTransition(terminal, 'new')).toBe(false);
    }
  });

  it('passes structural validation', () => {
    expect(() => graph.assertValid()).not.toThrow();
  });

  it('orders allowed targets by weight', () => {
    // from `new`: authorized(20) < rejected(50) < cancelled(70)
    expect(graph.allowedTargets('new')).toEqual(['authorized', 'rejected', 'cancelled']);
  });
});

describe('ReturnStatusGraph — invariants', () => {
  it('rejects a config with no initial status', () => {
    const statuses: ReturnStatusDef[] = DEFAULT_RETURN_STATUSES.map((s) => ({ ...s, isInitial: false }));
    const g = new ReturnStatusGraph(statuses, computeDefaultTransitions());
    expect(() => g.assertValid()).toThrow(ReturnStatusConfigError);
  });

  it('rejects a config with two initial statuses', () => {
    const statuses: ReturnStatusDef[] = DEFAULT_RETURN_STATUSES.map((s) =>
      s.code === 'authorized' ? { ...s, isInitial: true } : { ...s },
    );
    const g = new ReturnStatusGraph(statuses, computeDefaultTransitions());
    expect(() => g.assertValid()).toThrow(/Exactly one initial/);
  });

  it('rejects an edge leaving a terminal status', () => {
    const g = new ReturnStatusGraph(DEFAULT_RETURN_STATUSES.map((s) => ({ ...s })), [
      ...computeDefaultTransitions(),
      { fromStatusCode: 'closed', toStatusCode: 'new', isSystem: false },
    ]);
    expect(() => g.assertValid()).toThrow(/Terminal status/);
  });

  it('rejects an edge referencing an unknown status', () => {
    const g = new ReturnStatusGraph(DEFAULT_RETURN_STATUSES.map((s) => ({ ...s })), [
      { fromStatusCode: 'new', toStatusCode: 'ghost', isSystem: false },
    ]);
    expect(() => g.assertValid()).toThrow(/unknown status/);
  });
});
