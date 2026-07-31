import { describe, expect, it } from 'vitest';
import { imageUsesCustomWidth, shouldShowImageCustomWidthField } from './image-fields.js';

describe('imageUsesCustomWidth', () => {
  it('is false for auto and full', () => {
    expect(imageUsesCustomWidth('auto')).toBe(false);
    expect(imageUsesCustomWidth('full')).toBe(false);
    expect(imageUsesCustomWidth(undefined)).toBe(false);
  });

  it('is true when any tier is custom', () => {
    expect(imageUsesCustomWidth('custom')).toBe(true);
    expect(imageUsesCustomWidth({ base: 'auto', tablet: 'custom' })).toBe(true);
    expect(imageUsesCustomWidth({ base: 'full', desktop: 'custom' })).toBe(true);
  });
});

describe('shouldShowImageCustomWidthField', () => {
  it('hides the field unless width mode is custom on some tier', () => {
    expect(shouldShowImageCustomWidthField('auto')).toBe(false);
    expect(shouldShowImageCustomWidthField({ base: 'full' })).toBe(false);
    expect(shouldShowImageCustomWidthField('custom')).toBe(true);
  });
});
