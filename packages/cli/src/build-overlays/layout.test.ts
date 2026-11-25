import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The platform's own walk, read from its source in this checkout: the CLI does not
// depend on the platform, so the agreement is a test-time comparison.
import { overlayLayoutFindings } from '../../../platform/src/overlay/overlay-layout.js';
import { layoutFindings, moduleIdsUnder } from './layout.js';

/**
 * `specs/190-overlay-full-modules/` T012 (FR-003): the CLI's layout walk and the
 * platform's agree on the same fixture, or one would let through what the other refuses.
 */

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'layout-agree-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  }
  return root;
}

const FIXTURES: Record<string, Record<string, string>> = {
  clean: {
    'a/manifest.ts': '',
    'a/backend.ts': '',
    'a/i18n/en.json': '{}',
    'a/admin/index.tsx': '',
    'b/manifest.js': '',
  },
  nested: { 'a/manifest.ts': '', 'a/x/manifest.ts': '', 'a/x/y/manifest.js': '' },
  disguised: {
    'a/manifest.ts': '',
    'a/package.json': '{}',
    'a/tsconfig.json': '{}',
    'a/admin/vite.config.ts': '',
    'a/vitest.config.mts': '',
    'a/tsup.config.cjs': '',
  },
  skipped: { 'a/manifest.ts': '', 'a/node_modules/p/package.json': '{}', 'a/dist/manifest.js': '' },
  hidden: { '.cache/package.json': '{}', 'a/manifest.ts': '' },
};

describe('the CLI layout walk agrees with the platform walk', () => {
  for (const [name, files] of Object.entries(FIXTURES)) {
    it(`on the ${name} fixture`, () => {
      const root = tree(files);
      const ids = moduleIdsUnder(root);
      expect(layoutFindings(root, ids)).toEqual(overlayLayoutFindings(root, ids));
    });
  }

  it('lists modules as the loader does: direct children, hidden ones excluded', () => {
    const root = tree(FIXTURES['hidden']!);
    expect(moduleIdsUnder(root)).toEqual(['a']);
  });
});
