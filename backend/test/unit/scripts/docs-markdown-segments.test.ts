import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hashSourceBody,
  restoreSegmentMarkdown,
  segmentMarkdown,
  splitFrontMatter,
} from '../../../scripts/lib/docs-markdown-segments.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';

const repoRoot = findRepoRoot(import.meta.dirname) ?? (() => {
  throw new Error('repository root not found');
})();

function fixture(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('docs-markdown-segments', () => {
  it('splits leading front matter and preamble before it', () => {
    const source = fixture('docs/docs/module-reference/catalog.md');
    const split = splitFrontMatter(source);
    expect(split.prefix).toContain('<!-- AUTO-GENERATED');
    expect(split.prefix).toContain('sidebar_label: Reference');
    expect(split.body.trimStart().startsWith('# `catalog`')).toBe(true);
  });

  it('hashes only the normalised body with front matter stripped', () => {
    const source = fixture('docs/docs/architecture/command-bus.md');
    const withEditedTitle = source.replace(
      'title: Command Bus (Uniform Write Auditing & Undo)',
      'title: Different title',
    );
    expect(hashSourceBody(source)).toBe(hashSourceBody(withEditedTitle));
  });

  it('round-trips architecture prose with byte-identical literals preserved', () => {
    const source = fixture('docs/docs/architecture/command-bus.md');
    const segmented = segmentMarkdown(source);
    expect(segmented.segments.some((segment) => segment.includes('CommandBus'))).toBe(false);
    expect(segmented.placeholderBody).toContain('```ts');
    expect(segmented.placeholderBody).toContain('commandBus.run(command)');
    expect(segmented.placeholderBody).toContain('`CommandBus`');

    const restored = restoreSegmentMarkdown(segmented, segmented.segments);
    expect(restored).toBe(source);
  });

  it('round-trips module reference template without translating code literals', () => {
    const source = fixture('docs/docs/module-reference/catalog.md');
    const segmented = segmentMarkdown(source);
    expect(segmented.placeholderBody).toContain('`catalog`');
    expect(segmented.placeholderBody).toContain('`catalog:write`');
    expect(segmented.segments.some((segment) => segment.includes('catalog:write'))).toBe(false);

    const restored = restoreSegmentMarkdown(segmented, segmented.segments);
    expect(restored).toBe(source);
  });

  it('leaves inline code and link destinations untouched while segmenting link labels', () => {
    const source = [
      '---',
      'title: Links',
      '---',
      '',
      'See [`catalog`](../modules/catalog.md) and run `pnpm --filter backend run composer:generate`.',
      '',
      '```bash',
      'pnpm --filter backend run composer:generate',
      '```',
      '',
    ].join('\n');

    const segmented = segmentMarkdown(source);
    expect(segmented.placeholderBody).toContain('[`catalog`]');
    expect(segmented.placeholderBody).toContain('../modules/catalog.md');
    expect(segmented.placeholderBody).toContain('`pnpm --filter backend run composer:generate`');
    expect(segmented.segments.join(' ')).toContain('See');

    const restored = restoreSegmentMarkdown(segmented, segmented.segments);
    expect(restored).toBe(source);
  });
});
