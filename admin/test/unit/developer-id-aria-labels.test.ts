/**
 * The lint rule refusing a developer id as an `aria-label` (issue #1475, UX
 * audit SALES-10): `customerNote`, `select-all`, `` `delete-${code}` `` are read
 * aloud verbatim, in English, and replace the visible label as the control's
 * accessible name. The selectors live in the root `eslint.config.js`; this pins
 * what they refuse and what they leave alone.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

interface RestrictedSyntax {
  selector: string;
  message: string;
}

// The root config is untyped JavaScript; a computed specifier keeps `tsc` from
// asking for its declarations.
const rootConfig = pathToFileURL(resolve(process.cwd(), '../eslint.config.js')).href;
const { developerIdAriaLabelSelectors } = (await import(/* @vite-ignore */ rootConfig)) as {
  developerIdAriaLabelSelectors: () => RestrictedSyntax[];
};

function findings(source: string): number {
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(source, {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'no-restricted-syntax': ['error', ...developerIdAriaLabelSelectors()] },
  });
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(fatal.message);
  return messages.length;
}

describe('developer-id aria-label rule (#1475)', () => {
  it.each([
    '<textarea aria-label="customerNote" />',
    '<input aria-label="select-all" />',
    "<input aria-label={'comment-body'} />",
    '<Combobox ariaLabel="salesChannelId" />',
    '<Button aria-label={`delete-${s.code}`} />',
    '<Input aria-label={`${idPrefix}-${key}`} />',
  ])('refuses %s', (source) => {
    expect(findings(source)).toBe(1);
  });

  it.each([
    '<button aria-label="Close" />',
    '<button aria-label="Scope settings" />',
    "<input aria-label={t('list.selection.selectAll')} />",
    '<button aria-label={`Remove ${name}`} />',
    '<button aria-label={label} />',
    '<Combobox ariaLabel={t("rfqCreate.field.salesChannel")} />',
    '<div data-testid="select-all" />',
  ])('leaves %s alone', (source) => {
    expect(findings(source)).toBe(0);
  });
});
