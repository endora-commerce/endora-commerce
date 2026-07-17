export type EditorCarouselPreviewUi = {
  carouselPreviewPages?: Record<string, number>;
};

export function readEditorCarouselPages(
  ui: EditorCarouselPreviewUi | undefined,
): Record<string, number> {
  return ui?.carouselPreviewPages ?? {};
}

export function getEditorCarouselPageFromUi(
  ui: EditorCarouselPreviewUi | undefined,
  carouselId: string,
): number {
  return readEditorCarouselPages(ui)[carouselId] ?? 0;
}

export function carouselEditorPageCount(slideCount: number, slidesPerView: number): number {
  const perView = Math.max(1, Math.round(slidesPerView));
  return Math.max(1, Math.ceil(Math.max(0, slideCount) / perView));
}
