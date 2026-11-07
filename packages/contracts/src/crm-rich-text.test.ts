import { describe, expect, it } from 'vitest';
import {
  formatOpportunityRichText,
  opportunityRichTextToPlain,
  parseOpportunityRichText,
  type OpportunityRichBlock,
} from './crm-rich-text.js';

// This package's tests are typed against no runtime, so the high-resolution
// clock is reached through `globalThis` rather than named.
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();

/**
 * Issue #612: the cost is compared across sizes, not against a clock — a
 * wall-clock budget measures the host as much as the code. `run` is timed once
 * on an input of `length` against {@link GROWTH} calls on inputs
 * {@link GROWTH} times shorter, each side the fastest of five timings after a
 * warm-up, every call on an input of its own built outside the timed region.
 * Linear code does the same work on both sides, so the ratio is about 1 however
 * busy the host is; a quadratic path makes it about {@link GROWTH}.
 */
const GROWTH = 16;
/** Four times above linear, four times below what a quadratic path gives. */
const LINEAR_BOUND = 4;
function growthRatio<T>(run: (input: T) => unknown, input: (length: number) => T, length: number): number {
  const fastest = (inputs: () => T[]): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 5; sample += 1) {
      const batch = inputs();
      const start = now();
      for (const value of batch) run(value);
      const elapsed = now() - start;
      if (sample > 0) best = Math.min(best, elapsed);
    }
    return best;
  };
  const once = fastest(() => [input(length)]);
  const many = fastest(() => Array.from({ length: GROWTH }, () => input(Math.ceil(length / GROWTH))));
  return once / many;
}

/**
 * `specs/158-crm-opportunity-inline-editing/` — the formatted-text grammar of a
 * description, a note, a message and an Event's description: what is stored is
 * still a string carrying `[[type:id]]` tokens, with a small Markdown subset on
 * top of it.
 */

const ORDER = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const PERSON = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';

const text = (value: string, marks: Array<'bold' | 'italic' | 'strike'> = [], href?: string) => ({
  kind: 'text' as const,
  text: value,
  marks,
  ...(href ? { href } : {}),
});

function roundTrip(blocks: OpportunityRichBlock[]): OpportunityRichBlock[] {
  return parseOpportunityRichText(formatOpportunityRichText(blocks));
}

describe('parseOpportunityRichText', () => {
  it('reads plain text written before formatting existed as one paragraph per line', () => {
    expect(parseOpportunityRichText('First line\n\nThird line')).toEqual([
      { kind: 'paragraph', content: [text('First line')] },
      { kind: 'paragraph', content: [] },
      { kind: 'paragraph', content: [text('Third line')] },
    ]);
  });

  it('reads the empty string as no blocks at all', () => {
    expect(parseOpportunityRichText('')).toEqual([]);
  });

  it('reads bold, italic, strikethrough and their nesting', () => {
    expect(parseOpportunityRichText('a **b _c_** ~~d~~')).toEqual([
      {
        kind: 'paragraph',
        content: [
          text('a '),
          text('b ', ['bold']),
          text('c', ['bold', 'italic']),
          text(' '),
          text('d', ['strike']),
        ],
      },
    ]);
  });

  it('keeps an unclosed marker as the characters it is', () => {
    expect(parseOpportunityRichText('2 ** 3 and ~~ alone')).toEqual([
      { kind: 'paragraph', content: [text('2 ** 3 and ~~ alone')] },
    ]);
  });

  it('does not read an underscore inside a word as italic — SKUs and snake_case stay as typed', () => {
    expect(parseOpportunityRichText('SKU ABC_123_X and snake_case_name')).toEqual([
      { kind: 'paragraph', content: [text('SKU ABC_123_X and snake_case_name')] },
    ]);
  });

  it('reads a reference token as a reference, inside formatting too', () => {
    expect(parseOpportunityRichText(`See **[[order:${ORDER}]]** for [[admin_user:${PERSON}]]`)).toEqual([
      {
        kind: 'paragraph',
        content: [
          text('See '),
          { kind: 'reference', type: 'order', id: ORDER, marks: ['bold'] },
          text(' for '),
          { kind: 'reference', type: 'admin_user', id: PERSON, marks: [] },
        ],
      },
    ]);
  });

  it('reads a link with a safe address, and leaves any other one as text', () => {
    expect(parseOpportunityRichText('[the **offer**](https://example.com/a?b=1) and [x](javascript:alert(1))')).toEqual([
      {
        kind: 'paragraph',
        content: [
          text('the ', [], 'https://example.com/a?b=1'),
          text('offer', ['bold'], 'https://example.com/a?b=1'),
          text(' and [x](javascript:alert(1))'),
        ],
      },
    ]);
  });

  it('reads consecutive list lines as one list, and a number restarts nothing', () => {
    expect(parseOpportunityRichText('Intro\n- one\n- **two**\n3. first\n4. second')).toEqual([
      { kind: 'paragraph', content: [text('Intro')] },
      { kind: 'bullet_list', items: [[text('one')], [text('two', ['bold'])]] },
      { kind: 'ordered_list', start: 3, items: [[text('first')], [text('second')]] },
    ]);
  });

  it('reads a backslash before a marker as that marker, and before anything else as a backslash', () => {
    expect(parseOpportunityRichText('\\*\\*not bold\\*\\* C:\\path')).toEqual([
      { kind: 'paragraph', content: [text('**not bold** C:\\path')] },
    ]);
  });

  it('reads an escaped list marker at the start of a line as a paragraph', () => {
    expect(parseOpportunityRichText('\\- not a list\n12\\. not either')).toEqual([
      { kind: 'paragraph', content: [text('- not a list')] },
      { kind: 'paragraph', content: [text('12. not either')] },
    ]);
  });
});

