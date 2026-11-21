import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewModeToggle } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1558 (UX audit 2026-11-17, WORK-07) — the *List | Board* switch moved
 * from Tasks into the kit, so every screen that offers both views offers them
 * the same way (Jakob's Law, internal consistency): Tasks, My Tasks and the CRM
 * Opportunities page.
 *
 * Two toggle buttons in a named group; the pressed one says in words which view
 * is on screen, never by colour alone (WCAG 1.4.1).
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');
const core = (bundle: typeof EN, key: string): string => bundle.core![key]!;

function group(bundle = EN): HTMLElement {
  return screen.getByRole('group', { name: core(bundle, 'common.viewMode.label') });
}

describe('ViewModeToggle', () => {
  it('names the group and both views from the shared bundle, the current one pressed', () => {
    renderWithI18n(<ViewModeToggle mode="board" onChange={() => undefined} />, EN);
    const list = within(group()).getByRole('button', { name: core(EN, 'common.viewMode.list') });
    const board = within(group()).getByRole('button', { name: core(EN, 'common.viewMode.board') });
    expect(list).toHaveAttribute('aria-pressed', 'false');
    expect(board).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads Polish to a Polish operator', () => {
    renderWithI18n(<ViewModeToggle mode="list" onChange={() => undefined} />, PL, { language: 'pl' });
    expect(within(group(PL)).getByRole('button', { name: core(PL, 'common.viewMode.list') })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(core(PL, 'common.viewMode.board')).not.toBe(core(EN, 'common.viewMode.board'));
  });

  it('reports the other view, and nothing for the one already on screen', async () => {
    const onChange = vi.fn();
    renderWithI18n(<ViewModeToggle mode="list" onChange={onChange} />, EN);
    await userEvent.click(within(group()).getByRole('button', { name: core(EN, 'common.viewMode.list') }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(group()).getByRole('button', { name: core(EN, 'common.viewMode.board') }));
    expect(onChange).toHaveBeenCalledWith('board');
  });

  it('gives each button 44 px on a touch screen and passes axe', async () => {
    const { container } = renderWithI18n(<ViewModeToggle mode="list" onChange={() => undefined} />, EN);
    for (const button of within(group()).getAllByRole('button')) expect(button).toHaveClass('min-h-11');
    await expectNoAxeViolations(container);
  });
});
