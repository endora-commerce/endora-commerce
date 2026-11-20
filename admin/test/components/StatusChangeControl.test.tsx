import { StrictMode, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusChangeControl, type StatusChangeControlProps } from '@endora-commerce/admin-kit/components';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../helpers/axe';
import { installOffsetParentShim } from '../helpers/layout-shim';

/**
 * Issue #1435 (DS-18) — a status that commits on a select's `change` moved an
 * order to *Shipped* on a stray arrow key (WCAG 3.2.2). The kit's replacement
 * shows the current value as a badge beside a "Change…" button; the button
 * opens a dialog that offers only the allowed targets, and the write happens
 * only after an explicit confirmation step.
 */

installOffsetParentShim();

const CORE = passthroughBundle('core', [
  'common.action.back',
  'common.action.cancel',
  'common.statusChange.change',
  'common.statusChange.continue',
  'common.statusChange.confirm',
  'common.statusChange.confirmTitle',
  'common.statusChange.summary',
  'common.statusChange.current',
  'common.statusChange.target',
  'common.statusChange.noTransitions',
  'common.statusChange.changed',
  'common.statusChange.error',
]);

const OPTIONS = [
  { value: 'shipped', label: 'Shipped' },
  { value: 'cancelled', label: 'Cancelled' },
];

function Harness(props: Partial<StatusChangeControlProps>): ReactElement {
  return (
    <StatusChangeControl
      label="Order status"
      dialogTitle="Change order status"
      current="processing"
      currentLabel="Processing"
      options={OPTIONS}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  );
}

function renderControl(props: Partial<StatusChangeControlProps> = {}): void {
  renderWithI18n(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>,
    CORE,
  );
}

const opener = (): HTMLElement => screen.getByRole('button', { name: /common\.statusChange\.change/ });

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(opener());
  return screen.findByRole('dialog');
}

describe('StatusChangeControl (#1435, DS-18)', () => {
  it('shows the current value as text and renders no select', () => {
    renderControl();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(opener()).toHaveAccessibleName('common.statusChange.change Order status');
  });

  it('keeps the label as the name but hides it visually with labelVisuallyHidden (#1501)', () => {
    renderControl({ labelVisuallyHidden: true });
    expect(opener()).toHaveAccessibleName('common.statusChange.change Order status');
    expect(screen.getByText('Order status')).toHaveClass('sr-only');
  });

  it('offers only the allowed targets, never the current value, and writes nothing on pick', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderControl({ onConfirm, options: [{ value: 'processing', label: 'Processing' }, ...OPTIONS] });
    const dialog = await openDialog();
    expect(dialog).toHaveAccessibleName('Change order status');
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['shipped', 'cancelled']);
    // Arrow keys move the selection, as on the select — and commit nothing.
    radios[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('asks for confirmation before writing, then writes the chosen target and closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderControl({ onConfirm });
    const dialog = await openDialog();
    const continueButton = within(dialog).getByRole('button', { name: 'common.statusChange.continue' });
    expect(continueButton).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Shipped' }));
    await userEvent.click(continueButton);
    expect(onConfirm).not.toHaveBeenCalled();

    expect(dialog).toHaveAccessibleName('common.statusChange.confirmTitle');
    expect(within(dialog).getByText('common.statusChange.summary')).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('shipped'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener()).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('common.statusChange.changed');
  });

  it('goes back to the choice without writing', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderControl({ onConfirm });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Cancelled' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.back' }));
    const cancelled = within(dialog).getByRole('radio', { name: 'Cancelled' });
    expect(cancelled).toBeChecked();
    expect(cancelled).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape and on Cancel without writing, returning focus to the opener', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderControl({ onConfirm });
    await openDialog();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener()).toHaveFocus());

    const dialog = await openDialog();
    // A fresh dialog: the earlier choice is not carried over.
    expect(within(dialog).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('preselects the only allowed target', async () => {
    renderControl({ options: [OPTIONS[0]!] });
    const dialog = await openDialog();
    expect(within(dialog).getByRole('radio', { name: 'Shipped' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'common.statusChange.continue' })).toBeEnabled();
  });

  it('keeps the dialog open with the error and a busy state while in flight', async () => {
    let reject: (e: unknown) => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((_, rej) => {
          reject = rej;
        }),
    );
    renderControl({ onConfirm, errorMessage: () => 'The carrier refused it.' });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Shipped' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    const confirm = within(dialog).getByRole('button', { name: 'common.statusChange.confirm' });
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    // Escape is inert while the write is in flight.
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    reject(new Error('boom'));
    expect(await within(dialog).findByText('The carrier refused it.')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The carrier refused it.');
    expect(within(dialog).getByRole('button', { name: 'common.statusChange.confirm' })).toBeEnabled();
  });

  it('disables the button and says why when there is nothing to change to', () => {
    renderControl({ options: [] });
    expect(opener()).toBeDisabled();
    expect(opener()).toHaveAccessibleDescription('common.statusChange.noTransitions');
  });

  it('disables the button with the caller reason (e.g. no permission)', () => {
    renderControl({ disabledReason: 'Your role cannot change it.' });
    expect(opener()).toBeDisabled();
    expect(opener()).toHaveAccessibleDescription('Your role cannot change it.');
  });

  it('has no axe violations, closed and open', async () => {
    renderControl();
    await expectNoAxeViolations(document.body);
    await openDialog();
    await expectNoAxeViolations(document.body);
  });
});
