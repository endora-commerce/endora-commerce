import { describe, expect, it } from 'vitest';
import { buildViewports } from '../../../../packages/modules/cms/src/admin/components/build-viewports';

describe('buildViewports', () => {
  it('uses breakpoint tablet min (+ scrollbar nudge) and a desktop width of at least 1280', () => {
    const viewports = buildViewports(null);
    expect(viewports).toEqual([
      { width: 360, label: 'Mobile', icon: 'Smartphone' },
      { width: 800, label: 'Tablet', icon: 'Tablet' },
      { width: 1280, label: 'Desktop', icon: 'Monitor' },
    ]);
  });

  it('respects descriptor breakpoints while keeping desktop ≥ 1280', () => {
    const viewports = buildViewports({
      breakpoints: { tabletMin: 800, desktopMin: 1100 },
    } as Parameters<typeof buildViewports>[0]);
    expect(viewports[1]?.width).toBe(832);
    expect(viewports[2]?.width).toBe(1280);
  });
});