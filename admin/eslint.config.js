// Admin (React + Vite) ESLint config — extends the shared root config and
// adds the React-specific plugins this app's source relies on (the root
// config is framework-agnostic; see its header comment).
import rootConfig from '../eslint.config.js';
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
];
