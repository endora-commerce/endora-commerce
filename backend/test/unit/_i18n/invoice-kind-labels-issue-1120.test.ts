import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES, invoiceKindSchema } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #1120 — the admin invoice list and detail render an invoice's kind as
 * `t(`invoices.kind.${kind}`)` out of the `core` namespace, which `_i18n`'s
 * bundles carry. `invoiceKindSchema` gained `'wz'` with the ERP sale documents
 * (feature 119) and no bundle gained its label, so a WZ row showed the raw key.
 *
 * The kinds are read from the published enum rather than written down here, so
 * a kind added later reds this file until both bundles name it. The bundles are
 * read off disk beside the registered manifest; this file imports no module.
 */

function bundle(language: string): Record<string, string> | null {
  const entry = REGISTERED_MANIFESTS.find((e) => e.manifest.id === '_i18n');
  const dir = entry?.manifest.i18n?.bundlesDir;
  if (!entry || dir === undefined) return null;
  const path = resolve(dirname(entry.filePath), dir, `${language}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const filled = (value: unknown): boolean => typeof value === 'string' && /\S/.test(value);

describe('a label for every invoice kind in every shipped language (issue #1120)', () => {
  it('finds the kinds and the bundles this test is about', () => {
    // Positive control: an empty population would make the case below vacuous.
    expect(invoiceKindSchema.options.length).toBeGreaterThan(0);
    for (const language of SUPPORTED_LANGUAGES) expect(bundle(language)).not.toBeNull();
  });

  it.each(SUPPORTED_LANGUAGES)('every invoiceKindSchema value has invoices.kind.<kind> in %s', (language) => {
    const strings = bundle(language);
    const missing = invoiceKindSchema.options
      .map((kind) => `invoices.kind.${kind}`)
      .filter((key) => !filled(strings?.[key]));
    expect(missing).toEqual([]);
  });
});
