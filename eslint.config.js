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
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;

/**
 * Issue #1027 — a package whose sources are split across several TypeScript
 * programs. `projectService` asks for the nearest `tsconfig.json` only, so a
 * module's `src/admin/**` (compiled by `tsconfig.ui.json`, and its tests by
 * `tsconfig.ui.test.json`) or the platform's co-located tests
 * (`tsconfig.test.json`) would be "not found by the project service". Such a
 * package names every non-build configuration it has, `tsconfig.json` first;
 * typescript-eslint takes the first program that contains the file. The list
 * is derived from the directory, so a package that gains a configuration needs
 * no edit here.
 */
function splitProgramBlocks() {
  const blocks = [];
  for (const parent of ['packages', 'packages/modules']) {
    // `endora new storefront` vendors this file into a standalone storefront,
    // which has no `packages/`.
    if (!existsSync(join(ROOT, parent))) continue;
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      if (!existsSync(join(ROOT, dir, 'tsconfig.json'))) continue;
      const configs = readdirSync(join(ROOT, dir))
        .filter((name) => /^tsconfig(\.[a-z]+)*\.json$/.test(name) && !name.includes('.build.'))
        .sort((a, b) => (a === 'tsconfig.json' ? -1 : b === 'tsconfig.json' ? 1 : a.localeCompare(b)));
      if (configs.length < 2) continue;
      blocks.push({
        files: [`${dir}/**/*.ts`, `${dir}/**/*.tsx`],
        languageOptions: {
          parserOptions: {
            projectService: false,
            project: configs.map((name) => `${dir}/${name}`),
            tsconfigRootDir: ROOT,
          },
        },
      });
    }
  }
  return blocks;
}

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
  // Typed promise rules over the whole tree (issue #1027). #955 Phase 2 turned
  // the first two on for the 39 files that ask the tenant scope a question,
  // because its single-id helpers became async and `if (!orgInScope(x))` over
  // a Promise is always false — a gate that silently opens. Any un-awaited
  // async call has that shape, so the rules hold every file rather than a
  // list somebody has to keep.
  //
  // One call is known-safe to leave un-awaited: react-router's `navigate`,
  // a Promise only under a data router and nothing a click handler waits for.
  // Anything else that is truly fire-and-forget says so with `void` and a
  // comment.
  //
  // Type information costs heap. `backend` lints in two processes, one per
  // TypeScript program (its `package.json` `lint`), because one process
  // holding both died `heap out of memory` under CI's 3072 MB; the larger,
  // test, program still needs more than the type-check does, so CI's lint
  // step has its own heap (`.github/workflows/quality.yml`).
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: ROOT },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'react-router', name: 'NavigateFunction' },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  ...splitProgramBlocks(),
  // `backend` is two programs whose configs nest: `test/tsconfig.json` sits
  // between `test/unit/**` and `backend/tsconfig.json`, so the project service
  // would load the larger test program just to learn that a unit test is not
  // in it, and hold both. Each tree names its own program instead; the two
  // `lint` processes in `backend/package.json` then hold one program each.
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: ['backend/tsconfig.json'], tsconfigRootDir: ROOT },
    },
  },
  {
    files: ['backend/test/contract/**/*.ts', 'backend/test/integration/**/*.ts', 'backend/test/perf/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: ['backend/test/tsconfig.json'], tsconfigRootDir: ROOT },
    },
  },
  // The third backend program (issue #1847): the overlay modules under
  // `src/apps/**`, which `backend/tsconfig.json` excludes and
  // `backend/tsconfig.apps.json` type-checks with `erasableSyntaxOnly`.
  {
    files: ['backend/src/apps/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: ['backend/tsconfig.apps.json'], tsconfigRootDir: ROOT },
    },
  },
  // An overlay module's admin layer (`specs/190-overlay-full-modules/` FR-083,
  // #1855) is browser code: `backend/tsconfig.apps.json` excludes it and the
  // admin's own program, `admin/tsconfig.json`, includes it with the DOM and JSX.
  {
    files: ['backend/src/apps/*/modules/*/admin/**/*.ts', 'backend/src/apps/*/modules/*/admin/**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: false, project: ['admin/tsconfig.json'], tsconfigRootDir: ROOT },
    },
  },
  // React rules, in the shared root and scoped to `.tsx` (feature 091, Phase 4).
  //
  // The header above calls this config framework-agnostic, and it still is for
  // `.ts`: every rule below applies only to files that are JSX by extension, of
  // which this repository has none outside a frontend.
  //
  // They live here rather than in `admin/eslint.config.js` because a module's
  // admin screens no longer live in the admin. Story 3 moves them one directory
  // at a time into `packages/modules/<id>/src/admin/`, where nothing had
  // registered `react-hooks` — so the first converted screen carrying an
  // `eslint-disable-next-line react-hooks/exhaustive-deps` failed with
  // *"Definition for rule was not found"*, and the obvious local repair — delete
  // the directive — would have been the screen quietly leaving a rule it had
  // been held to since it was written. That is the laundering FR-017 refuses,
  // in the linter. The rule follows the code; the levels are the admin's own,
  // unchanged.
  {
    files: ['**/*.tsx'],
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
  // Issue #1434 (DS-17) — no raw enum value as admin screen text. A status, a
  // kind or an actor type is a code the API sends; an operator reads its label,
  // in their language, through the owning module's `defineEnumLabels` map
  // (`@endora-commerce/admin-kit/lib`; `specs/conventions/module-i18n.md`).
  // `admin/eslint.config.js` applies the same selectors to its own `src/`.
  {
    files: [
      'packages/admin-kit/src/**/*.tsx',
      'packages/admin-shell/src/**/*.tsx',
      'packages/modules/*/src/admin/**/*.tsx',
      'backend/src/apps/*/modules/*/admin/**/*.tsx',
    ],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...rawEnumInJsxSelectors(), ...developerIdAriaLabelSelectors()],
    },
  },
];

