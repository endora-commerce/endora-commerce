// Flat ESLint config — shared root for every workspace.
// Each workspace may extend this and add framework-specific rules in its own eslint.config.js.
//
// Enforces the subset of Principle VI that is grep-able at the source level:
// - camelCase for variables/functions/properties
// - PascalCase for types/classes
// - SCREAMING_SNAKE_CASE allowed for module-level consts
// - file naming is handled by scripts/check-naming.sh (kebab-case for most, snake_case for backend modules)

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'node_modules/**',
      '.pnpm-store/**',
      'dist/**',
      'build/**',
      '.next/**',
      'out/**',
      '.turbo/**',
      '.docusaurus/**',
      'coverage/**',
      '**/*.min.js',
      'backend/src/generated/**',
      'packages/contracts/src/generated/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        // Function-declaration React components are PascalCase, mirroring the
        // arrow-function components already permitted by the `variable` rule.
        { selector: 'function', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // Default imports of classes / namespaces are conventionally PascalCase
        // (e.g. `import Fastify from 'fastify'`, `import Stripe from 'stripe'`).
        // `ioredis` is the one package excluded from that idiom — see the
        // `no-restricted-imports` entry below.
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'property', format: null },
        { selector: 'objectLiteralProperty', format: null },
        // Registry objects keyed by data values (e.g. 'payment-method') and
        // test-seam method signatures don't follow identifier conventions.
        { selector: 'objectLiteralMethod', format: null },
        { selector: 'typeMethod', format: null },
        // Test-only seams use a `__` prefix to signal "do not call in prod".
        { selector: 'classMethod', format: ['camelCase'], leadingUnderscore: 'allowSingleOrDouble' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Allow inline `import('...').Type` annotations — used deliberately for
      // lazy/late-bound type references (e.g. forward-declared service handles)
      // without pulling a value import to the top of the file.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // D-162 — a published `@endora-commerce/*` package compiles under
      // `moduleResolution: NodeNext` as well as under `Bundler`. `ioredis` is the
      // only bare specifier in this tree whose default import breaks that: its
      // runtime is CJS (`built/index.js` reassigns `module.exports` to the class)
      // while its declarations claim an ESM `export default`, so under NodeNext the
      // default binding is the module namespace — `TS2709` as a type, `TS2351` as a
      // constructor. The named export is the identical class at runtime and
      // type-checks under both modes. This is a rule about `ioredis`, not a general
      // prohibition on default imports; the other eight default-imported bare
      // specifiers in this tree are clean under NodeNext.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ioredis',
              importNames: ['default'],
              message:
                "Import ioredis by name: `import { Redis } from 'ioredis'`. The default import " +
                "does not type-check under moduleResolution: NodeNext (TS2709) — ioredis' " +
                'declarations describe an ESM default over a CJS `module.exports = Redis`.',
            },
          ],
        },
      ],
    },
  },
];
