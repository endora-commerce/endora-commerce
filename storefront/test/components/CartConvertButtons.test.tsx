import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartConvertButtons } from '../../components/CartConvertButtons';

/**
 * Feature 027 US3 — SSR contract for CartConvertButtons.
 *
 * Two variants:
 *   1. enabled — the "Convert to Quote Request" button is rendered
 *      without the `disabled` attribute
 *   2. disabled — the button carries `disabled` + a title attribute
 *      explaining why
 */

const noopAction = async (): Promise<void> => undefined;

const STRINGS = {
  convertToQrLabel: 'Convert to quote request',
  convertToQrHint: 'Send this cart to sales as a quote request.',
};

describe('CartConvertButtons — SSR rendering', () => {
  it('renders an enabled button when not disabled', () => {
    const html = renderToString(
      <CartConvertButtons
        disabled={false}
        disabledReason={null}
        convertToQrAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Convert to quote request');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('renders a disabled button with the reason in title', () => {
    const html = renderToString(
      <CartConvertButtons
        disabled={true}
        disabledReason="Your cart is empty."
        convertToQrAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Convert to quote request');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Your cart is empty.');
  });

  it('falls back to the hint when disabled but no reason given', () => {
    const html = renderToString(
      <CartConvertButtons
        disabled={true}
        disabledReason={null}
        convertToQrAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Send this cart to sales as a quote request');
  });
});
