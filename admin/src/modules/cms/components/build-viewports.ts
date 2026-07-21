import type { CmsPageBuilderDescriptor } from '@b2b/contracts';

/** Mirrors `@b2b/page-builder-core` DEFAULT_BREAKPOINTS without importing the editor bundle. */
const DEFAULT_BREAKPOINTS = {
  tabletMin: 768,
  desktopMin: 1024,
} as const;

/**
 * Puck preview frame widths. Desktop uses a realistic authoring width (≥1280),
 * not the CSS breakpoint floor (`desktopMin`, typically 1024), so page max-width
 * layouts (~1360px) preview closer to the storefront.
 */
export function buildViewports(descriptor: CmsPageBuilderDescriptor | null) {
  const tabletMin = descriptor?.breakpoints?.tabletMin ?? DEFAULT_BREAKPOINTS.tabletMin;
  const desktopWidth = Math.max(
    descriptor?.breakpoints?.desktopMin ?? DEFAULT_BREAKPOINTS.desktopMin,
    1280,
  );
  return [
    { width: 360, label: 'Mobile', icon: 'Smartphone' as const },
    { width: tabletMin, label: 'Tablet', icon: 'Tablet' as const },
    { width: desktopWidth, label: 'Desktop', icon: 'Monitor' as const },
  ];
}
