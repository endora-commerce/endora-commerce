// Admin (React + Vite) ESLint config — extends the shared root config and
// adds the React-specific plugins this app's source relies on (the root
// config is framework-agnostic; see its header comment).
import rootConfig, { developerIdAriaLabelSelectors, rawEnumInJsxSelectors } from '../eslint.config.js';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  ...rootConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/alt-text': 'warn',
    },
  },
  // Issues #1434 and #1475 — the root config's raw-enum and developer-id
  // aria-label rules, over this workspace's own screens (the root's globs are
  // relative to the repository root).
  {
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...rawEnumInJsxSelectors(), ...developerIdAriaLabelSelectors()],
    },
  },
];
