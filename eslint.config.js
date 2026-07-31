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
        // (e.g. `import Redis from 'ioredis'`, `import Fastify from 'fastify'`).
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
    },
  },
  {
    // Feature 065 — the migrator must always be obtained through
    // getMigrator(orm), which runs the legacy-name pre-flight before anything
    // computes pending migrations. src/db/migrator.ts is the one place allowed
    // to call the ORM's own accessor.
    files: ['backend/src/**/*.ts', 'backend/test/**/*.ts'],
    ignores: ['backend/src/db/migrator.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='getMigrator']",
          message:
            'Obtain the migrator via getMigrator(orm) from backend/src/db/migrator.ts — it runs the legacy-name pre-flight before pending work is computed.',
        },
      ],
    },
  },
];