describe('formatOpportunityRichText', () => {
  it('writes plain paragraphs as the plain text they always were', () => {
    expect(
      formatOpportunityRichText([
        { kind: 'paragraph', content: [text('Hello')] },
        { kind: 'paragraph', content: [] },
        { kind: 'paragraph', content: [text('World')] },
      ]),
    ).toBe('Hello\n\nWorld');
  });

  it('escapes the characters that would otherwise be read as formatting', () => {
    const written = formatOpportunityRichText([
      { kind: 'paragraph', content: [text('- 2*3 [a] ~~b~~ c\\d _e_')] },
      { kind: 'paragraph', content: [text('7. seven')] },
    ]);
    expect(parseOpportunityRichText(written)).toEqual([
      { kind: 'paragraph', content: [text('- 2*3 [a] ~~b~~ c\\d _e_')] },
      { kind: 'paragraph', content: [text('7. seven')] },
    ]);
  });

  it('round-trips every construct', () => {
    const blocks: OpportunityRichBlock[] = [
      {
        kind: 'paragraph',
        content: [
          text('plain '),
          text('bold', ['bold']),
          text(' '),
          text('both', ['bold', 'italic']),
          text(' gone', ['strike']),
          text(' '),
          { kind: 'reference', type: 'order', id: ORDER, marks: ['italic'] },
          text(' '),
          text('site', ['bold'], 'https://example.com'),
          text(' end', [], 'https://example.com'),
        ],
      },
      { kind: 'bullet_list', items: [[text('a')], [text('b', ['strike'])]] },
      { kind: 'ordered_list', start: 1, items: [[text('x')]] },
      { kind: 'paragraph', content: [text('after')] },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('joins two adjacent lists of the same kind — the text has no way to keep them apart', () => {
    expect(
      roundTrip([
        { kind: 'bullet_list', items: [[text('a')]] },
        { kind: 'bullet_list', items: [[text('b')]] },
      ]),
    ).toEqual([{ kind: 'bullet_list', items: [[text('a')], [text('b')]] }]);
  });

  it('is stable: writing what was read gives back the same text', () => {
    const stored = `**Deal** for [[order:${ORDER}]]\n- _one_\n- ~~two~~\n\n[link](https://example.com)`;
    expect(formatOpportunityRichText(parseOpportunityRichText(stored))).toBe(stored);
  });
});

describe('opportunityRichTextToPlain', () => {
  it('drops the markers and keeps the tokens, the list markers and the link addresses', () => {
    expect(
      opportunityRichTextToPlain(`**Hi** _there_ [[order:${ORDER}]]\n- a\n2. b\n[site](https://example.com)`),
    ).toBe(`Hi there [[order:${ORDER}]]\n- a\n2. b\nsite (https://example.com)`);
  });
});

describe('reading stays linear', () => {
  it('reads a line of unclosed markers and brackets in time proportional to it', () => {
    const shape = (size: number) => '[a _b '.repeat(size / 6);
    const line = shape(48_000);
    const blocks = parseOpportunityRichText(line);
    expect(formatOpportunityRichText(blocks)).not.toBe('');
    expect(opportunityRichTextToPlain(line)).toBe(line);
    const ratio = growthRatio(parseOpportunityRichText, shape, 48_000);
    expect(ratio, `${GROWTH}× the line, ${ratio.toFixed(2)}× the time`).toBeLessThan(LINEAR_BOUND);
  });
});
