import { describe, expect, it } from 'vitest';
import { extractRootContent } from './outline-data.js';

describe('extractRootContent', () => {
  it('reads content array from puck data', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [{ type: 'Row', props: { id: 'r1' } }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('Row');
  });

  it('reads legacy root zones', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [],
      zones: { 'root:default-zone': [{ type: 'Text', props: { id: 't1' } }] },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('Text');
  });

  it('normalizes flat puck items without props wrapper', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [{ type: 'Row', id: 'r1', gap: 8 }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('Row');
    expect(items[0]?.props.id).toBe('r1');
  });

  it('returns empty array for invalid shapes', () => {
    expect(extractRootContent(null)).toEqual([]);
    expect(extractRootContent({ content: 'nope' })).toEqual([]);
    expect(extractRootContent({ content: { type: 'Row', props: { id: 'x' } } })).toEqual([]);
  });
});
