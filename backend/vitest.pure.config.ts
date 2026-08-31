/**
 * Pure unit-test config — no Postgres/Redis globalSetup.
 * Use for offline unit tests that only need Node + vitest.
 *
 *   pnpm --filter backend exec vitest run --config vitest.pure.config.ts <paths>
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend-pure',
      environment: 'node',
      include: ['test/unit/**/*.test.ts', 'src/**/*.test.ts'],
      setupFiles: ['./test/tenancy-setup.ts'],
      pool: 'forks',
      fileParallelism: false,
      testTimeout: 10_000,
      hookTimeout: 10_000,
    },
  }),
);
