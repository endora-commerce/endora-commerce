import { describe, expect, it } from 'vitest';
import type { NumberingSeries } from '@endora-commerce/contracts';
import {
  findNumberPatternCollisions,
  patternSequenceDefect,
} from './invoice-number-collisions.js';
import { DEFAULT_PATTERNS, effectivePattern } from './invoice-number-generator.js';

/**
 * D-95.1 — a collision is an intersection of *rendered sets*, decided by a
 * probe grid. One test per claim the ruling makes about that definition; the
 * two that matter most are #2 (literal comparison is wrong) and #4 (containing
 * `{channel}` is not a licence).
 */

function series(code: string, pattern: string): NumberingSeries {
  return {
    salesChannelId: `id-${code}`,
    salesChannelCode: code,
    salesChannelName: `Channel ${code}`,
    pattern,
  };
}

const currentYear = new Date().getFullYear();

describe('findNumberPatternCollisions', () => {
  it('reports two channels sharing a pattern without {channel}, with a renderable example', () => {
    const found = findNumberPatternCollisions([
      series('a', 'FV {seq}/{YYYY}'),
      series('b', 'FV {seq}/{YYYY}'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.example).toMatch(/^FV \d+\/\d{4}$/);
    expect(found[0]!.example).toContain(String(currentYear));
  });

  it('reports {seq} against {seq:2} — the padding case literal comparison misses', () => {
    const found = findNumberPatternCollisions([
      series('a', 'FV {seq}/{YYYY}'),
      series('b', 'FV {seq:2}/{YYYY}'),
    ]);
    expect(found).toHaveLength(1);
    const digits = found[0]!.example.match(/FV (\d+)\//)?.[1] ?? '';
    expect(digits.length).toBeGreaterThanOrEqual(2);
  });

  it('does not report two channels sharing one pattern that carries {channel}', () => {
    expect(
      findNumberPatternCollisions([
        series('a', 'FV {seq}/{channel}/{YYYY}'),
        series('b', 'FV {seq}/{channel}/{YYYY}'),
      ]),
    ).toEqual([]);
  });

  it('reports {channel} adjacent to {seq} across codes a1 and a — the separator case', () => {
    const found = findNumberPatternCollisions([
      series('a1', 'FV {channel}{seq}/{YYYY}'),
      series('a', 'FV {channel}{seq}/{YYYY}'),
    ]);
    expect(found).toHaveLength(1);
  });

  it('probes a hard-coded future year but never a past one', () => {
    expect(
      findNumberPatternCollisions([
        series('a', 'FV {seq}/{YYYY}'),
        series('b', `FV {seq}/${currentYear + 1}`),
      ]),
    ).toHaveLength(1);
    expect(
      findNumberPatternCollisions([
        series('a', 'FV {seq}/{YYYY}'),
        series('b', 'INV-2000-{seq}'),
      ]),
    ).toEqual([]);
  });

  it('distinguishes {YY} from {YYYY}, and finds 20{YY} against {YYYY}', () => {
    expect(
      findNumberPatternCollisions([
        series('a', 'FV {seq}/{YY}'),
        series('b', 'FV {seq}/{YYYY}'),
      ]),
    ).toEqual([]);
    expect(
      findNumberPatternCollisions([
        series('a', 'FV {seq}/20{YY}'),
        series('b', 'FV {seq}/{YYYY}'),
      ]),
    ).toHaveLength(1);
  });

  it('is symmetric, and never pairs a series with itself', () => {
    const a = series('a', 'FV {seq}/{YYYY}');
    const b = series('b', 'FV {seq}/{YYYY}');
    expect(findNumberPatternCollisions([a, b])).toHaveLength(1);
    expect(findNumberPatternCollisions([b, a])).toHaveLength(1);
    expect(
      findNumberPatternCollisions([a]).concat(findNumberPatternCollisions([])),
    ).toEqual([]);
  });

  it('completes 50 series inside the budget', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      series(`ch${i}`, 'FV {seq}/{channel}/{YYYY}'),
    );
    const started = performance.now();
    const found = findNumberPatternCollisions(many);
    expect(found).toEqual([]);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('effectivePattern', () => {
  it('reads a blank stored value as the default, not as the empty string', () => {
    expect(effectivePattern('invoice', '   ')).toBe(DEFAULT_PATTERNS.invoice);
    expect(effectivePattern('invoice', null)).toBe(DEFAULT_PATTERNS.invoice);
    // Compared as `''` the two would render one string and collide; compared as
    // the shipped default they carry {channel} and do not.
    expect(
      findNumberPatternCollisions([
        series('a', effectivePattern('invoice', '')),
        series('b', effectivePattern('invoice', null)),
      ]),
    ).toEqual([]);
  });

  it('keeps a non-blank stored value verbatim', () => {
    expect(effectivePattern('invoice', 'INV-{seq}')).toBe('INV-{seq}');
  });
});

describe('patternSequenceDefect', () => {
  it('names a pattern that can never produce a second number', () => {
    expect(patternSequenceDefect('FV/{YYYY}')).toBe('no_sequence_token');
  });

  it('accepts a padded sequence token', () => {
    expect(patternSequenceDefect('FV {seq:3}/{YYYY}')).toBeNull();
  });
});
