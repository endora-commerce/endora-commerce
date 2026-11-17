import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetReferenceKindSchema } from '@endora-commerce/contracts';
import { assetReferenceKindLabels } from '../../../../packages/modules/assets_library/src/admin/lib/labels';

/**
 * Issue #1434 — the asset detail drawer's "Referenced by" list printed each
 * reference's raw kind (`product_gallery`). Every published kind has a label in
 * both shipped `assets_library` bundles.
 */
const read = (language: string): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/assets_library/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
const echo = (key: string): string => key;

describe('asset reference kind labels', () => {
  it.each(['en', 'pl'])('resolves every published reference kind in %s', (language) => {
    const bundle = read(language);
    for (const kind of assetReferenceKindSchema.options) {
      expect(bundle[assetReferenceKindLabels.label(echo, kind)], kind).toBeTruthy();
    }
  });
});
