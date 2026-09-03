// Storefront ESLint config — extends the root with React-specific naming.
//
// React components are PascalCase by convention; the shared root config
// enforces camelCase for `function` declarations across the repo because
// the backend prefers it. Override the naming rule here so server
// components (which are exported functions returning JSX) and default
// imports of component libraries (`import Link from 'next/link'`) pass.

import rootConfig from '../eslint.config.js';
import nextPlugin from '@next/eslint-plugin-next';

export default [
  ...rootConfig,
  {
    /*
     * The build scripts under `scripts/` are plain Node ESM, and the shared root
     * config only reaches `.ts` / `.tsx` — so `eslint scripts` matched nothing
     * and exited 0 over an unlinted directory. That is the green-that-means-not-
     * looking this repository refuses everywhere else, so the block exists
     * rather than the lint target being narrowed back.
     *
     * `.mjs` and not TypeScript because `generate-themes.mjs` runs before
     * anything in the storefront is built, in a tree whose TypeScript toolchain
     * belongs to whoever owns that storefront after `endora new storefront`.
     */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      '@next/next/no-img-element': 'warn',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        // React components in .tsx files are PascalCase.
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'property', format: null },
        { selector: 'objectLiteralProperty', format: null },
        // Carried over from the root config, which this block replaces wholesale
        // rather than extends. typescript-eslint classifies a property whose
        // value is a function as `objectLiteralMethod`, so dropping the selector
        // put every `vi.mock` factory returning a React component — the name has
        // to be the mocked module's export, and React requires it PascalCase —
        // under the camelCase default. Nothing saw it while `test/` was outside
        // the lint target.
        { selector: 'objectLiteralMethod', format: null },
        // Default imports of PascalCase components (Link, Image, …).
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },
  {
    // Next.js Route Handlers MUST export functions named after the HTTP
    // method (`GET`, `POST`, `PATCH`, …). Allow UPPER_CASE for those.
    files: ['app/**/route.ts', 'app/**/route.tsx'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'function', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
    },
  },
];
