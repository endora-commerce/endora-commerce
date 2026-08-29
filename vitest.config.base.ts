// Shared Vitest base configuration consumed by every workspace's local vitest.config.ts
// via `mergeConfig(baseConfig, ...)`. Keeps reporter, coverage, and timeouts consistent
// across backend + frontend + packages (Principle IV — one configuration, not three).

import { defineConfig } from 'vitest/config';
import { assertWorkspacePackagesAreLocal } from './scripts/workspace-resolution.js';

// Issue #255 — refuse a run whose `@endora-commerce/*` source comes from another checkout.
//
// Every package under `packages/` resolves through its own `exports` map at
// `./dist`, built from the checkout it lives in, so the workspace symlinks
// decide which branch's code this run compiles and executes. A `git worktree`
// whose `node_modules` was symlinked at the main
// tree resolves them all there, and the suite then reports on `master` while
// claiming to report on the branch. Nothing else notices: `pnpm ls` answers
// from the manifest and never looks at the link.
//
// This is the one file every workspace's vitest config merges, so the guard
// runs once per invocation — before a test file is collected, and without
// anybody having to remember it. See `scripts/workspace-resolution.ts` for what
// it can and cannot see.
//
// **A run that does not import this file does not ask the question**, which is
// the one way the arrangement fails and did: five packages under `packages/`
// had no vitest configuration at all and ran on vitest's defaults, green,
// printing no `[workspace-resolution] read:` line and giving a reader nothing
// to notice. Coverage is therefore derived rather than assumed —
// `backend/test/unit/harness/workspace-resolution.test.ts` fails a workspace
// member that invokes vitest with no configuration, and one whose configuration
// does not import this file.
assertWorkspacePackagesAreLocal();

export default defineConfig({
  test: {
    globals: false,
    reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
    outputFile: { junit: './test-results.junit.xml' },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/out/**',
        '**/coverage/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/test/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
  },
});
