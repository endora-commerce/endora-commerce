import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Data } from '@puckeditor/core';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { installOffsetParentShim } from '../helpers/layout-shim';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1494 (UX audit CONTENT-11) — the Page Builder has **one** canvas
 * toolbar. It had two clusters in Puck's header (template actions portalled
 * into the left column, Translate / Copy from language / a solid red Clear
 * canvas / Fullscreen on the right): about eleven controls before the content,
 * and the destructive one the loudest. Now the module's own action and
 * Fullscreen stay visible, and the long tail sits in a labelled "More" menu
 * with Clear canvas as a quiet destructive entry, last and behind a separator,
 * still asking before it clears (Hick, Von Restorff, Fitts).
 */

installOffsetParentShim();

const { PageBuilderHeaderActions } = await import('../../../packages/page-builder-admin/src/chrome/PageBuilderHeaderActions');

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');
const CORE_EN = EN.core as Record<string, string>;
const CORE_PL = PL.core as Record<string, string>;
const tIn =
  (bundle: Record<string, string>) =>
  (key: string, params: Record<string, string | number> = {}): string => {
    const value = bundle[key];
    if (value === undefined) return `core.${key}`;
    return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  };
const t = tIn(CORE_EN);
/** The shipped copy for `key`; a key the bundle lacks fails the test that reads it. */
const copyIn =
  (bundle: Record<string, string>) =>
  (key: string): string => {
    const value = bundle[key];
    if (value === undefined) throw new Error(`the core bundle carries no "${key}"`);
    return value;
  };
const en = copyIn(CORE_EN);
const pl = copyIn(CORE_PL);

const CANVAS: Data = { root: { props: {} }, content: [{ type: 'Heading', props: { id: 'h1', text: 'Hi' } }] } as Data;
const EMPTY: Data = { root: { props: {} }, content: [] } as Data;

function toolbar(over: Record<string, unknown> = {}): ReactElement {
  return (
    <PageBuilderHeaderActions
      fullscreen={false}
      onToggleFullscreen={vi.fn()}
      languages={['pl', 'en']}
      activeLanguage="pl"
      currentData={CANVAS}
      onCopyFromLanguage={vi.fn()}
      onClearCanvas={vi.fn()}
      onSaveAsTemplate={vi.fn()}
      onListTemplatesForApply={vi.fn(async () => [{ id: 'tpl-1', label: 'Landing' }])}
      onApplyTemplate={vi.fn()}
      extraActions={
        <button type="button" className="module-action">
          Translate
        </button>
      }
      t={t}
      {...over}
    />
  );
}

function group(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.cms-pb-header-actions');
  if (!node) throw new Error('no canvas toolbar');
  return node;
}

afterEach(() => cleanup());

