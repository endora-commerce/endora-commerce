import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PlaceOrderButton } from '../../components/checkout/PlaceOrderButton';

/**
 * Task — checkout "Place Order" needs a progress indicator. The button reads
 * the form's pending state via `useFormStatus`; outside a submitting form
 * `pending` is false, so these assertions cover the idle state and the
 * moderation-gate disable. The spinner/pending-label path is exercised by the
 * browser at submit time.
 */
describe('PlaceOrderButton', () => {
  it('renders the idle label and is enabled when the org can transact', () => {
    const html = renderToString(
      <PlaceOrderButton canTransact label="Place order" pendingLabel="Placing order…" />,
    );
    expect(html).toContain('Place order');
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain('Placing order');
  });

  it('is disabled with a tooltip when the org cannot transact', () => {
    const html = renderToString(
      <PlaceOrderButton
        canTransact={false}
        label="Place order"
        pendingLabel="Placing order…"
        title="Ordering is currently unavailable."
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Ordering is currently unavailable.');
  });
});
