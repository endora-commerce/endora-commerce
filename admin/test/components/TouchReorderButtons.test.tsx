import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TouchReorderButtons } from '../../../packages/admin-shell/src/components/TouchReorderButtons';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

const bundle = passthroughBundle('core', [
  'reorder.moveUp',
  'reorder.moveDown',
  'reorder.groupLabel',
]);

describe('TouchReorderButtons', () => {
  it('invokes move handlers and disables ends', async () => {
    const user = userEvent.setup();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    renderWithI18n(
      <TouchReorderButtons
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        disableUp
        disableDown={false}
      />,
      bundle,
    );
    const up = screen.getByRole('button', { name: 'reorder.moveUp' });
    const down = screen.getByRole('button', { name: 'reorder.moveDown' });
    expect(up).toBeDisabled();
    await user.click(down);
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(onMoveUp).not.toHaveBeenCalled();
  });
});