describe('the canvas toolbar (#1494)', () => {
  it('shows only the module action, "More" and Fullscreen — in that order, in one group', () => {
    renderWithI18n(toolbar(), EN);
    const names = within(group())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim());
    expect(names).toEqual(['Translate', en('common.action.more'), en('pageBuilder.fullscreen.enter')]);
    expect(document.querySelectorAll('.cms-pb-header-actions')).toHaveLength(1);
  });

  it('never draws a filled destructive button in the toolbar', () => {
    renderWithI18n(toolbar(), EN);
    expect(screen.queryByRole('button', { name: en('pageBuilder.clearCanvas.button') })).toBeNull();
    expect(group().querySelector('.bg-destructive')).toBeNull();
  });

  it('holds the long tail in "More", Clear canvas last, apart and destructive', async () => {
    const user = userEvent.setup();
    renderWithI18n(toolbar(), EN);
    await user.click(screen.getByRole('button', { name: en('common.action.more') }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      en('pageBuilder.saveAsTemplate.button'),
      en('pageBuilder.applyTemplate.button'),
      en('pageBuilder.copyLanguage.button'),
      en('pageBuilder.clearCanvas.button'),
    ]);
    const clear = items[3]!;
    expect(clear.className).toContain('text-destructive');
    expect(clear.previousElementSibling).toHaveAttribute('role', 'separator');
    await expectNoAxeViolations(menu);
  });

  it('says in the entry why an entry cannot run', async () => {
    const user = userEvent.setup();
    renderWithI18n(toolbar({ currentData: EMPTY, languages: ['pl'] }), EN);
    await user.click(screen.getByRole('button', { name: en('common.action.more') }));
    const menu = await screen.findByRole('menu');
    const clear = within(menu).getByRole('menuitem', { name: new RegExp(en('pageBuilder.clearCanvas.button')) });
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    expect(clear).toHaveTextContent(en('pageBuilder.clearCanvas.alreadyEmpty'));
    const copy = within(menu).getByRole('menuitem', { name: new RegExp(en('pageBuilder.copyLanguage.button')) });
    expect(copy).toHaveAttribute('aria-disabled', 'true');
    expect(copy).toHaveTextContent(en('pageBuilder.copyLanguage.noTargets'));
    const save = within(menu).getByRole('menuitem', { name: new RegExp(en('pageBuilder.saveAsTemplate.button')) });
    expect(save).toHaveTextContent(en('pageBuilder.saveAsTemplate.emptyCanvas'));
  });

  it('renders no "More" when the editor offers none of its entries', () => {
    renderWithI18n(
      <PageBuilderHeaderActions fullscreen={false} onToggleFullscreen={vi.fn()} currentData={CANVAS} t={t} />,
      EN,
    );
    expect(screen.queryByRole('button', { name: en('common.action.more') })).toBeNull();
    expect(screen.getByRole('button', { name: en('pageBuilder.fullscreen.enter') })).toBeInTheDocument();
  });

  it('clears only after the question, reached by keyboard alone, and gives focus back to "More"', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    renderWithI18n(toolbar({ onClearCanvas: clear }), EN);
    const more = screen.getByRole('button', { name: en('common.action.more') });
    more.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    // Typeahead or arrows: the last entry is one End away.
    await user.keyboard('{End}{Enter}');
    const dialog = await screen.findByRole('dialog', { name: en('pageBuilder.clearCanvas.title') });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: en('pageBuilder.clearCanvas.cancel') })).toHaveFocus(),
    );
    expect(clear).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clear).not.toHaveBeenCalled();
    expect(more).toHaveFocus();
  });

  it('asks through the kit confirmation on the overlay layer, clears on confirm and gives focus back to "More"', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    renderWithI18n(toolbar({ onClearCanvas: clear }), EN);
    const more = screen.getByRole('button', { name: en('common.action.more') });
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(en('pageBuilder.clearCanvas.button')) }));
    const dialog = await screen.findByRole('dialog', { name: en('pageBuilder.clearCanvas.title') });
    // Above Puck's 9999 action bar, not the page layer's z-50.
    const layer = dialog.closest<HTMLElement>('[data-layer]');
    expect(layer).toHaveAttribute('data-layer', 'overlay');
    expect(layer).not.toHaveClass('z-50');
    expect(Number(layer?.style.zIndex)).toBeGreaterThan(9999);
    expect(dialog).toHaveAccessibleDescription(en('pageBuilder.clearCanvas.description'));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: en('pageBuilder.clearCanvas.cancel') })).toHaveFocus(),
    );
    await user.click(within(dialog).getByRole('button', { name: en('pageBuilder.clearCanvas.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('reports a result in the one status region at the start of the group', async () => {
    const user = userEvent.setup();
    const apply = vi.fn(async () => undefined);
    renderWithI18n(toolbar({ onApplyTemplate: apply }), EN);
    const status = within(group()).getByRole('status');
    expect(group().firstElementChild).toBe(status);
    await user.click(screen.getByRole('button', { name: en('common.action.more') }));
    await user.click(await screen.findByRole('menuitem', { name: en('pageBuilder.applyTemplate.button') }));
    const dialog = await screen.findByRole('dialog', { name: en('pageBuilder.applyTemplate.title') });
    const confirm = within(dialog).getByRole('button', { name: en('pageBuilder.applyTemplate.confirm') });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apply).toHaveBeenCalledWith('tpl-1');
    expect(status).toHaveTextContent(en('pageBuilder.applyTemplate.success'));
  });

  it('names every control in Polish too', async () => {
    const user = userEvent.setup();
    renderWithI18n(toolbar({ t: tIn(CORE_PL), currentData: EMPTY }), PL, { language: 'pl' });
    await user.click(screen.getByRole('button', { name: pl('common.action.more') }));
    const menu = await screen.findByRole('menu');
    expect(menu.textContent).not.toContain('core.');
    expect(menu).toHaveTextContent(pl('pageBuilder.clearCanvas.alreadyEmpty'));
  });
});
