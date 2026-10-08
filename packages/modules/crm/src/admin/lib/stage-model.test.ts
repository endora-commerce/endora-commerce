import { describe, expect, it } from 'vitest';
import type { OpportunityStatusRef, OpportunityWorkflow } from '@endora-commerce/contracts';
import { stageModel } from './stage-model.js';

/**
 * What the stage bar of an Opportunity offers
 * (`specs/143-crm-sales-opportunities/`, User Story 20, FR-112 – FR-114).
 *
 * The workflow is a graph the operator draws. The bar shows the moves allowed
 * from the current status, sorted into back and forward; these cases are the
 * ones where a guess would be wrong — a closing status with a low weight, a
 * reopening, an order that is not the order of the codes, and a workflow that
 * is not known.
 */

const ref = (code: string, kind: OpportunityStatusRef['kind'] = 'open'): OpportunityStatusRef => ({
  code,
  name: code,
  color: '#64748b',
  kind,
});

function workflow(
  statuses: readonly [code: string, kind: OpportunityStatusRef['kind'], weight: number][],
): Pick<OpportunityWorkflow, 'statuses'> {
  return {
    statuses: statuses.map(([code, kind, weight]) => ({
      code,
      name: { en: code },
      defaultName: code,
      kind,
      isInitial: false,
      weight,
      color: '#64748b',
      inUseCount: 0,
    })),
  };
}

/** Deliberately not in weight order, and not in the order of the codes either. */
const SEEDED = workflow([
  ['lost', 'lost', 100],
  ['won', 'won', 90],
  ['negotiation', 'open', 40],
  ['new', 'open', 10],
  ['qualified', 'open', 20],
]);

const codes = (targets: readonly OpportunityStatusRef[]): string[] => targets.map((target) => target.code);

function sides(
  status: OpportunityStatusRef,
  allowedTransitions: OpportunityStatusRef[],
  known: Pick<OpportunityWorkflow, 'statuses'> | null = SEEDED,
): { back: string[]; forward: string[]; unsorted: string[] } {
  const model = stageModel({ status, allowedTransitions }, known);
  return { back: codes(model.back), forward: codes(model.forward), unsorted: codes(model.unsorted) };
}

describe('stageModel', () => {
  it('sorts the allowed moves into back and forward by the operator`s order', () => {
    expect(
      sides(ref('qualified'), [ref('negotiation'), ref('new'), ref('lost', 'lost')]),
    ).toEqual({ back: ['new'], forward: ['negotiation', 'lost'], unsorted: [] });
  });

  it('offers exactly the server`s allowed transitions — none added, none dropped', () => {
    const allowed = [ref('new'), ref('won', 'won')];
    const model = stageModel({ status: ref('negotiation'), allowedTransitions: allowed }, SEEDED);
    expect([...model.back, ...model.forward, ...model.unsorted]).toEqual(allowed);
    // Qualified is in the workflow and not reachable from here: it is nowhere.
    expect(JSON.stringify(model)).not.toContain('qualified');
  });

  it('has only a forward side at the start, and only a back side where the workflow only returns', () => {
    expect(sides(ref('new'), [ref('qualified')])).toEqual({
      back: [],
      forward: ['qualified'],
      unsorted: [],
    });
    expect(sides(ref('negotiation'), [ref('new'), ref('qualified')])).toEqual({
      back: ['new', 'qualified'],
      forward: [],
      unsorted: [],
    });
  });

  it('is empty on every side where the workflow allows nothing', () => {
    expect(sides(ref('won', 'won'), [])).toEqual({ back: [], forward: [], unsorted: [] });
  });

  it('puts a closing status forward whatever its weight says', () => {
    const early = workflow([
      ['lost', 'lost', 1],
      ['new', 'open', 10],
      ['qualified', 'open', 20],
    ]);
    expect(sides(ref('qualified'), [ref('lost', 'lost'), ref('new')], early)).toEqual({
      back: ['new'],
      forward: ['lost'],
      unsorted: [],
    });
  });

  it('puts reopening back: out of a closing status into an open one', () => {
    expect(sides(ref('lost', 'lost'), [ref('new'), ref('negotiation')])).toEqual({
      back: ['new', 'negotiation'],
      forward: [],
      unsorted: [],
    });
  });

  it('keeps a move from one closing status to the other forward', () => {
    expect(sides(ref('lost', 'lost'), [ref('won', 'won')])).toEqual({
      back: [],
      forward: ['won'],
      unsorted: [],
    });
  });

  it('lists each side in the operator`s order, not the server`s', () => {
    expect(
      sides(ref('new'), [ref('lost', 'lost'), ref('negotiation'), ref('won', 'won'), ref('qualified')]),
    ).toEqual({ back: [], forward: ['qualified', 'negotiation', 'won', 'lost'], unsorted: [] });
  });

  it('does not guess a direction between open statuses when the workflow is not known', () => {
    expect(sides(ref('qualified'), [ref('new'), ref('negotiation')], null)).toEqual({
      back: [],
      forward: [],
      unsorted: ['new', 'negotiation'],
    });
  });

  it('still knows without the workflow that closing is forward and reopening is back', () => {
    expect(sides(ref('qualified'), [ref('new'), ref('lost', 'lost')], null)).toEqual({
      back: [],
      forward: ['lost'],
      unsorted: ['new'],
    });
    expect(sides(ref('won', 'won'), [ref('negotiation')], null)).toEqual({
      back: ['negotiation'],
      forward: [],
      unsorted: [],
    });
  });

  it('leaves unsorted a move whose status, or the current one, the workflow read does not carry', () => {
    expect(sides(ref('new'), [ref('on_hold'), ref('qualified')])).toEqual({
      back: [],
      forward: ['qualified'],
      unsorted: ['on_hold'],
    });
    expect(sides(ref('archived'), [ref('new')])).toEqual({ back: [], forward: [], unsorted: ['new'] });
  });
});
