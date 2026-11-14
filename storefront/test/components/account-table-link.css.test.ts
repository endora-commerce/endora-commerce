import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ModalDialog } from '../../components/ModalDialog';

/**
 * Issue #1178 — a link in an account table looked like the cell's text: the
 * storefront's base reset gives every `<a>` the inherited colour and no
 * underline. `.b2b-account__link` is the one class every such link carries:
 * underlined and in the accent colour (never colour alone), re-pointed at the
 * light brand tint in dark mode, where `--brand-700` is 2.77:1 on the dark
 * surface; with a visible focus ring; and grown to the 44px touch floor inside
 * a table cell without growing the row (Fitts's Law).
 *
 * `ModalDialog`'s default trigger — the other inline action of these tables —
 * composes the same class rather than repeating its look (Law of Similarity),
 * which is also what gives it the dark-mode colour it lacked.
 */

const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return body;
}

describe('.b2b-account__link (issue #1178)', () => {
  it('is underlined in the accent colour, by the semantic tokens only', () => {
    const link = rule('.b2b-account__link');
    expect(link).toMatch(/\bunderline\b/);
    expect(link).toMatch(/\btext-accent\b/);
    expect(link).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('keeps 4.5:1 in dark mode through the light brand tint', () => {
    expect(rule('.b2b-account__link')).toMatch(/dark:text-\[color:var\(--brand-200\)\]/);
  });

  it('shows hover without a colour change and focus with the storefront ring', () => {
    expect(rule('.b2b-account__link:hover')).toMatch(/decoration-2/);
    expect(rule('.b2b-account__link:focus-visible')).toMatch(/outline-\[color:var\(--brand-600\)\]/);
  });

  it('meets the 44px floor inside an account table cell without growing the row', () => {
    const inCell = rule('.b2b-account__table .b2b-account__link');
    expect(inCell).toMatch(/\bmin-h-11\b/);
    expect(inCell).toMatch(/\bmin-w-11\b/);
    expect(inCell).toMatch(/-my-\[10px\]/);
  });

  it('leaves ModalDialog’s default trigger only its button reset, the look coming from the shared class', () => {
    const trigger = rule('.b2b-dialog__trigger');
    expect(trigger).not.toMatch(/\btext-accent\b/);
    expect(trigger).not.toMatch(/\bunderline\b/);
    const html = renderToString(
      createElement(ModalDialog, { triggerLabel: 'Details', title: 'T', closeLabel: 'Close', children: 'x' }),
    );
    expect(html).toMatch(/<button type="button"[^>]*class="b2b-dialog__trigger b2b-account__link"[^>]*>Details<\/button>/);
  });
});

/**
 * Issue #1214 — the same class outside the tables. Inside a sentence it stays
 * inline (WCAG 2.5.8 exempts an inline target; growing it would break the line
 * spacing); inside a coloured notice it takes the notice's own colour, which is
 * contrast-checked against that background — the accent, and in dark mode the
 * light brand tint, are not (the notice backgrounds stay light in dark mode).
 * A link that stands on its own line — a back link, "View order" — is grown to
 * the 44px floor; a product link with a SKU line under it underlines the name only.
 */
describe('.b2b-account__link outside the tables (issue #1214)', () => {
  it('grows a link on its own line to the 44px floor', () => {
    const standalone = rule('.b2b-account__link--standalone');
    expect(standalone).toMatch(/\binline-flex\b/);
    expect(standalone).toMatch(/\bmin-h-11\b/);
    expect(standalone).toMatch(/\bitems-center\b/);
  });

  it('takes the notice’s own colour inside a success or error notice, in both modes', () => {
    const body = /\.b2b-auth__success \.b2b-account__link,\s*\.b2b-auth__error \.b2b-account__link\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toMatch(/\btext-inherit\b/);
    expect(body).toMatch(/\bdark:text-inherit\b/);
  });

  it('underlines only the first line of a stacked product link, after the table rule', () => {
    const stacked = rule('.b2b-account__link.b2b-account__link--stacked');
    expect(stacked).toMatch(/\bflex-col\b/);
    expect(stacked).toMatch(/\bitems-start\b/);
    expect(stacked).toMatch(/\bno-underline\b/);
    expect(rule('.b2b-account__link--stacked > :first-child')).toMatch(/\bunderline\b/);
    expect(rule('.b2b-account__link--stacked:hover > :first-child')).toMatch(/decoration-2/);
    expect(css.indexOf('.b2b-account__link.b2b-account__link--stacked')).toBeGreaterThan(
      css.indexOf('.b2b-account__table .b2b-account__link {'),
    );
  });
});
