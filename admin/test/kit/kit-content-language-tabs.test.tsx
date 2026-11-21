import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentLanguageTabs } from '@endora-commerce/admin-kit/components';
import { TabPanel } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1445 (UX audit 2026-11-17, DS-12) and #1448 (DS-15) — the content
 * language strip is the kit's `Tabs`: one tab in the tab order, ←/→/Home/End,
 * and — when the screen names its panel through `idBase` — `aria-controls` on
 * that panel. With no language to offer it draws the kit's `EmptyState`, not a
 * bare grey sentence.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

const LANGUAGES = ['en-US', 'pl-PL', 'de-DE'];

function Editor({ idBase, onChange }: { idBase?: string; onChange?: (language: string) => void }): ReactElement {
  const [language, setLanguage] = useState<string>('en-US');
  const select = (next: string): void => {
    onChange?.(next);
    setLanguage(next);
  };
  return (
    <>
      <button type="button">before</button>
      {idBase ? (
        <>
          <ContentLanguageTabs languages={LANGUAGES} activeLanguage={language} onChange={select} idBase={idBase} />
          <TabPanel idBase={idBase} value={language} tabIndex={-1}>
            <label htmlFor="field">Name ({language})</label>
            <input id="field" />
          </TabPanel>
        </>
      ) : (
        <ContentLanguageTabs languages={LANGUAGES} activeLanguage={language} onChange={select} />
      )}
    </>
  );
}

describe('ContentLanguageTabs — the kit Tabs pattern', () => {
  it('draws the kit strip and names the screen’s panel when given an idBase', async () => {
    const { container } = renderWithI18n(<Editor idBase="page-content" />, EN);
    const list = screen.getByRole('tablist', { name: 'Content language' });
    expect(list).toHaveClass('b2b-tabs');
    const active = screen.getByRole('tab', { name: 'en-US' });
    expect(active.id).toBe('page-content-tab-en-US');
    expect(active).toHaveClass('b2b-tab', 'is-active');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'page-content-tabpanel');
    }
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'page-content-tab-en-US');
    await expectNoAxeViolations(container);
  });

  it('keeps one tab in the tab order and moves with the arrows, Home and End', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Editor idBase="page-content" onChange={onChange} />, EN);
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0).map((tab) => tab.id)).toEqual([
      'page-content-tab-en-US',
    ]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(screen.getByRole('tab', { name: 'en-US' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'pl-PL' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'pl-PL' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'page-content-tab-pl-PL');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'de-DE' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'en-US' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'de-DE' })).toHaveFocus();

    // The next Tab leaves the strip for the panel's field, not for the next tab.
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Name (de-DE)' })).toHaveFocus();
    expect(onChange.mock.calls.map(([language]) => language)).toEqual(['pl-PL', 'de-DE', 'en-US', 'de-DE']);
  });

  it('names no panel without an idBase — a strip over page state', async () => {
    const { container } = renderWithI18n(<Editor />, EN);
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toHaveAttribute('aria-controls');
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    await expectNoAxeViolations(container);
  });
});

describe('ContentLanguageTabs — no language to offer', () => {
  it('draws the kit EmptyState with its reason, in English and in Polish', async () => {
    const en = renderWithI18n(
      <ContentLanguageTabs languages={[]} activeLanguage={null} onChange={(): void => {}} idBase="x" />,
      EN,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    const block = en.container.querySelector('[data-empty-state="no-data"]');
    expect(block).not.toBeNull();
    expect(block).toHaveTextContent('No content languages selected.');
    expect(block).toHaveTextContent('Choose at least one language in the scope to edit content.');
    await expectNoAxeViolations(en.container);
    en.unmount();

    const pl = renderWithI18n(
      <ContentLanguageTabs languages={[]} activeLanguage={null} onChange={(): void => {}} />,
      PL,
      { language: 'pl' },
    );
    const plBlock = pl.container.querySelector('[data-empty-state="no-data"]');
    expect(plBlock).toHaveTextContent('Nie wybrano języków treści.');
    expect(plBlock).toHaveTextContent('Wybierz co najmniej jeden język w zakresie, aby edytować treść.');
    expect(pl.container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
  });
});
