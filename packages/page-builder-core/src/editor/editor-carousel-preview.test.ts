import { describe, expect, it } from 'vitest';
import { getEditorCarouselPageFromUi, readEditorCarouselPages } from './editor-carousel-preview-ui.js';

describe('editor-carousel-preview-ui', () => {
  it('reads carousel pages from Puck ui state', () => {
    const ui = { carouselPreviewPages: { 'slider-a': 2, 'slider-b': 0 } };
    expect(readEditorCarouselPages(ui)).toEqual({ 'slider-a': 2, 'slider-b': 0 });
    expect(getEditorCarouselPageFromUi(ui, 'slider-a')).toBe(2);
    expect(getEditorCarouselPageFromUi(ui, 'missing')).toBe(0);
  });
});
