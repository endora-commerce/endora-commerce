import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clampColumnCount } from './styles.js';

describe('clampColumnCount', () => {
  it('clamps to 1–12', () => {
    expect(clampColumnCount(0)).toBe(1);
    expect(clampColumnCount(20)).toBe(12);
    expect(clampColumnCount(4.6)).toBe(5);
  });
});

/**
 * Feature 169 (T111) — `cms.ContactForm`'s stylesheet: three field looks from the colour
 * scheme's tokens (each with today's literal as its fallback), two columns from the tablet
 * breakpoint up, an off-screen honeypot and a visible focus ring.
 */
describe('cms.ContactForm stylesheet (feature 169)', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');

  /** The declarations of the first rule whose selector list is exactly `selector`. */
  function rule(selector: string): string {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)).trim();
  }

  it('draws the boxed look from the scheme tokens with literal fallbacks', () => {
    const control = rule('.cmsc-pb-contact-form__control');
    expect(control).toContain('border: 1px solid var(--cmsb-border, #d9e0e7)');
    expect(control).toContain('color: var(--cmsb-fg, #15202b)');
    expect(control).toContain('background: var(--cmsb-bg, #fff)');
  });

  it('draws the underline look as a bottom border only', () => {
    const underline = rule('.cmsc-pb-contact-form--look-underline .cmsc-pb-contact-form__control');
    expect(underline).toContain('border-width: 0 0 1px');
    expect(underline).toContain('border-radius: 0');
  });

  it('draws the pill look round, the message box at 16 px', () => {
    expect(rule('.cmsc-pb-contact-form--look-pill .cmsc-pb-contact-form__control')).toContain('border-radius: 999px');
    expect(rule('.cmsc-pb-contact-form--look-pill textarea.cmsc-pb-contact-form__control')).toContain('border-radius: 16px');
  });

  it('lays two columns out from the tablet breakpoint up, one below it', () => {
    expect(rule('.cmsc-pb-contact-form__fields')).toContain('grid-template-columns: minmax(0, 1fr)');
    const tablet = css.indexOf('@media (min-width: 768px) { .cmsc-pb-contact-form--cols-2 .cmsc-pb-contact-form__fields {');
    expect(tablet).toBeGreaterThanOrEqual(0);
    expect(css.slice(tablet, css.indexOf('}', tablet))).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(rule('.cmsc-pb-contact-form__field--full')).toContain('grid-column: 1 / -1');
  });

  it('keeps the honeypot off-screen', () => {
    const trap = rule('.cmsc-pb-contact-form__hp');
    expect(trap).toContain('position: absolute');
    expect(trap).toContain('left: -10000px');
  });

  it('shows a focus ring on every control', () => {
    expect(rule('.cmsc-pb-contact-form__control:focus-visible')).toContain('outline: 2px solid var(--cmsb-color-primary, #1261a6)');
  });
});

