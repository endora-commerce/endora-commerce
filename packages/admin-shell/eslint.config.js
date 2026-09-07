// The admin shell's ESLint config — the admin application's own, moved with it
// (feature 110, T120).
//
// It is `admin/eslint.config.js` unchanged, and it exists here for that file's
// reason: the shared root config registers `react-hooks` and `jsx-a11y` for
// `**/*.tsx` only, on the argued ground that it stays framework-agnostic for
// `.ts` — and this application's hooks are not all `.tsx`.
// `src/lib/prompt-actions/usePromptRequest.ts` carries an
// `eslint-disable-next-line react-hooks/exhaustive-deps` it has been held to
// since it was written, and under the root config alone that directive is
// *"Definition for rule was not found"*. The obvious local repair — delete the
// directive — would be the file quietly leaving a rule it was written under,
// which is the laundering the root config's own comment refuses one extension
// over. The rule follows the code.
import rootConfig from '../../eslint.config.js';
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
