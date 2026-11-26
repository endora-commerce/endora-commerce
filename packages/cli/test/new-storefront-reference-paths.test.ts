/**
 * #1951 — the reference storefront's tracked files are recorded relative to the
 * storefront directory with `/`, whatever the host's separator. CI runs on
 * POSIX, where `node:path` never produces a backslash, so the Windows case is
 * proved with `path.win32` handed to the mapping.
 */
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';

import { storefrontRelativePaths } from '../src/new-storefront/reference.js';

describe('storefrontRelativePaths (#1951)', () => {
  it('writes Windows paths with forward slashes', () => {
    expect(
      storefrontRelativePaths(
        ['storefront/test/seo/robots.test.ts', 'storefront/app/page.tsx'],
        'C:\\repo',
        'C:\\repo\\storefront',
        win32,
      ),
    ).toEqual(['test/seo/robots.test.ts', 'app/page.tsx']);
  });

  it('is unaffected by drive-letter case and works on UNC roots', () => {
    expect(
      storefrontRelativePaths(['storefront/app/page.tsx'], 'c:\\repo', 'C:\\REPO\\storefront', win32),
    ).toEqual(['app/page.tsx']);
    expect(
      storefrontRelativePaths(['storefront/a/b.ts'], '\\\\srv\\share\\repo', '\\\\srv\\share\\repo\\storefront', win32),
    ).toEqual(['a/b.ts']);
  });

  it('keeps a test file under the `test` root, which the copy classifies by its first segment', () => {
    const [file = ""] = storefrontRelativePaths(['storefront/test/seo/x.test.ts'], 'C:\\repo', 'C:\\repo\\storefront', win32);
    expect(file.split('/')[0]).toBe('test');
    expect(file.startsWith('test/')).toBe(true);
  });

  it('is a no-op on POSIX', () => {
    expect(
      storefrontRelativePaths(['storefront/test/seo/x.test.ts'], '/repo', '/repo/storefront', posix),
    ).toEqual(['test/seo/x.test.ts']);
  });
});
