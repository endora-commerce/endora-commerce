import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      setupFiles: [],
      // Integration/contract tests share a single Postgres database. Running
      // test files in parallel would race on truncate+seed — pin to a single
      // fork so they execute serially inside one worker.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