/**
 * An `aria-label` (or a kit component's `ariaLabel`) that is a developer id —
 * `customerNote`, `select-all`, `` `delete-${code}` `` (issue #1475, UX audit
 * SALES-10). It is read aloud verbatim, in English, whatever the operator's
 * language, and it overrides the visible label as the control's accessible name
 * (WCAG 2.2 SC 2.5.3, 4.1.2). Where a `<label>` or `FormField` names the control,
 * delete the attribute; elsewhere translate it.
 *
 * A literal is an id when it is camelCase or hyphenated words with no space; a
 * template is one when no part of it is anything but letters, digits and a
 * hyphen, and a hyphen joins its parts. `{id}` passed through is not seen.
 */
export function developerIdAriaLabelSelectors() {
  const attribute = 'JSXAttribute[name.name=/^(aria-label|ariaLabel)$/]';
  const id = '/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$|^[a-z][a-z0-9]*(-[A-Za-z0-9]+)+$/';
  const message =
    'An aria-label that is a developer id is read aloud verbatim, in English, and replaces the visible label. ' +
    'Name the control with its <label> / FormField, or pass a translated string (issue #1475).';
  return [
    `${attribute} > Literal[value=${id}]`,
    `${attribute} > JSXExpressionContainer > Literal[value=${id}]`,
    `${attribute} > JSXExpressionContainer > TemplateLiteral:not(:has(TemplateElement[value.raw=/[^A-Za-z0-9-]/])):has(TemplateElement[value.raw=/-/])`,
  ].map((selector) => ({ selector, message }));
}

/**
 * The JSX-child shapes the raw-enum rule refuses (issue #1434).
 *
 * Syntax, not types: it recognises the value by its property name — a JSX child
 * that is `x.status`, `x?.kind`, or either before a `??` / `||` fallback. That
 * misses an enum under another name and catches the odd value that is not one,
 * a ReactNode slot named `action` or a command id shown as code. Such a site
 * carries an `eslint-disable-next-line` saying why; a site that is debt names
 * the issue that drains it.
 */
export function rawEnumInJsxSelectors() {
  const property = '/^(status|state|kind|action|actorType|fromState|toState|[a-z]+Status)$/';
  const member = `MemberExpression[computed=false][property.name=${property}]`;
  const child = ':matches(JSXElement, JSXFragment) > JSXExpressionContainer';
  const message =
    "A raw enum value is rendered as text. Render its label through the owning module's `defineEnumLabels` " +
    'map (`@endora-commerce/admin-kit/lib`), so the operator reads it in their language (issue #1434).';
  return [
    `${child} > ${member}`,
    `${child} > ChainExpression > ${member}`,
    `${child} > LogicalExpression > ${member}.left`,
    `${child} > LogicalExpression > ChainExpression.left > ${member}`,
  ].map((selector) => ({ selector, message }));
}
