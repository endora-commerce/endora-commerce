import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Docs translation scripts that must read locales from config (FR-025). */
const DOCS_I18N_SCRIPTS = [
  'backend/scripts/check-docs-translations.ts',
  'backend/scripts/lib/docs-translation-cache.ts',
  'backend/scripts/lib/docs-translation-sources.ts',
] as const;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('docs locale configuration usage (FR-025)', () => {
  it('loads translate locales from loadDocsLocales() in the check script', () => {
    const source = readFileSync(join(REPO_ROOT, 'backend/scripts/check-docs-translations.ts'), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*loadDocsLocales[^}]*\}\s*from\s*['"].*docs-locales/);
    expect(source).toMatch(/loadDocsLocales\s*\(\s*\)/);
    expect(source).toMatch(/translateLocales:\s*locales\.translateLocales/);
  });

  it('does not hard-code pl in docs translation scripts', () => {
    for (const relativePath of DOCS_I18N_SCRIPTS) {
      const source = stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'));
      expect(source, relativePath).not.toMatch(/['"]pl['"]/);
    }
  });
});
