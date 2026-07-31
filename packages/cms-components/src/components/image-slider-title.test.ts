import { describe, expect, it } from 'vitest';
import { imageSliderTitleStyle } from './image-slider-item.js';

describe('imageSliderTitleStyle', () => {
  it('maps title chrome props to CSS', () => {
    expect(
      imageSliderTitleStyle({
        src: '',
        titleBackground: '#112233',
        titleColor: '#ffffff',
        titleBorderWidth: 2,
        titleBorderColor: '#abcdef',
        titleBorderRadius: 'medium',
        titlePaddingPx: 12,
      }),
    ).toMatchObject({
      background: '#112233',
      color: '#ffffff',
      borderWidth: '2px',
      borderColor: '#abcdef',
      padding: '12px',
    });
  });
});
