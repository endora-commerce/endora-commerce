import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';

/** Mirrors `@endora-commerce/page-builder-core` DEFAULT_BREAKPOINTS without importing the editor bundle. */
const DEFAULT_BREAKPOINTS = {
  tabletMin: 768,
  desktopMin: 1024,
} as const;

/**
 * Puck preview frame widths. Desktop uses a realistic authoring width (≥1280),
 * not the CSS breakpoint floor (`desktopMin`, typically 1024), so page max-width
 * layouts (~1360px) preview closer to the storefront.
 *
 * Tablet is nudged above `tabletMin` so iframe `@media (min-width: tabletMin)`
 * still matches when a scrollbar reduces the media viewport by a few pixels.
 */
export function buildViewports(descriptor: CmsPageBuilderDescriptor | null) {
  const tabletMin = descriptor?.breakpoints?.tabletMin ?? DEFAULT_BREAKPOINTS.tabletMin;
  const desktopWidth = Math.max(
    descriptor?.breakpoints?.desktopMin ?? DEFAULT_BREAKPOINTS.desktopMin,
    1280,
  );
  return [
    { width: 360, label: 'Mobile', icon: 'Smartphone' as const },
    { width: tabletMin + 32, label: 'Tablet', icon: 'Tablet' as const },
    { width: desktopWidth, label: 'Desktop', icon: 'Monitor' as const },
  ];
}
