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
