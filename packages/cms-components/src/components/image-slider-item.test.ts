import { describe, expect, it } from 'vitest';
import { normalizeImageSliderItem, syncImageSliderItemImage } from './image-slider-item.js';

describe('normalizeImageSliderItem', () => {
  it('prefers nested image fields', () => {
    expect(
      normalizeImageSliderItem({
        src: 'old',
        imageSource: 'url',
        image: { imageSource: 'library', src: '', assetId: 'a1' },
      }),
    ).toMatchObject({ imageSource: 'library', assetId: 'a1', src: '' });
  });
});

describe('syncImageSliderItemImage', () => {
  it('copies flat fields into nested image for the editor', () => {
    expect(
      syncImageSliderItemImage({
        imageSource: 'library',
        src: '',
        assetId: 'x',
        title: 'T',
      }),
    ).toEqual({
      imageSource: 'library',
      src: '',
      assetId: 'x',
      title: 'T',
      image: { imageSource: 'library', src: '', assetId: 'x' },
    });
  });
});
