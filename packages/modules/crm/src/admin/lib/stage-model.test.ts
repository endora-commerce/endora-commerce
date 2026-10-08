import { describe, expect, it } from 'vitest';
import type { OpportunityStatusRef, OpportunityWorkflow } from '@endora-commerce/contracts';
import { stageModel } from './stage-model.js';

/**
 * What the stage bar of an Opportunity claims
 * (`specs/143-crm-sales-opportunities/`, User Story 20, FR-112 – FR-114).
 *
 * The workflow is a graph the operator draws, so the cases that matter are the
 * ones a straight line would get wrong: a move backwards, two closing statuses,
 * an order that is not the order of the codes, and a workflow that is not known.
 */

const ref = (
  code: string,
  kind: OpportunityStatusRef['kind'] = 'open',
  name = code,
): OpportunityStatusRef => ({ code, name, color: '#64748b', kind });

function workflow(
  statuses: readonly [code: string, kind: OpportunityStatusRef['kind'], weight: number][],
): OpportunityWorkflow {
  return {
    statuses: statuses.map(([code, kind, weight]) => ({
      code,
      name: { en: `${code} (en)` },
      defaultName: code,
      kind,
      isInitial: false,
      weight,
      color: '#64748b',
      inUseCount: 0,
    })),
    transitions: [],
    orderStatusMappings: [],
    valueCountingStatuses: { order: [], quoteRequest: [] },
  };
}

const SEEDED = workflow([
  ['lost', 'lost', 100],
  ['won', 'won', 90],
  ['negotiation', 'open', 40],
  ['new', 'open', 10],
  ['qualified', 'open', 20],
]);

const label = (status: { name: Record<string, string> }): string => status.name.en ?? '';

describe('stageModel', () => {
  it('lists the statuses in the operator`s order — by weight, open ones first, closing ones after', () => {
    const model = stageModel({ status: ref('new'), allowedTransitions: [] }, SEEDED, label);
    expect(model.segments.map((segment) => segment.code)).toEqual([
      'new',
      'qualified',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(model.complete).toBe(true);
  });

  it('keeps a closing status after the open ones even where its weight puts it among them', () => {
    const model = stageModel(
      { status: ref('new'), allowedTransitions: [] },
      workflow([
        ['new', 'open', 10],
        ['lost', 'lost', 15],
        ['qualified', 'open', 20],
      ]),
      label,
    );
    expect(model.segments.map((segment) => segment.code)).toEqual(['new', 'qualified', 'lost']);
    expect(model.total).toBe(2);
  });

  it('counts the position over the open statuses only', () => {
    const model = stageModel({ status: ref('qualified'), allowedTransitions: [] }, SEEDED, label);
    expect([model.position, model.total]).toEqual([2, 3]);
  });

  it('gives a closed Opportunity no position — won and lost are two ends, not steps four and five', () => {
    const model = stageModel({ status: ref('lost', 'lost'), allowedTransitions: [] }, SEEDED, label);
    expect(model.position).toBeNull();
    expect(model.total).toBe(3);
    expect(model.segments.find((segment) => segment.state === 'current')?.code).toBe('lost');
  });

  it('marks exactly the server`s allowed transitions as targets, a move backwards included', () => {
    const model = stageModel(
      {
        status: ref('negotiation'),
        allowedTransitions: [ref('new'), ref('won', 'won')],
      },
      SEEDED,
      label,
    );
    expect(model.segments.map((segment) => [segment.code, segment.state])).toEqual([
      ['new', 'target'],
      ['qualified', 'other'],
      ['negotiation', 'current'],
      ['won', 'target'],
      ['lost', 'other'],
    ]);
  });

  it('never marks a status as passed: there are three states and "done" is not one of them', () => {
    const model = stageModel({ status: ref('negotiation'), allowedTransitions: [] }, SEEDED, label);
    expect(new Set(model.segments.map((segment) => segment.state))).toEqual(
      new Set(['current', 'other']),
    );
  });

  it('names the current status and a target as the server resolved them, and any other from the workflow', () => {
    const model = stageModel(
      {
        status: ref('new', 'open', 'Nowa'),
        allowedTransitions: [ref('qualified', 'open', 'Zakwalifikowana')],
      },
      SEEDED,
      label,
    );
    expect(model.segments.map((segment) => segment.name)).toEqual([
      'Nowa',
      'Zakwalifikowana',
      'negotiation (en)',
      'won (en)',
      'lost (en)',
    ]);
  });

  it('falls back to the current status and its targets when the workflow is not known', () => {
    const model = stageModel(
      { status: ref('new'), allowedTransitions: [ref('qualified'), ref('lost', 'lost')] },
      null,
      label,
    );
    expect(model).toEqual({
      segments: [
        { ...ref('new'), state: 'current' },
        { ...ref('qualified'), state: 'target' },
        { ...ref('lost', 'lost'), state: 'target' },
      ],
      position: null,
      total: null,
      complete: false,
    });
  });

  it('falls back the same way when the current status is not in the workflow that was read', () => {
    const model = stageModel(
      { status: ref('archived'), allowedTransitions: [ref('new')] },
      SEEDED,
      label,
    );
    expect(model.complete).toBe(false);
    expect(model.segments.map((segment) => segment.code)).toEqual(['archived', 'new']);
  });

  it('keeps a target the workflow read does not carry yet — an allowed move is never dropped', () => {
    const model = stageModel(
      { status: ref('new'), allowedTransitions: [ref('on_hold')] },
      SEEDED,
      label,
    );
    expect(model.segments.at(-1)).toEqual({ ...ref('on_hold'), state: 'target' });
  });
});
