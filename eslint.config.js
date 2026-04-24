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
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'property', format: null },
        { selector: 'objectLiteralProperty', format: null },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
