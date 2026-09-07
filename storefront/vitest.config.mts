import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
    test: {
      name: 'storefront',
      environment: 'node',
      /**
       * The storefront refuses to answer for an address nobody configured
       * (`lib/env.ts`), so a test run configures one like any other consumer.
       *
       * It used to rely on the opposite: `NEXT_PUBLIC_API_BASE_URL` was unset
       * here and the fetchers' compiled-in `http://localhost:3001` was what the
       * assertions in `test/asset-url.test.ts` and
       * `test/catalog/attachments-list.test.tsx` were written against — so the
       * suite was pinning the default rather than the rebasing behaviour it
       * claims to pin. These values are what those tests are *about*: a
       * distinct, obviously-not-real origin, so an assertion that passes
       * because something invented an address cannot pass here.
       */
      env: {
        NEXT_PUBLIC_API_BASE_URL: 'http://api.test',
        BACKEND_BASE_URL: 'http://api.test',
      },
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
