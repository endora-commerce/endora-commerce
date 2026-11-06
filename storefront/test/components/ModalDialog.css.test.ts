import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #804 — the stylesheet half of `ModalDialog`: the page behind an open
 * modal does not scroll, the footer's actions meet the touch floor, and the
 * destructive confirm is painted with the `bad` tokens rather than a literal.
 */

const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return body;
}

describe('ModalDialog stylesheet (issue #804)', () => {
  it('locks page scroll while a modal dialog is open, with no script to forget to undo it', () => {
    expect(rule('html:has(.b2b-dialog[open])')).toMatch(/overflow:\s*hidden/);
  });

  it('lays the footer out as a right-aligned action row with 44px targets', () => {
    expect(rule('.b2b-dialog__foot')).toMatch(/justify-end/);
    expect(rule('.b2b-dialog__foot > .btn')).toMatch(/min-h-11/);
  });

  it('paints the danger button with the bad tokens', () => {
    const danger = rule('.btn--danger');
    expect(danger).toMatch(/bg-bad\b/);
    expect(danger).toMatch(/border-bad\b/);
    expect(danger).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
