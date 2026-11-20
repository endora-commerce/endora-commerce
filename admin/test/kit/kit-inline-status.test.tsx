import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ALERT_DEFAULT_LIVE,
  Alert,
  AlertDescription,
  Button,
  InlineStatus,
  alertRole,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1484 (UX audit SHELL-08) — `Alert` no longer announces every banner as
 * an interruption — and issue #1443 (DS-10) — `InlineStatus` is the one
 * always-mounted `role="status"` region for an action's result, next to its
 * button (owner decision DEC-12 a). WCAG 2.2 SC 4.1.3.
 */

describe('Alert — role follows the variant (SHELL-08)', () => {
  it('interrupts only for an error', () => {
    render(
      <>
        <Alert variant="destructive" data-testid="destructive">x</Alert>
        <Alert variant="success" data-testid="success">x</Alert>
        <Alert variant="warning" data-testid="warning">x</Alert>
        <Alert data-testid="default">x</Alert>
      </>,
    );
    expect(screen.getByTestId('destructive').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('success').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('warning').hasAttribute('role')).toBe(false);
    expect(screen.getByTestId('default').hasAttribute('role')).toBe(false);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('`live` chooses the announcement explicitly', () => {
    render(
      <>
        <Alert variant="warning" live="assertive" data-testid="urgent">x</Alert>
        <Alert live="polite" data-testid="result">x</Alert>
        <Alert variant="destructive" live="off" data-testid="static-error">x</Alert>
      </>,
    );
    expect(screen.getByTestId('urgent').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('result').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('static-error').hasAttribute('role')).toBe(false);
  });

  it('marks every banner with data-slot and data-variant, so one without a role can still be found', () => {
    render(<Alert variant="warning" data-testid="w">x</Alert>);
    expect(screen.getByTestId('w').getAttribute('data-slot')).toBe('alert');
    expect(screen.getByTestId('w').getAttribute('data-variant')).toBe('warning');
  });

  it('an explicit `role` still wins', () => {
    render(<Alert variant="warning" role="note" data-testid="note">x</Alert>);
    expect(screen.getByTestId('note').getAttribute('role')).toBe('note');
  });

  it('exposes the default table and the pure role function', () => {
    expect(ALERT_DEFAULT_LIVE).toEqual({
      destructive: 'assertive',
      success: 'polite',
      warning: 'off',
      default: 'off',
    });
    expect(alertRole(undefined)).toBeUndefined();
    expect(alertRole(null, 'polite')).toBe('status');
  });

  it('draws success and warning from the theme tokens, not a fixed palette', () => {
    render(
      <>
        <Alert variant="success" data-testid="success">x</Alert>
        <Alert variant="warning" data-testid="warning">x</Alert>
      </>,
    );
    const success = screen.getByTestId('success').className;
    const warning = screen.getByTestId('warning').className;
    expect(success).toContain('var(--success-soft)');
    expect(warning).toContain('var(--warn-soft)');
    expect(`${success} ${warning}`).not.toMatch(/emerald|amber/);
  });
});

describe('InlineStatus — always-mounted polite region (DS-10)', () => {
  it('is in the tree, empty, before there is a message', () => {
    render(<InlineStatus>{null}</InlineStatus>);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');
  });

  it('pairs a success or error message with an icon, so colour is not the only carrier', () => {
    const { rerender } = render(<InlineStatus>Saved</InlineStatus>);
    let region = screen.getByRole('status');
    expect(region.textContent).toBe('Saved');
    expect(region.getAttribute('data-tone')).toBe('success');
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    rerender(<InlineStatus tone="error">Could not save</InlineStatus>);
    region = screen.getByRole('status');
    expect(region.getAttribute('data-tone')).toBe('error');
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    rerender(<InlineStatus tone="info">Copied</InlineStatus>);
    expect(screen.getByRole('status').querySelector('svg')).toBeNull();
  });

  it('a `warning` tone (issue #1499) pairs its colour with an icon and stays polite', () => {
    render(<InlineStatus tone="warning">Sent to 1 of 2</InlineStatus>);
    const region = screen.getByRole('status');
    expect(region.getAttribute('data-tone')).toBe('warning');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(region.className).toContain('var(--warn-soft-fg)');
  });

  it('`visuallyHidden` announces without showing', () => {
    render(<InlineStatus visuallyHidden>Status changed</InlineStatus>);
    const region = screen.getByRole('status');
    expect(region.className).toContain('sr-only');
    expect(region.querySelector('svg')).toBeNull();
  });

  it('keeps the same region node across messages, and re-inserts the text on a new revision', () => {
    const { rerender } = render(<InlineStatus revision={1}>Saved</InlineStatus>);
    const region = screen.getByRole('status');
    const firstText = region.firstChild;
    rerender(<InlineStatus revision={1}>Saved</InlineStatus>);
    expect(region.firstChild).toBe(firstText);
    rerender(<InlineStatus revision={2}>Saved</InlineStatus>);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.firstChild).not.toBe(firstText);
  });

  it('has no axe violations empty or filled, next to its button', async () => {
    const { container, rerender } = render(
      <div>
        <Button type="button">Save</Button>
        <InlineStatus>{null}</InlineStatus>
      </div>,
    );
    await expectNoAxeViolations(container);
    rerender(
      <div>
        <Button type="button">Save</Button>
        <InlineStatus>Saved</InlineStatus>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('useInlineStatus', () => {
  function Harness(): ReactNode {
    const status = useInlineStatus();
    return (
      <div>
        <Button type="button" onClick={(): void => status.show('Saved')}>
          Save
        </Button>
        <Button type="button" onClick={(): void => status.show('Failed', 'error')}>
          Fail
        </Button>
        <Button type="button" onClick={status.clear}>
          Edit
        </Button>
        <InlineStatus {...status.props} />
      </div>
    );
  }

  it('shows, re-announces the same message, and clears without unmounting the region', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const region = screen.getByRole('status');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(region.textContent).toBe('Saved');
    const first = region.firstChild;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(region.textContent).toBe('Saved');
    expect(region.firstChild).not.toBe(first);
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(region.getAttribute('data-tone')).toBe('error');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('a success Alert is a polite region, and still renders its description', () => {
    render(
      <Alert variant="success">
        <AlertDescription>Done</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole('status').textContent).toBe('Done');
  });
});
