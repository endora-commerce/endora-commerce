import { describe, expect, it } from 'vitest';
import { blogEditorProblem } from './editor-validation.js';

const valid = {
  name: 'Guides',
  slug: 'guides',
  salesChannelIds: ['channel-1'],
  languages: ['en-US'],
};

describe('blogEditorProblem', () => {
  it('finds nothing wrong with a named, slugged, scoped entity', () => {
    expect(blogEditorProblem(valid)).toBeNull();
  });

  it('asks for a name, and does not count whitespace as one', () => {
    expect(blogEditorProblem({ ...valid, name: '' })).toBe('validation.nameRequired');
    expect(blogEditorProblem({ ...valid, name: '   ' })).toBe('validation.nameRequired');
  });

  it.each(['', 'Guides', 'two words', '-guides', 'guides-', 'tag', 'a'.repeat(161)])(
    'refuses the slug %j',
    (slug) => {
      expect(blogEditorProblem({ ...valid, slug })).toBe('validation.slugInvalid');
    },
  );

  it.each(['a', 'guides', 'best-cordless-trimmers-2026', 'tags', 'a'.repeat(160)])(
    'accepts the slug %j',
    (slug) => {
      expect(blogEditorProblem({ ...valid, slug })).toBeNull();
    },
  );

  it('asks for a sales channel, then for a language', () => {
    expect(blogEditorProblem({ ...valid, salesChannelIds: [] })).toBe('validation.selectChannel');
    expect(blogEditorProblem({ ...valid, languages: [] })).toBe('validation.selectLanguage');
  });

  it('reports the first problem in the order the panel shows the fields', () => {
    expect(
      blogEditorProblem({ name: '', slug: '', salesChannelIds: [], languages: [] }),
    ).toBe('validation.nameRequired');
    expect(
      blogEditorProblem({ name: 'Guides', slug: '', salesChannelIds: [], languages: [] }),
    ).toBe('validation.slugInvalid');
  });
});
