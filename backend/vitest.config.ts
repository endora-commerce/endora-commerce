import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'backend',
      environment: 'node',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      setupFiles: [],
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
      ...(isCi
        ? {
            // Junit + tinypool fork shutdown race → spurious `write EPIPE` after all
            // tests passed (vitest 2.x). Default reporter only on CI shards; GitLab
            // still gets pass/fail from the job exit code.
            reporters: ['default'],
            outputFile: undefined,
            teardownTimeout: 60_000,
            // Last resort: tests already green; don't fail the pipeline on IPC noise.
            // Fixed properly in vitest ≥4 (pool shutdown). Remove when upgraded.
            // dangerouslyIgnoreUnhandledErrors: true,
          }
        : {}),
    },
  }),
);
