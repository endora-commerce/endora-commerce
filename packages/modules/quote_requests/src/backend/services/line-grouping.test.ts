import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { groupingShape, planLineGrouping, type StoredLineGroup } from './line-grouping.js';

/**
 * Feature 159, T021 — the pure planner of a grouping write
 * (`specs/159-quote-request-item-groups/contracts/quote-requests-api.md` §1,
 * research R-8, R-14). It decides which groups are kept, renamed, created or
 * deleted, and each body line's group and position; the service writes it.
 */

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

const STORED: StoredLineGroup[] = [
  { id: G1, name: 'Ground floor', position: 0 },
  { id: G2, name: 'First floor', position: 1 },
];

describe('planLineGrouping — a body carrying groups', () => {
  it('upserts by id, creates by key, deletes the stored groups the body does not name', () => {
    const plan = planLineGrouping({
      storedGroups: STORED,
      body: {
        groups: [
          { key: 'n1', name: 'Options' },
          { key: 'g1', id: G1, name: 'Floor 0' },
        ],
        items: [{ groupKey: 'g1' }, { groupKey: 'n1' }, { groupKey: null }],
      },
      pairedRows: [null, null, null],
    });
    expect(plan.groups).toEqual([
      { kind: 'create', key: 'n1', name: 'Options', position: 0 },
      { kind: 'update', id: G1, key: 'g1', name: 'Floor 0', position: 1 },
    ]);
    expect(plan.deleteGroupIds).toEqual([G2]);
    expect(plan.lines).toEqual([
      { group: { kind: 'existing', id: G1 }, position: 0 },
      { group: { kind: 'new', key: 'n1' }, position: 0 },
      { group: null, position: 0 },
    ]);
  });

  it('numbers positions per section in body order', () => {
    const plan = planLineGrouping({
      storedGroups: [],
      body: {
        groups: [
          { key: 'a', name: 'A' },
          { key: 'b', name: 'B' },
        ],
        items: [
          { groupKey: 'a' },
          { groupKey: 'a' },
          { groupKey: 'b' },
          { groupKey: null },
          { groupKey: 'a' },
          {},
        ],
      },
      pairedRows: [null, null, null, null, null, null],
    });
    expect(plan.lines.map((line) => line.position)).toEqual([0, 1, 0, 0, 2, 1]);
  });

  it('keeps an empty group (D2: deleting lines never deletes a group)', () => {
    const plan = planLineGrouping({
      storedGroups: STORED,
      body: { groups: [{ key: 'g2', id: G2, name: 'First floor' }], items: [{ groupKey: null }] },
      pairedRows: [null],
    });
    expect(plan.groups).toEqual([{ kind: 'update', id: G2, key: 'g2', name: 'First floor', position: 0 }]);
    expect(plan.deleteGroupIds).toEqual([G1]);
    expect(plan.after).toEqual([{ lineCount: 0 }]);
  });

  it('refuses an id that is not a group of this quote, at its path, with 422', () => {
    let caught: unknown;
    try {
      planLineGrouping({
        storedGroups: STORED,
        body: { groups: [{ key: 'g1', id: G1, name: 'A' }, { key: 'x', id: FOREIGN, name: 'B' }], items: [{}] },
        pairedRows: [null],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    const error = caught as HttpError;
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([expect.objectContaining({ path: 'groups.1.id' })]);
  });
});

describe('planLineGrouping — a body without groups (research R-14)', () => {
  it('a paired line keeps its stored group; a new line is ungrouped; no group is deleted or changed', () => {
    const plan = planLineGrouping({
      storedGroups: STORED,
      body: { items: [{}, {}, {}, {}] },
      pairedRows: [{ groupId: G2 }, null, { groupId: G2 }, { groupId: null }],
    });
    expect(plan.groups).toEqual([
      { kind: 'keep', id: G1, name: 'Ground floor', position: 0 },
      { kind: 'keep', id: G2, name: 'First floor', position: 1 },
    ]);
    expect(plan.deleteGroupIds).toEqual([]);
    expect(plan.lines).toEqual([
      { group: { kind: 'existing', id: G2 }, position: 0 },
      { group: null, position: 0 },
      { group: { kind: 'existing', id: G2 }, position: 1 },
      { group: null, position: 1 },
    ]);
  });

  it('a paired row naming a group that no longer exists reads as ungrouped', () => {
    const plan = planLineGrouping({ storedGroups: [], body: { items: [{}] }, pairedRows: [{ groupId: G1 }] });
    expect(plan.lines).toEqual([{ group: null, position: 0 }]);
  });
});

describe('the audit shape — line counts, never a group name (D-288)', () => {
  it('after: every resulting group in order with its line count', () => {
    const plan = planLineGrouping({
      storedGroups: STORED,
      body: {
        groups: [
          { key: 'g2', id: G2, name: 'First floor' },
          { key: 'n', name: 'Options' },
        ],
        items: [{ groupKey: 'g2' }, { groupKey: 'g2' }, { groupKey: 'n' }, {}],
      },
      pairedRows: [null, null, null, null],
    });
    expect(plan.after).toEqual([
      { lineCount: 2 },
      { lineCount: 1 },
    ]);
  });

  it('before: the stored groups with their stored lines counted', () => {
    expect(groupingShape(STORED, [G1, G1, null, G2])).toEqual([
      { lineCount: 2 },
      { lineCount: 1 },
    ]);
    expect(groupingShape([], [null])).toEqual([]);
  });
});
