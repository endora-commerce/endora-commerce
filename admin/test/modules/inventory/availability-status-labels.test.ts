import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { availabilityStatusLabels } from '../../../../packages/modules/inventory/src/admin/lib/labels';

/**
 * Issue #1434 — the availability notifications screen printed the raw status
 * (`queued`) in its badge while its filter chips were translated. Every status
 * has a label in both shipped `core` bundles.
 */
const read = (language: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
const echo = (key: string): string => key;

describe('availability notification status labels', () => {
  it.each(['en', 'pl'])('resolves every status in %s', (language) => {
    const bundle = read(language);
    for (const status of ['queued', 'notified', 'cancelled']) {
      expect(availabilityStatusLabels.has(status), status).toBe(true);
      expect(bundle[availabilityStatusLabels.label(echo, status)], status).toBeTruthy();
    }
  });
});
