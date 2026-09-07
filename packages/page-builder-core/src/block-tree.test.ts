// Feature 096, T403 — the shared structural walk.
//
// These are the unit-level statements of `contracts/block-name-migration.md`
// §3.1–§3.3. The database-level acceptance criteria (A1–A12) are asserted
// against real PostgreSQL in `backend/test/integration/cms/block-name-migration.test.ts`;
// what is here is the property the walk has to have before a migration is worth
// running at all.

import { describe, expect, it } from 'vitest';
import { countBlockNames, mapBlockNames, renameBlockNames } from './block-tree.js';

const RENAMES = { Row: 'cms.Row', Column: 'cms.Column', Text: 'cms.Text', Slide: 'cms.Slide' };

describe('renameBlockNames', () => {
  it('renames a node type and leaves every prop byte-identical', () => {
    const doc = {
      root: { props: { title: 'Row of things' } },
      content: [{ type: 'Text', props: { text: 'A Row is a Row', size: 12, on: true } }],
      zones: {},
    };
    const { value, renamed } = renameBlockNames(doc, RENAMES);
    expect(renamed).toBe(1);
    expect(value).toEqual({
      root: { props: { title: 'Row of things' } },
      content: [{ type: 'cms.Text', props: { text: 'A Row is a Row', size: 12, on: true } }],
      zones: {},
    });
  });

  it('renames a slotted child under an arbitrary prop key (A7)', () => {
    // `Column` inside `Row` and `Slide` inside `ContentSlider` are Puck slots:
    // the child array hangs off a prop, not off `content` or `zones`. A walk
    // keyed on those two keys misses most of the CMS tree.
    const doc = {
      content: [
        {
          type: 'Row',
          props: {
            columns: [
              { type: 'Column', props: { span: 6, children: [{ type: 'Text', props: {} }] } },
            ],
          },
        },
      ],
    };
    const { value, renamed } = renameBlockNames(doc, RENAMES);
    expect(renamed).toBe(3);
    const row = (value as { content: Array<Record<string, unknown>> }).content[0]!;
    expect(row.type).toBe('cms.Row');
    const columns = (row.props as { columns: Array<Record<string, unknown>> }).columns;
    expect(columns[0]!.type).toBe('cms.Column');
  });

  it('leaves the text of a prop that happens to contain a block name alone (A6)', () => {
    const doc = { content: [{ type: 'RawHtml', props: { html: '<div>Row Row Row</div>' } }] };
    const { value, renamed } = renameBlockNames(doc, RENAMES);
    expect(renamed).toBe(0);
    expect(value).toEqual(doc);
  });

  it('leaves an unrecognised name byte-identical and renames its siblings (A4)', () => {
    const doc = {
      content: [
        { type: 'NotAKnownBlock', props: { a: 1 } },
        { type: 'Text', props: {} },
      ],
    };
    const { value, renamed } = renameBlockNames(doc, RENAMES);
    expect(renamed).toBe(1);
    expect(value).toEqual({
      content: [
        { type: 'NotAKnownBlock', props: { a: 1 } },
        { type: 'cms.Text', props: {} },
      ],
    });
  });

  it('leaves an already-namespaced name alone, so a second run rewrites nothing (A3, A5)', () => {
    const doc = { content: [{ type: 'Text', props: {} }] };
    const once = renameBlockNames(doc, RENAMES);
    const twice = renameBlockNames(once.value, RENAMES);
    expect(twice.renamed).toBe(0);
    expect(twice.value).toEqual(once.value);
  });

  it('recognises a node with no props sibling', () => {
    // The check requires `props` because its subject is source text, where a
    // field descriptor `{ type: 'text' }` is indistinguishable from a node
    // without it. The migration must not: a legacy row is data, and skipping it
    // is a silent miss.
    const { renamed } = renameBlockNames({ content: [{ type: 'Row' }] }, RENAMES);
    expect(renamed).toBe(1);
  });

  it('walks a bare tree with no envelope (A12)', () => {
    const doc = [{ type: 'Text', props: {} }];
    expect(renameBlockNames(doc, RENAMES).renamed).toBe(1);
  });

  it('walks a per-language envelope, renaming inside every language (A12 inverse)', () => {
    const doc = {
      schema_version: 1,
      languages: {
        'en-US': { content: [{ type: 'Text', props: {} }] },
        'pl-PL': { content: [{ type: 'Row', props: {} }] },
      },
    };
    const { value, renamed } = renameBlockNames(doc, RENAMES);
    expect(renamed).toBe(2);
    expect(value).toHaveProperty('schema_version', 1);
    expect(Object.keys((value as { languages: object }).languages)).toEqual(['en-US', 'pl-PL']);
  });

  it('ignores a non-string type and a type that is not in a node position', () => {
    const doc = { content: [{ type: 42, props: {} }, { props: { type: 'Row' } }] };
    const { renamed } = renameBlockNames(doc, RENAMES);
    // The second one *is* a node position by the contract's own definition — an
    // object with a string `type` — so it is offered and renamed. What is not
    // offered is the number.
    expect(renamed).toBe(1);
  });

  it('preserves key order and array order', () => {
    const doc = { z: 1, content: [{ type: 'Text', b: 2, props: {}, a: 3 }], a: 4 };
    const { value } = renameBlockNames(doc, RENAMES);
    expect(Object.keys(value as object)).toEqual(['z', 'content', 'a']);
    expect(Object.keys((value as { content: object[] }).content[0]!)).toEqual([
      'type',
      'b',
      'props',
      'a',
    ]);
  });

  it('handles null, undefined and primitives without throwing', () => {
    expect(renameBlockNames(null, RENAMES).value).toBeNull();
    expect(renameBlockNames('Row', RENAMES).value).toBe('Row');
    expect(renameBlockNames(7, RENAMES).value).toBe(7);
  });
});

describe('countBlockNames', () => {
  it('counts occurrences per distinct name and writes nothing (A10)', () => {
    const doc = {
      content: [
        { type: 'Text', props: {} },
        { type: 'Text', props: {} },
        { type: 'Mystery', props: {} },
      ],
    };
    const before = JSON.stringify(doc);
    const counts = countBlockNames(doc);
    expect(counts.get('Text')).toBe(2);
    expect(counts.get('Mystery')).toBe(1);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('mapBlockNames', () => {
  it('reports how many node positions it visited, replaced or not', () => {
    const { visited, renamed } = mapBlockNames(
      { content: [{ type: 'A', props: {} }, { type: 'B', props: {} }] },
      (t) => (t === 'A' ? 'x.A' : undefined),
    );
    expect(visited).toBe(2);
    expect(renamed).toBe(1);
  });
});
