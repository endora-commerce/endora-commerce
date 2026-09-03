import { describe, expect, it } from 'vitest';
import type { Data } from '@measured/puck';
import {
  getZoneParentComponentType,
  hasInvalidColumnPlacement,
  isRowContentZone,
  resolveContentSliderIdForItem,
  resolveContentSliderSlideIndex,
  shouldRevertPuckAction,
} from './puck-action-guards.js';

const rowId = 'row-1';
const colId = 'col-1';

const data: Data = {
  root: { props: {} },
  content: [
    {
      type: 'cms.Row',
      props: {
        id: rowId,
        content: [{ type: 'cms.Column', props: { id: colId, span: 12, content: [] } }],
      },
    },
  ],
  zones: {
    [`${rowId}:content`]: [{ type: 'cms.Column', props: { id: colId, span: 12, content: [] } }],
  },
};

describe('puck-action-guards', () => {
  it('identifies Row content zones', () => {
    expect(isRowContentZone(`${rowId}:content`, data)).toBe(true);
    expect(isRowContentZone('root:content', data)).toBe(false);
    expect(getZoneParentComponentType('root:content', data)).toBe('root');
    expect(getZoneParentComponentType(`${rowId}:content`, data)).toBe('cms.Row');
  });

  it('blocks Column insert on root', () => {
    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'cms.Column',
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
          componentType: 'cms.Column',
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
          componentType: 'cms.Row',
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
          content: [{ type: 'cms.Column', props: { id: colId, span: 12, content: [] } }],
          zones: {
            'root:content': [{ type: 'cms.Column', props: { id: colId, span: 12, content: [] } }],
          },
        },
        data,
      ),
    ).toBe(true);
  });

  it('blocks non-Slide insert into Content slider slides zone', () => {
    const sliderId = 'slider-1';
    const sliderData: Data = {
      root: { props: {} },
      content: [{ type: 'cms.ContentSlider', props: { id: sliderId, slides: [] } }],
      zones: {
        [`${sliderId}:slides`]: [],
      },
    };

    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'cms.Text',
          destinationIndex: 0,
          destinationZone: `${sliderId}:slides`,
        },
        sliderData,
      ),
    ).toBe(true);

    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'cms.Slide',
          destinationIndex: 0,
          destinationZone: `${sliderId}:slides`,
        },
        sliderData,
      ),
    ).toBe(false);

    expect(
      shouldRevertPuckAction(
        {
          type: 'insert',
          componentType: 'cms.Row',
          destinationIndex: 0,
          destinationZone: `${sliderId}:slides`,
        },
        sliderData,
      ),
    ).toBe(false);
  });

  it('resolves content slider context from nested slide content', () => {
    const sliderId = 'slider-1';
    const slideId = 'slide-1';
    const headingId = 'heading-1';
    const selectors: Record<string, { zone?: string; index: number }> = {
      [slideId]: { zone: `${sliderId}:slides`, index: 1 },
      [headingId]: { zone: `${slideId}:content`, index: 0 },
    };
    const items: Record<string, { type: string; props: Record<string, unknown> }> = {
      [sliderId]: { type: 'cms.ContentSlider', props: { id: sliderId } },
      [slideId]: { type: 'cms.Slide', props: { id: slideId } },
      [headingId]: { type: 'cms.Heading', props: { id: headingId } },
    };
    const getSelectorForId = (id: string) => selectors[id];
    const getItemById = (id: string) => items[id];

    expect(resolveContentSliderIdForItem(headingId, getSelectorForId, getItemById)).toBe(sliderId);
    expect(resolveContentSliderSlideIndex(headingId, sliderId, getSelectorForId, getItemById)).toBe(1);
    expect(resolveContentSliderSlideIndex(slideId, sliderId, getSelectorForId, getItemById)).toBe(1);
  });

  it('detects Column on page root in tree validation', () => {
    expect(
      hasInvalidColumnPlacement({
        root: { props: {} },
        content: [{ type: 'cms.Column', props: { id: colId, span: 12, content: [] } }],
      }),
    ).toBe(true);
    expect(hasInvalidColumnPlacement(data)).toBe(false);
  });
});
