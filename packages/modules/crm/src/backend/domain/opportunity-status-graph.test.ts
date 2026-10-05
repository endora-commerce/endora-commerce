import { describe, expect, it } from 'vitest';
import {
  OpportunityStatusGraph,
  OpportunityWorkflowConfigError,
  type OpportunityStatusDef,
  type OpportunityTransitionDef,
} from './opportunity-status-graph.js';

function status(
  code: string,
  kind: OpportunityStatusDef['kind'],
  overrides: Partial<OpportunityStatusDef> = {},
): OpportunityStatusDef {
  return {
    code,
    name: {},
    defaultName: code,
    kind,
    isInitial: false,
    weight: 100,
    color: '#64748b',
    ...overrides,
  };
}

const edge = (fromStatusCode: string, toStatusCode: string): OpportunityTransitionDef => ({
  fromStatusCode,
  toStatusCode,
});

/** The seeded default workflow of `data-model.md`. */
function defaultStatuses(): OpportunityStatusDef[] {
  return [
    status('new', 'open', { isInitial: true, weight: 10 }),
    status('qualified', 'open', { weight: 20 }),
    status('proposal', 'open', { weight: 30 }),
    status('negotiation', 'open', { weight: 40 }),
    status('won', 'won', { weight: 90 }),
    status('lost', 'lost', { weight: 100 }),
  ];
}

function defaultTransitions(): OpportunityTransitionDef[] {
  return [
    edge('new', 'qualified'),
    edge('qualified', 'proposal'),
    edge('proposal', 'negotiation'),
    edge('negotiation', 'won'),
    edge('proposal', 'won'),
    edge('new', 'lost'),
    edge('qualified', 'lost'),
    edge('proposal', 'lost'),
    edge('negotiation', 'lost'),
    edge('lost', 'new'),
  ];
}

function ruleOf(act: () => void): string | undefined {
  try {
    act();
  } catch (error) {
    if (error instanceof OpportunityWorkflowConfigError) return error.rule;
    throw error;
  }
  return undefined;
}

describe('OpportunityStatusGraph', () => {
  const graph = new OpportunityStatusGraph(defaultStatuses(), defaultTransitions());

  it('has: knows the configured codes and no other', () => {
    expect(graph.has('proposal')).toBe(true);
    expect(graph.has('archived')).toBe(false);
  });

  it('kindOf: answers the kind of a status, and undefined for an unknown code', () => {
    expect(graph.kindOf('negotiation')).toBe('open');
    expect(graph.kindOf('won')).toBe('won');
    expect(graph.kindOf('lost')).toBe('lost');
    expect(graph.kindOf('archived')).toBeUndefined();
  });

  it('initial: answers the one initial status', () => {
    expect(graph.initial().code).toBe('new');
  });

  it('canTransition: true for a configured edge only', () => {
    expect(graph.canTransition('new', 'qualified')).toBe(true);
    expect(graph.canTransition('qualified', 'new')).toBe(false);
    expect(graph.canTransition('new', 'won')).toBe(false);
  });

  it('canTransition: false when either end is not a configured status', () => {
    expect(graph.canTransition('new', 'archived')).toBe(false);
    expect(graph.canTransition('archived', 'new')).toBe(false);
  });

  it('canTransition: a closing status may have outgoing edges — reopening is a transition', () => {
    expect(graph.kindOf('lost')).toBe('lost');
    expect(graph.canTransition('lost', 'new')).toBe(true);
    // …and only the ones configured: `won` has none in the default workflow.
    expect(graph.canTransition('won', 'new')).toBe(false);
  });

  it('allowedTargets: the configured targets of a status, by weight', () => {
    expect(graph.allowedTargets('proposal')).toEqual(['negotiation', 'won', 'lost']);
    expect(graph.allowedTargets('won')).toEqual([]);
    expect(graph.allowedTargets('archived')).toEqual([]);
  });

  describe('assertValid', () => {
    it('accepts the default workflow, reopening edge included', () => {
      expect(ruleOf(() => graph.assertValid())).toBeUndefined();
    });

    it('refuses a workflow with no initial status', () => {
      const statuses = defaultStatuses().map((s) => ({ ...s, isInitial: false }));
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, defaultTransitions()).assertValid())).toBe(
        'exactly_one_initial',
      );
    });

    it('refuses a workflow with two initial statuses', () => {
      const statuses = defaultStatuses().map((s) =>
        s.code === 'qualified' ? { ...s, isInitial: true } : s,
      );
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, defaultTransitions()).assertValid())).toBe(
        'exactly_one_initial',
      );
    });

    it('refuses an initial status that is not open', () => {
      const statuses = defaultStatuses().map((s) => ({ ...s, isInitial: s.code === 'won' }));
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, defaultTransitions()).assertValid())).toBe(
        'initial_must_be_open',
      );
    });

    it('refuses a workflow with no won status', () => {
      const statuses = defaultStatuses().filter((s) => s.kind !== 'won');
      const transitions = defaultTransitions().filter((t) => t.toStatusCode !== 'won');
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, transitions).assertValid())).toBe(
        'won_status_required',
      );
    });

    it('refuses a workflow with no lost status', () => {
      const statuses = defaultStatuses().filter((s) => s.kind !== 'lost');
      const transitions = defaultTransitions().filter(
        (t) => t.toStatusCode !== 'lost' && t.fromStatusCode !== 'lost',
      );
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, transitions).assertValid())).toBe(
        'lost_status_required',
      );
    });

    it('refuses an edge naming an unknown status, at either end', () => {
      expect(
        ruleOf(() =>
          new OpportunityStatusGraph(defaultStatuses(), [
            ...defaultTransitions(),
            edge('new', 'archived'),
          ]).assertValid(),
        ),
      ).toBe('transition_unknown_status');
      expect(
        ruleOf(() =>
          new OpportunityStatusGraph(defaultStatuses(), [
            ...defaultTransitions(),
            edge('archived', 'new'),
          ]).assertValid(),
        ),
      ).toBe('transition_unknown_status');
    });

    it('initial(): throws the same rule when asked of a workflow that has none', () => {
      const statuses = defaultStatuses().map((s) => ({ ...s, isInitial: false }));
      expect(ruleOf(() => new OpportunityStatusGraph(statuses, []).initial())).toBe('exactly_one_initial');
    });
  });
});
