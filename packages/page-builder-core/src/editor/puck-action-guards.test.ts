import { describe, expect, it } from 'vitest';
import type { Data } from '@measured/puck';
import {
  getZoneParentComponentType,
  hasInvalidColumnPlacement,
  isRowContentZone,
  shouldRevertPuckAction,
} from './puck-action-guards.js';

const rowId = 'row-1';
const colId = 'col-1';

const data: Data = {
  root: { props: {} },
  content: [
    {
      type: 'Row',
      props: {
        id: rowId,
        content: [{ type: 'Column', props: { id: colId, span: 12, content: [] } }],
      },
    },
  ],
  zones: {
    [`${rowId}:content`]: [{ type: 'Column', props: { id: colId, span: 12, content: [] } }],
  },
};

describe('puck-action-guards', () => {
  it('identifies Row content zones', () => {
    expect(isRowContentZone(`${rowId}:content`, data)).toBe(true);
    expect(isRowContentZone('root:content', data)).toBe(false);
    expect(getZoneParentComponentType('root:content', data)).toBe('root');
    expect(getZoneParentComponentType(`${rowId}:content`, data)).toBe('Row');
  });

  it('blocks Column insert on root', () => {
    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'Column',
          destinationIndex: 0,
          destinationZone: 'root:content',
        },
        data,
      ),
    ).toBe(true);
  });

  it('allows Column insert into Row', () => {
    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'Column',
          destinationIndex: 1,
          destinationZone: `${rowId}:content`,
        },
        data,
      ),
    ).toBe(false);
  });

  it('allows Row insert into Column', () => {
    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'Row',
          destinationIndex: 0,
          destinationZone: `${colId}:content`,
        },
        data,
      ),
    ).toBe(false);
  });

  it('blocks Column move to root', () => {
    expect(
      shouldRevertPuckAction(
        {
          type: 'move',
          sourceZone: `${rowId}:content`,
          sourceIndex: 0,
          destinationZone: 'root:content',
          destinationIndex: 0,
        },
        {
          ...data,
          content: [{ type: 'Column', props: { id: colId, span: 12, content: [] } }],
          zones: {
            'root:content': [{ type: 'Column', props: { id: colId, span: 12, content: [] } }],
          },
        },
        data,
      ),
    ).toBe(true);
  });

  it('detects Column on page root in tree validation', () => {
    expect(
      hasInvalidColumnPlacement({
        root: { props: {} },
        content: [{ type: 'Column', props: { id: colId, span: 12, content: [] } }],
      }),
    ).toBe(true);
    expect(hasInvalidColumnPlacement(data)).toBe(false);
  });
});
