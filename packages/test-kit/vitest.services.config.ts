// The kit's **service-bound** run: a real PostgreSQL and a real Redis.
//
// It is a second configuration rather than a condition inside the first,
// because a condition is a green that can quietly become "not looking". CI's
// `test:frontend` job runs `pnpm --filter '!backend' run test` in an image with
// no service containers at all, so the tests here are outside that run's
// `include` — a fact about which files it collects, not about whether they
// pass. `pnpm --filter @endora-commerce/test-kit run test:services` is what
// runs them, beside the services.
//
// An in-memory substitute was rejected in the plan and the reason holds here:
// MikroORM's PostgreSQL driver, the tenant global-filter guard and the
// `create database … template` clone **are** the subject of these tests, not
// their background.

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'test-kit-services',
      environment: 'node',
      include: ['test/services/**/*.test.ts'],
      globalSetup: ['./test/services/global-setup.ts'],
      // One composed server at a time: each file composes its own platform over
      // the one leased database, and two in parallel would race on its rows.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      fileParallelism: false,
      hookTimeout: 60_000,
      testTimeout: 60_000,
    },
  }),
);
