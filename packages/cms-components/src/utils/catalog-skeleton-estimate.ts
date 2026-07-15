export function countConfiguredSlugs(slugs: string[] | undefined): number {
  if (!slugs?.length) return 0;
  return slugs.map((slug) => slug.trim()).filter(Boolean).length;
}

/** Placeholder count before catalog data resolves — prefer known manual selections. */
export function estimateCategoryGridSkeletonCount(
  selectionMode: string,
  categorySlugs: string[] | undefined,
  columns: number,
): number {
  const cols = Math.max(1, columns);
  if (selectionMode === 'manual') {
    const manual = countConfiguredSlugs(categorySlugs);
    if (manual > 0) return manual;
  }
  return cols;
}

export function estimateCategoryListSkeletonCount(
  selectionMode: string,
  categorySlugs: string[] | undefined,
): number {
  if (selectionMode === 'manual') {
    const manual = countConfiguredSlugs(categorySlugs);
    if (manual > 0) return manual;
  }
  return 5;
}

export function estimateProductGridSkeletonCount(
  source: string,
  productSlugs: string[] | undefined,
  limit: number,
  columns: number,
): number {
  const cols = Math.max(1, columns);
  if (source === 'manual') {
    const manual = countConfiguredSlugs(productSlugs);
    if (manual > 0) return Math.min(manual, limit);
  }
  return Math.min(cols, limit);
}

export function estimateProductSliderSkeletonCount(
  source: string,
  productSlugs: string[] | undefined,
  limit: number,
  slidesPerView: number,
): number {
  const perView = Math.max(1, slidesPerView);
  if (source === 'manual') {
    const manual = countConfiguredSlugs(productSlugs);
    if (manual > 0) return Math.min(manual, limit);
  }
  return Math.min(Math.max(perView + 1, perView), limit);
}
