import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * U4 (owner's manual test) — a number input's `min` makes the browser refuse the form with its
 * own bubble, worded in the browser's language rather than the storefront's. The quick-order
 * forms post a quantity the server action already normalises (Postel's Law), so they ask the
 * browser not to validate. The page is an async server component with server actions, so its
 * markup is read, not rendered.
 */
const source = readFileSync(resolve(import.meta.dirname, '../../app/(account)/quick-order/page.tsx'), 'utf8');

function formOpeningTag(action: string): string {
  const match = new RegExp(`<form\\b[^>]*action=\\{${action}\\}[^>]*>`).exec(source);
  return match?.[0] ?? '';
}

describe('quick order — no native validation bubble on the quantity forms', () => {
  for (const action of ['addSearchResultAction', 'updateQuantityAction']) {
    it(`the ${action} form is noValidate`, () => {
      const tag = formOpeningTag(action);
      expect(tag).not.toBe('');
      expect(tag).toContain('noValidate');
    });
  }

  it('normalises the posted quantity on the server instead', () => {
    // Issue #351 — into 1…LINE_QUANTITY_MAX, through one helper both actions call.
    expect(source).toContain('return Math.min(LINE_QUANTITY_MAX, Math.max(1, typed));');
    expect(source.match(/const quantity = typedQuantity\(formData\);/g)).toHaveLength(2);
  });
});
