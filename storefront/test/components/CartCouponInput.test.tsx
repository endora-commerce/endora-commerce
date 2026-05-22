import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartCouponInput } from '../../components/CartCouponInput';

/**
 * Feature 027 US2 — SSR contract for CartCouponInput.
 *
 * The component is a server-component-friendly form. We render it via
 * `renderToString` and assert the conditional UI variants:
 *   1. No active code → apply form with input + button
 *   2. Active code → clear form with code chip + clear button
 *   3. droppedOnRead → auto-dropped notice
 *   4. applyError → reason-specific error message
 */

const noopAction = async (): Promise<void> => undefined;

const STRINGS = {
  label: 'Coupon code',
  placeholder: 'Enter code',
  applyButton: 'Apply',
  clearButton: 'Remove',
  activeCode: (code: string) => `Applied: ${code}`,
  autoDropped: (code: string, reason: string) =>
    `The code ${code} was removed: ${reason}.`,
  rejectedReason: (reason: string) => `Rejected: ${reason}`,
};

describe('CartCouponInput — SSR rendering', () => {
  it('renders the apply form when no code is active', () => {
    const html = renderToString(
      <CartCouponInput
        appliedCode={null}
        droppedOnRead={null}
        applyError={null}
        applyAction={noopAction}
        clearAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Coupon code');
    expect(html).toContain('Apply');
    expect(html).toContain('Enter code');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Applied:');
  });

  it('renders the clear form when a code is active', () => {
    const html = renderToString(
      <CartCouponInput
        appliedCode="WIOSNA10"
        droppedOnRead={null}
        applyError={null}
        applyAction={noopAction}
        clearAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Applied: WIOSNA10');
    expect(html).toContain('Remove');
    expect(html).not.toContain('Enter code');
  });

  it('renders the auto-dropped notice when droppedOnRead is set', () => {
    const html = renderToString(
      <CartCouponInput
        appliedCode={null}
        droppedOnRead={{ code: 'BIGMIN', reason: 'below_min_spend' }}
        applyError={null}
        applyAction={noopAction}
        clearAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('The code BIGMIN was removed');
    expect(html).toContain('below_min_spend');
  });

  it('renders the reason-specific error when applyError is set', () => {
    const html = renderToString(
      <CartCouponInput
        appliedCode={null}
        droppedOnRead={null}
        applyError={{ reason: 'invalid_code' }}
        applyAction={noopAction}
        clearAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Rejected: invalid_code');
  });

  it('renders both the auto-dropped notice AND the apply form together', () => {
    const html = renderToString(
      <CartCouponInput
        appliedCode={null}
        droppedOnRead={{ code: 'EXPIRED', reason: 'expired' }}
        applyError={null}
        applyAction={noopAction}
        clearAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('The code EXPIRED was removed');
    expect(html).toContain('Apply');
    expect(html).toContain('Enter code');
  });
});
