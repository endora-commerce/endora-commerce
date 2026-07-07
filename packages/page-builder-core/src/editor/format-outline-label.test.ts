import { describe, expect, it } from 'vitest';
import { formatOutlineLabel } from './format-outline-label.js';

describe('formatOutlineLabel', () => {
  it('shows type label when name is empty', () => {
    expect(formatOutlineLabel('Row', {}, 'Row')).toBe('Row');
  });

  it('appends editor name when set', () => {
    expect(formatOutlineLabel('Row', { editorName: 'Hero' }, 'Row')).toBe('Row - Hero');
  });

  it('trims editor name', () => {
    expect(formatOutlineLabel('Row', { editorName: '  Hero  ' }, 'Row')).toBe('Row - Hero');
  });
});
