import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReorderControls } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Issue #1633 — the up/down controls of a server-backed reorder, extracted into
 * the kit. Their accessible names are `core` copy naming the row, in both
 * languages, and a reorder in flight leaves the buttons focusable
 * (`aria-disabled`) rather than `disabled`.
 */
describe('ReorderControls', () => {
  it('names the row in the accessible names and moves it', async () => {
    const onMove = vi.fn();
    renderWithI18n(
      <ReorderControls name="Won" isFirst={false} isLast={false} disabled={false} onMove={onMove} />,
      shippedCoreBundle('en'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move Won up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move Won down' }));
    expect(onMove.mock.calls).toEqual([[-1], [1]]);
  });

  it('ships the Polish names', () => {
    renderWithI18n(
      <ReorderControls name="Wygrana" isFirst={false} isLast={false} disabled={false} onMove={vi.fn()} />,
      shippedCoreBundle('pl'),
      { language: 'pl' },
    );
    expect(screen.getByRole('button', { name: 'Przesuń „Wygrana” w górę' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Przesuń „Wygrana” w dół' })).toBeInTheDocument();
  });

  it('disables the first row’s up and the last row’s down', () => {
    renderWithI18n(
      <ReorderControls name="Only" isFirst isLast disabled={false} onMove={vi.fn()} />,
      shippedCoreBundle('en'),
    );
    expect(screen.getByRole('button', { name: 'Move Only up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Only down' })).toBeDisabled();
  });

  it('keeps the buttons focusable but inert while a reorder is in flight', async () => {
    const onMove = vi.fn();
    renderWithI18n(
      <ReorderControls name="Won" isFirst={false} isLast={false} disabled onMove={onMove} />,
      shippedCoreBundle('en'),
    );
    const up = screen.getByRole('button', { name: 'Move Won up' });
    expect(up).not.toBeDisabled();
    expect(up).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(up);
    expect(onMove).not.toHaveBeenCalled();
  });
});
