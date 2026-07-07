import { describe, expect, it } from 'vitest';
import { migratePuckTreeZonesToSlots } from './migrate-slots.js';

describe('migratePuckTreeZonesToSlots', () => {
  it('migrates Row zone content into props.content', () => {
    const tree = {
      root: { props: {} },
      content: [{ type: 'Row', props: { id: 'Row-1', gap: 8 } }],
      zones: {
        'Row-1:content': [{ type: 'Text', props: { id: 'Text-1', html: 'Hi' } }],
      },
    };

    const out = migratePuckTreeZonesToSlots(tree);
    expect(out.zones).toEqual({});
    const row = out.content?.[0] as { props: { content: unknown[] } };
    expect(row.props.content).toHaveLength(1);
    expect((row.props.content[0] as { type: string }).type).toBe('Text');
  });

  it('migrates Columns zones into props.columnItems', () => {
    const tree = {
      root: { props: {} },
      content: [{ type: 'Columns', props: { id: 'Columns-1', columns: 2 } }],
      zones: {
        'Columns-1:column-0': [{ type: 'Heading', props: { id: 'H-1', text: 'A' } }],
        'Columns-1:column-1': [{ type: 'Heading', props: { id: 'H-2', text: 'B' } }],
      },
    };

    const out = migratePuckTreeZonesToSlots(tree);
    const cols = out.content?.[0] as { props: { columnItems: { content: unknown[] }[] } };
    expect(cols.props.columnItems).toHaveLength(2);
    expect((cols.props.columnItems[0]!.content[0] as { type: string }).type).toBe('Heading');
  });

  it('migrates nested Row inside Row zone', () => {
    const tree = {
      root: { props: {} },
      content: [{ type: 'Row', props: { id: 'Row-outer' } }],
      zones: {
        'Row-outer:content': [{ type: 'Row', props: { id: 'Row-inner' } }],
        'Row-inner:content': [{ type: 'Button', props: { id: 'Btn-1', label: 'Go' } }],
      },
    };

    const out = migratePuckTreeZonesToSlots(tree);
    const outer = out.content?.[0] as { props: { content: { props: { content: unknown[] } }[] } };
    const inner = outer.props.content[0]!;
    expect(inner.props.content).toHaveLength(1);
  });

  it('is idempotent when zones are empty', () => {
    const tree = {
      root: { props: {} },
      content: [{ type: 'Row', props: { id: 'Row-1', content: [] } }],
      zones: {},
    };
    expect(migratePuckTreeZonesToSlots(tree)).toEqual(tree);
  });
});
