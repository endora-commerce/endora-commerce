import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Issue #1808 (item 4) — the product editor's low-stock threshold input is a
 * `max-w-56` number field; "Inherit from warehouse / global" was cut off in it.
 * The help line under the input explains the inheritance, so the placeholder
 * only has to say the field is inherited — in a length the input shows whole.
 */
const MAX_PLACEHOLDER = 22;

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/catalog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

describe('the low-stock threshold placeholder fits its input (issue #1808)', () => {
  it.each(['en', 'pl'] as const)('%s', (language) => {
    const placeholder = bundle(language)['inventoryTab.lowStock.placeholder'] ?? '';
    expect(placeholder.length).toBeGreaterThan(0);
    expect(placeholder.length).toBeLessThanOrEqual(MAX_PLACEHOLDER);
  });
});
