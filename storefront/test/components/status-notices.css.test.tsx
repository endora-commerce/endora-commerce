import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CartDroppedLinesBanner } from '../../components/CartDroppedLinesBanner';
import { BelowMinimumSummary } from '../../components/checkout/BelowMinimumSummary';
import { QuoteValidityNotice } from '../../components/checkout/QuoteValidityNotice';

/**
 * Issue #1220 — the status notices must stay readable (WCAG 2.2 SC 1.4.3,
 * 4.5:1) in light and dark mode, for every theme this instance declares.
 *
 * The status tokens (`--warn-100`, `--warn-700`, …) are not re-pointed by
 * `:root.is-dark`, so every notice keeps its light tinted background in dark
 * mode. The warning boxes paired that background with `text-fg` — `--ink-900`,
 * which dark mode re-points at near-white — and read as white on pale amber.
 * They now share `.b2b-auth__warning`, the sibling of `.b2b-auth__success` and
 * `.b2b-auth__error`, whose foreground is the matching status ink.
 *
 * The ratios are computed from the stylesheet's own token values, resolved the
 * way the cascade resolves them: the dark scope, then the theme block, then
 * `:root`.
 */

const root = resolve(__dirname, '../..');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const body = new RegExp(`(?:^|[}\\s/])${escape(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return body;
}

function declared(block: string, name: string): string | undefined {
  return new RegExp(`${escape(name)}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
}

const themeInline = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
const rootBlock = /\n:root\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
const darkBlock = rule(':root.is-dark');
const themeBlocks = [...css.matchAll(/:root\[data-theme='([a-z0-9-]+)'\]\s*\{([^}]*)\}/g)].map(
  ([, code, body]) => ({ code: code!, body: body! }),
);

/** The hex a Tailwind colour utility name (`warn-soft`, `fg`) resolves to in a scope. */
function colourOf(utility: string, scopes: string[]): string {
  const ref = declared(themeInline, `--color-${utility}`);
  const primitive = ref && /^var\((--[a-z0-9-]+)\)$/.exec(ref)?.[1];
  if (!primitive) throw new Error(`no --color-${utility}`);
  for (const scope of [...scopes, rootBlock]) {
    const value = declared(scope, primitive);
    if (value !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${primitive} is not a #rrggbb literal`);
      return value;
    }
  }
  throw new Error(`${primitive} is not declared`);
}

function channel(hex: string, offset: number): number {
  const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const NOTICES = ['.b2b-auth__success', '.b2b-auth__error', '.b2b-auth__warning'] as const;

function pairOf(selector: string): { fg: string; bg: string } {
  const body = rule(selector);
  const fg = /(?:^|\s)text-([a-z-]+)(?=\s|;|$)/.exec(body.replace(/text-\[[^\]]*\]/g, ''))?.[1];
  const bg = /(?:^|\s)bg-([a-z-]+)(?=\s|;|$)/.exec(body)?.[1];
  if (!fg || !bg) throw new Error(`${selector} names no text-/bg- colour`);
  expect(body).not.toMatch(/\sdark:/);
  return { fg, bg };
}

describe('status notices keep 4.5:1 text contrast in every theme and mode (issue #1220)', () => {
  it('declares at least the two themes to measure', () => {
    expect(themeBlocks.map((t) => t.code)).toEqual(expect.arrayContaining(['industria', 'nordic']));
  });

  for (const notice of NOTICES) {
    for (const { code, body } of themeBlocks) {
      for (const [mode, scopes] of [
        ['light', [body]],
        ['dark', [darkBlock, body]],
      ] as const) {
        it(`${notice} — ${code}, ${mode}: text ≥ 4.5:1 on its background`, () => {
          const { fg, bg } = pairOf(notice);
          const ratio = contrast(colourOf(fg, [...scopes]), colourOf(bg, [...scopes]));
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  it('gives a shared link inside a warning notice the notice colour in both modes', () => {
    const body = rule('.b2b-auth__warning .b2b-account__link');
    expect(body).toMatch(/\btext-inherit\b/);
    expect(body).toMatch(/\bdark:text-inherit\b/);
  });
});

/** Every `className="…"` / `'…'` literal in the storefront's own TSX. */
function classLiterals(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.tsx')) {
        const source = readFileSync(join(root, path), 'utf8');
        for (const m of source.matchAll(/["'`]([^"'`\n]*\bbg-warn-soft\b[^"'`\n]*)["'`]/g)) {
          out.push({ file: path, value: m[1]! });
        }
      }
    }
  };
  walk('app');
  walk('components');
  return out;
}

describe('no warning surface pairs the pale amber with a mode-flipping ink (issue #1220)', () => {
  it('finds the amber surfaces it guards', () => {
    expect(classLiterals().length).toBeGreaterThan(0);
  });

  it('never combines bg-warn-soft with text-fg / text-fg-soft / text-muted', () => {
    const offenders = classLiterals().filter(({ value }) => /\btext-(fg|fg-soft|muted|subtle)\b/.test(value));
    expect(offenders).toEqual([]);
  });

  it('uses .b2b-auth__warning for every bordered warning box', () => {
    const boxes = [
      'app/(account)/quick-order/page.tsx',
      'app/(account)/shopping-lists/[id]/page.tsx',
      'components/checkout/QuoteValidityNotice.tsx',
      'components/checkout/BelowMinimumSummary.tsx',
      'components/CartDroppedLinesBanner.tsx',
    ];
    for (const file of boxes) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, file).toContain('b2b-auth__warning');
      expect(source, file).not.toMatch(/border-warn bg-warn-soft/);
    }
  });

  it('renders the checkout and cart warning boxes with the shared class and no flipping ink inside', () => {
    const html = [
      renderToString(<QuoteValidityNotice id="q" refusal="lapsed" locale="en" quoteRequestsPresent />),
      renderToString(
        <BelowMinimumSummary id="m" rows={[{ cartItemId: 'i1', name: 'Brass widget', reasons: ['Min 10'] }]} locale="en" />,
      ),
      renderToString(
        <CartDroppedLinesBanner
          droppedLines={[{ productId: 'p1', productName: 'Steel gear', reason: 'out_of_stock' }]}
          strings={{
            heading: 'Some lines were skipped',
            intro: 'Intro',
            reasonNotPurchasable: 'np',
            reasonOutOfStock: 'oos',
            reasonNoPriceInCustomerList: 'nop',
            reasonRemovedByConversion: 'rbc',
            reasonBelowMinimum: () => 'bm',
          }}
        />,
      ),
    ];
    for (const markup of html) {
      expect(markup).toMatch(/class="b2b-auth__warning\b/);
      // Text inside the box inherits the warning ink; only the button-styled links set their own.
      const plain = markup.replace(/<a [^>]*>/g, '');
      expect(plain).not.toMatch(/\btext-(fg|fg-soft|muted|subtle)\b/);
    }
  });
});
