import { useEffect, useState } from 'react';

/** The colours a chart draws with, taken from the design system's tokens. */
export interface ChartColors {
  /** Category labels. */
  text: string;
  /** Value-axis labels and names. */
  muted: string;
  /** Axis and split lines. */
  line: string;
  /** A bar that has no colour of its own. */
  bar: string;
}

const FALLBACK: ChartColors = { text: '#1a1c1f', muted: '#5c6370', line: '#e4e5e7', bar: '#4f46e5' };

/**
 * A token of the theme as a colour a canvas takes. The tokens are HSL triplets
 * (`220 7% 11%`) meant for `hsl(var(--token))`; a canvas knows nothing of
 * custom properties, so the triplet is read off the root and spelled out.
 */
function token(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  const parts = value.split(/[\s,]+/).filter(Boolean);
  return parts.length === 3 ? `hsl(${parts.join(', ')})` : fallback;
}

function readChartColors(): ChartColors {
  if (typeof document === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  return {
    text: token(style, '--foreground', FALLBACK.text),
    muted: token(style, '--muted-foreground', FALLBACK.muted),
    line: token(style, '--border', FALLBACK.line),
    bar: token(style, '--primary', FALLBACK.bar),
  };
}

/**
 * The chart colours of the theme on screen, read again when the theme class
 * on the root changes — a chart is a canvas and does not restyle itself.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(readChartColors);
  useEffect(() => {
    setColors(readChartColors());
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setColors(readChartColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return (): void => observer.disconnect();
  }, []);
  return colors;
}

/** Whether the operator has asked for less motion; a chart then draws without animating. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
