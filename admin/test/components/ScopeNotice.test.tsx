import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TranslationProvider } from '../../src/i18n/TranslationProvider';
import type { Bundle } from '../../src/i18n/types';
import { ScopeNotice } from '../../src/components/scope-notice/ScopeNotice';

/**
 * The sentence is the deliverable (feature 087, owner decision of 2026-08-29),
 * so it is asserted against the **shipped bundle** and not against a fixture
 * that resolves every key to itself. A passthrough bundle proves the component
 * calls `t()`; it cannot tell a key that is translated from one that is
 * missing, and a missing key renders as `core.scopeNotice…` on the operator's
 * screen with nothing anywhere reporting it.
 *
 * Both languages, because a notice that appears only in English is a notice a
 * Polish operator reads as a rendering defect and ignores.
 */

const bundleFor = (language: 'en' | 'pl'): Bundle => ({
  core: JSON.parse(
    // `process.cwd()` is the `admin` workspace under vitest. `import.meta.url`
    // is not usable here: vite rewrites it to its own `/@fs/` URL.
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>,
});

const renderIn = (language: 'en' | 'pl', notice: Parameters<typeof ScopeNotice>[0]['notice']) =>
  render(
    <TranslationProvider language={language} initialBundle={bundleFor(language)}>
      <ScopeNotice notice={notice} />
    </TranslationProvider>,
  );

describe('<ScopeNotice>', () => {
  it('explains the emptiness in English', () => {
    renderIn('en', 'ORGANIZATION_ATTRIBUTION_PENDING');
    expect(
      screen.getByText('These records are not assigned to an organization yet'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain(
      'None of these records names an organization yet, so none of them can appear here.',
    );
  });

  it('explains the emptiness in Polish', () => {
    renderIn('pl', 'ORGANIZATION_ATTRIBUTION_PENDING');
    expect(
      screen.getByText('Te rekordy nie są jeszcze przypisane do organizacji'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain(
      'Żaden z tych rekordów nie wskazuje jeszcze organizacji',
    );
  });

  it('says nothing about permissions, and does not name the machinery', () => {
    renderIn('en', 'ORGANIZATION_ATTRIBUTION_PENDING');
    const text = screen.getByRole('alert').textContent ?? '';
    // The operator does not know what a tenant, a scope or a filter is, and
    // telling them they lack a permission would be false — they do not.
    for (const word of ['tenant', 'scope', 'filter', 'permission']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it('renders nothing when the response carried no notice', () => {
    const { container } = renderIn('en', null);
    // An unrestricted viewer's responses never carry the code, so this is the
    // branch they always take — the screen mounts the component unconditionally
    // and the component decides.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing when the notice is absent from the envelope', () => {
    const { container } = renderIn('en', undefined);
    expect(container).toBeEmptyDOMElement();
  });
});
