import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TouchReorderButtons } from '../../../src/components/TouchReorderButtons';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

describe('CountriesTab touch reorder', () => {
  it('invokes move-up handler from touch reorder control', async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const bundle = passthroughBundle('core', ['reorder.groupLabel', 'reorder.moveUp', 'reorder.moveDown']);

    renderWithI18n(
      <TouchReorderButtons onMoveUp={onMoveUp} onMoveDown={onMoveDown} disableUp={false} disableDown />,
      bundle,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'reorder.moveUp' }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).not.toHaveBeenCalled();
  });
});
