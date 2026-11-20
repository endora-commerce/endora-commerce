import { describe, expect, it } from 'vitest';
import { createCmsBlockRequestSchema, createCmsPageRequestSchema } from '@endora-commerce/contracts';
import {
  CMS_COPY_LIMIT,
  copyCandidate,
  copyName,
  copyPrefix,
  pickCopyNumber,
} from './copy-naming.js';

/**
 * Issue #1495 (DEC-17) — the name, slug and code of a duplicated CMS page,
 * block or template. The suffix sequence is catalog's (`-copy`, `-copy-2`, …),
 * so an operator who has duplicated a product recognises it (Jakob's law).
 */

const slugShape = createCmsPageRequestSchema.shape.slug;
const codeShape = createCmsBlockRequestSchema.shape.code;

describe('copyCandidate', () => {
  it('appends -copy, then -copy-2, -copy-3, …', () => {
    expect(copyCandidate('about', 1)).toBe('about-copy');
    expect(copyCandidate('about', 2)).toBe('about-copy-2');
    expect(copyCandidate('about', 3)).toBe('about-copy-3');
    expect(copyCandidate('about', CMS_COPY_LIMIT)).toBe(`about-copy-${CMS_COPY_LIMIT}`);
  });

  it('appends again to a copy, rather than guessing at an existing suffix', () => {
    expect(copyCandidate('about-copy', 1)).toBe('about-copy-copy');
    expect(copyCandidate('about-copy-2', 1)).toBe('about-copy-2-copy');
  });

  it('cuts the base, never the suffix, to stay within 180 characters', () => {
    const long = 'a'.repeat(180);
    expect(copyCandidate(long, 1)).toBe(`${'a'.repeat(175)}-copy`);
    expect(copyCandidate(long, 12)).toBe(`${'a'.repeat(172)}-copy-12`);
    expect(copyCandidate(long, 12)).toHaveLength(180);
  });

  it('trims a separator the cut leaves at the end of the base', () => {
    const base = `${'a'.repeat(173)}-/._bcdef`;
    expect(copyCandidate(base, 1)).toBe(`${'a'.repeat(173)}-copy`);
  });

  it('keeps every candidate a valid slug and a valid code', () => {
    const numbers = [1, 2, 99, CMS_COPY_LIMIT];
    const slugs = ['about', 'a', 'pomoc/dostawa', `${'b'.repeat(172)}/_-x`, `${'c'.repeat(179)}9`];
    const codes = ['hero', 'ab', 'footer.note', `${'b'.repeat(172)}._-x`, `${'c'.repeat(179)}9`];
    for (const base of slugs) {
      for (const n of numbers) expect(slugShape.safeParse(copyCandidate(base, n)).success, base).toBe(true);
    }
    for (const base of codes) {
      for (const n of numbers) expect(codeShape.safeParse(copyCandidate(base, n)).success, base).toBe(true);
    }
  });
});

describe('copyPrefix', () => {
  it('is a prefix of every candidate the sequence can produce', () => {
    for (const base of ['about', 'a'.repeat(180), `${'a'.repeat(169)}--x`]) {
      const prefix = copyPrefix(base);
      for (const n of [1, 2, 10, CMS_COPY_LIMIT]) expect(copyCandidate(base, n).startsWith(prefix)).toBe(true);
    }
  });
});

describe('pickCopyNumber', () => {
  it('chooses 1 when nothing is taken', () => {
    expect(pickCopyNumber(['about'], new Set())).toBe(1);
  });

  it('chooses the lowest free number', () => {
    expect(pickCopyNumber(['about'], new Set(['about-copy']))).toBe(2);
    expect(pickCopyNumber(['about'], new Set(['about-copy', 'about-copy-2', 'about-copy-4']))).toBe(3);
    expect(pickCopyNumber(['about'], new Set(['about-copy-2']))).toBe(1);
  });

  it('uses one number for the page slug and every language slug', () => {
    // `o-nas-copy` is free, but `about-copy` is not: both move to -copy-2.
    expect(pickCopyNumber(['about', 'o-nas'], new Set(['about-copy']))).toBe(2);
    expect(pickCopyNumber(['about', 'o-nas'], new Set(['about-copy', 'o-nas-copy-2']))).toBe(3);
  });

  it('answers the same number for the same taken set', () => {
    const taken = new Set(['about-copy', 'about-copy-3']);
    expect(pickCopyNumber(['about'], taken)).toBe(pickCopyNumber(['about'], new Set(taken)));
  });

  it('answers null once the range is used up', () => {
    const taken = new Set(Array.from({ length: CMS_COPY_LIMIT }, (_, i) => copyCandidate('about', i + 1)));
    expect(pickCopyNumber(['about'], taken)).toBeNull();
  });
});

describe('copyName', () => {
  it('takes the requested name when there is one', () => {
    expect(copyName('About us', 'O nas (kopia)')).toBe('O nas (kopia)');
  });

  it('suffixes the source name otherwise, within 200 characters', () => {
    expect(copyName('About us')).toBe('About us (copy)');
    expect(copyName('x'.repeat(200))).toHaveLength(200);
  });
});
