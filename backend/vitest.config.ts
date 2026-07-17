import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['test/**/*.test.ts', 'test/**/*.bench.ts', 'src/**/*.test.ts'],
      setupFiles: ['./test/tenancy-setup.ts'],
      // Forces DATABASE_URL → b2b_test, auto-creates the DB on first run, and
      // applies migrations. Runs once in the parent process before any worker
      // fork; workers inherit the env. See test/global-setup.ts.
      globalSetup: ['./test/global-setup.ts'],
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
