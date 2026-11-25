import { describe, expect, it } from 'vitest';
import {
  customFieldDifferences,
  effectiveFieldChoices,
  fieldDifferences,
  projectMergeRefusals,
  resolvedCustomFieldValues,
  type MergeableProject,
} from './project-merge-rules.js';

const P = '00000000-0000-4000-8000-000000192a01';
const Q = '00000000-0000-4000-8000-000000192a02';
const R = '00000000-0000-4000-8000-000000192a03';

function project(over: Partial<MergeableProject> & { id: string }): MergeableProject {
  return {
    title: 'Tender',
    description: '',
    valueAmount: null,
    valueCurrency: null,
    startOn: '2026-11-01',
    visibility: 'inherit',
    customFieldValues: {},
    mergedIntoProjectId: null,
    ...over,
  };
}

/** `specs/192-organization-merge/` US6, T081 — the Project host's own rules (FR-090, FR-031). */
describe('projectMergeRefusals', () => {
  it('refuses a merge into itself before anything else (FR-090)', () => {
    expect(projectMergeRefusals(null, null, { survivorId: P, loserId: P })).toEqual([{ code: 'RECORD_MERGE_SAME_RECORD' }]);
  });

  it('refuses a missing or already merged Project on either side', () => {
    expect(projectMergeRefusals(null, project({ id: Q }), { survivorId: P, loserId: Q })[0]).toMatchObject({
      code: 'RECORD_MERGE_RECORD_UNAVAILABLE',
      details: { record: 'survivor', reason: 'missing' },
    });
    expect(
      projectMergeRefusals(project({ id: P }), project({ id: Q, mergedIntoProjectId: R }), { survivorId: P, loserId: Q })[0],
    ).toMatchObject({ code: 'RECORD_MERGE_RECORD_UNAVAILABLE', details: { record: 'loser', reason: 'merged' } });
    expect(
      projectMergeRefusals(project({ id: P, mergedIntoProjectId: R }), project({ id: Q }), { survivorId: P, loserId: Q })[0],
    ).toMatchObject({ details: { record: 'survivor', reason: 'merged' } });
  });

  it('accepts two Projects in any state (FR-090)', () => {
    expect(projectMergeRefusals(project({ id: P }), project({ id: Q }), { survivorId: P, loserId: Q })).toEqual([]);
  });
});

describe('the values offered for choice (FR-090)', () => {
  it('offers only differing values, the survivor’s by default and the loser’s where the survivor has none', () => {
    const survivor = project({ id: P, title: 'Tender A', description: '', valueAmount: null, valueCurrency: null });
    const loser = project({ id: Q, title: 'Tender B', description: 'Details', valueAmount: '1200.00', valueCurrency: 'PLN' });
    expect(fieldDifferences(survivor, loser)).toEqual([
      { code: 'title', survivor: 'Tender A', loser: 'Tender B', default: 'survivor' },
      { code: 'description', survivor: '', loser: 'Details', default: 'loser' },
      { code: 'value', survivor: null, loser: { amount: '1200.00', currency: 'PLN' }, default: 'loser' },
    ]);
  });

  it('applies the operator’s choice over each default, and nothing for an equal value', () => {
    const survivor = project({ id: P, title: 'A', visibility: 'everyone' });
    const loser = project({ id: Q, title: 'B', visibility: 'everyone', startOn: '2026-12-01' });
    expect(effectiveFieldChoices(survivor, loser, { title: 'loser', visibility: 'loser' })).toEqual({
      title: 'loser',
      startOn: 'survivor',
    });
  });

  it('fills an empty custom field from the loser, and takes the loser’s where chosen (FR-031)', () => {
    const survivor = project({ id: P, customFieldValues: { tier: 'gold', region: '' } });
    const loser = project({ id: Q, customFieldValues: { tier: 'silver', region: 'north', extra: 1 } });
    expect(customFieldDifferences(survivor, loser).map((d) => [d.key, d.default])).toEqual([
      ['extra', 'loser'],
      ['region', 'loser'],
      ['tier', 'survivor'],
    ]);
    expect(resolvedCustomFieldValues(survivor, loser, {})).toEqual({ tier: 'gold', region: 'north', extra: 1 });
    expect(resolvedCustomFieldValues(survivor, loser, { tier: 'loser', extra: 'survivor' })).toEqual({
      tier: 'silver',
      region: 'north',
    });
  });
});
