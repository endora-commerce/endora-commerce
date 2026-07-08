import { describe, expect, it } from 'vitest';
import {
  colorFieldCommitValue,
  colorFieldDisplayValue,
  colorPickerDisplayHex,
  isTransparentColor,
  parseColorTextInput,
} from './color-field-utils.js';

describe('color-field-utils', () => {
  it('treats empty values as transparent for display and commit', () => {
    expect(colorFieldDisplayValue(undefined)).toBe('');
    expect(colorFieldDisplayValue('')).toBe('');
    expect(colorFieldDisplayValue('transparent')).toBe('');
    expect(colorFieldCommitValue('')).toBeUndefined();
    expect(colorFieldCommitValue('transparent')).toBeUndefined();
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('')).toBe(true);
  });

  it('keeps a preview hex for transparent so the native picker can open', () => {
    expect(colorPickerDisplayHex('')).toBe('#ffffff');
    expect(colorPickerDisplayHex('#ff0000')).toBe('#ff0000');
  });

  it('commits valid hex from text input immediately', () => {
    expect(parseColorTextInput('#1a2b3c')).toEqual({ display: '#1a2b3c', commit: '#1a2b3c' });
    expect(parseColorTextInput('1a2b3c')).toEqual({ display: '#1a2b3c', commit: '#1a2b3c' });
  });

  it('does not commit partial hex while typing', () => {
    expect(parseColorTextInput('#1a2')).toEqual({ display: '#1a2' });
    expect(parseColorTextInput('abc')).toEqual({ display: 'abc' });
  });

  it('commits transparent from empty text input', () => {
    expect(parseColorTextInput('')).toEqual({ display: '', commit: undefined });
    expect(parseColorTextInput('transparent')).toEqual({ display: '', commit: undefined });
  });
});
