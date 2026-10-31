import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * The `core` bundle as it ships — `_i18n`'s `en.json` / `pl.json`, read off
 * disk, under the synthetic `core` scope the admin serves it as.
 *
 * Use it where a test asserts the copy an operator reads. A passthrough or empty
 * bundle cannot fail on a missing key: the resolver renders `core.<key>`, which
 * a test asserting that same key reads as a pass.
 */
export function shippedCoreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(
    resolve(process.cwd(), '../packages/modules/_i18n/i18n', `${language}.json`),
    'utf8',
  );
  return { core: JSON.parse(raw) as Record<string, string> };
}
