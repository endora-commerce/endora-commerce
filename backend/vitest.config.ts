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
    },
  }),
);
