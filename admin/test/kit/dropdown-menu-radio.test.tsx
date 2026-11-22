import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@endora-commerce/admin-kit/ui';

/**
 * Issue #1783 — the kit's single-choice menu entry. The top-bar language
 * picker is a pick-one-of-N menu, which the kit could not express: its
 * `DropdownMenuItem` is a plain `menuitem`, with no checked state.
 */
function Harness(): ReactNode {
  const [value, setValue] = useState('a');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
          <DropdownMenuRadioItem value="a">Alpha</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="b">Beta</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function open(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }), { button: 0, ctrlKey: false });
}

describe('DropdownMenuRadioItem (#1783)', () => {
  it('is a menuitemradio carrying its checked state, with the mark hidden from assistive technology', () => {
    render(<Harness />);
    open();
    const alpha = screen.getByRole('menuitemradio', { name: 'Alpha' });
    const beta = screen.getByRole('menuitemradio', { name: 'Beta' });
    expect(alpha).toHaveAttribute('aria-checked', 'true');
    expect(beta).toHaveAttribute('aria-checked', 'false');
    // The check mark is drawn for the checked entry only, and says nothing the
    // `aria-checked` state does not.
    expect(alpha.querySelector('svg')).not.toBeNull();
    expect(beta.querySelector('svg')).toBeNull();
    expect(alpha.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });

  it('selects on Enter and reports the new value', () => {
    render(<Harness />);
    open();
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Beta' }), { key: 'Enter' });
    open();
    expect(screen.getByRole('menuitemradio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
  });
});
