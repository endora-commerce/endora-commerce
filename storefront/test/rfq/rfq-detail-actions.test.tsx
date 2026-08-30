import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RfqDetailActions } from '../../components/rfq/RfqDetailActions';
import { rfqValidity, rfqValidityGate } from '../../lib/quote-requests/validity';
import type { RfqStatus } from '../../lib/api/rfq';

/**
 * The second half of the owner's decision of 2026-08-29: once the date is on
 * screen, Accept and Place order refuse to be pressed past it — with the reason
 * beside them rather than only inside the failure.
 *
 * Asserted from the markup the server sends, which is where `disabled` and
 * `aria-describedby` actually are.
 */
const NOW = new Date('2026-08-29T12:00:00.000Z');
const FUTURE = '2026-09-12T09:14:00.000Z';
const PAST = '2026-08-12T09:14:00.000Z';

async function noop(): Promise<void> {}

function render(input: {
  status: RfqStatus;
  awaiting: boolean;
  expiresAt: string | null;
  locale?: string;
}): string {
  const gate = rfqValidityGate({
    status: input.status,
    awaitingCustomerRevisionAcceptance: input.awaiting,
    validity: rfqValidity(input.expiresAt, NOW),
  });
  return renderToString(
    <RfqDetailActions
      rfqId="11111111-2222-4333-8444-555555555555"
      status={input.status}
      currentRevisionNumber={7}
      awaitingCustomerRevisionAcceptance={input.awaiting}
      gate={gate}
      locale={input.locale ?? 'en-US'}
      acceptAction={noop}
      rejectAction={noop}
      convertAction={noop}
      resubmitAction={noop}
    />,
  );
}

/**
 * `renderToString` emits `disabled=""` for a disabled button and nothing at all
 * for an enabled one, so counting the attribute is how "this control refuses to
 * be pressed" is measured here.
 */
function disabledCount(html: string): number {
  return html.split('disabled=""').length - 1;
}

describe('a deadline still ahead', () => {
  it('leaves Accept pressable and says nothing about validity', () => {
    const html = render({ status: 'Pending', awaiting: true, expiresAt: FUTURE });
    expect(html).toContain('Akceptuj wersję');
    expect(disabledCount(html)).toBe(0);
    expect(html).not.toContain('rfq-validity-notice');
    expect(html).not.toContain('validity period has ended');
  });

  it('leaves Place order pressable on an approved quote', () => {
    const html = render({ status: 'Approved', awaiting: false, expiresAt: FUTURE });
    expect(html).toContain('Złóż zamówienie z tej oferty');
    expect(disabledCount(html)).toBe(0);
    expect(html).not.toContain('rfq-validity-notice');
  });
});

describe('a deadline that has passed', () => {
  it('disables Accept and puts the reason next to it, not inside the control', () => {
    const html = render({ status: 'Pending', awaiting: true, expiresAt: PAST });
    expect(disabledCount(html)).toBe(1);
    // The reason is visible text above the row, and the control points at it —
    // a disabled button is out of the tab order and announces nothing.
    expect(html).toContain('id="rfq-validity-notice"');
    expect(html).toContain('aria-describedby="rfq-validity-notice"');
    expect(html).toContain('validity period has ended');
    // The control is disabled, never removed: a buyer who cannot find the
    // button they used yesterday learns nothing from its absence.
    expect(html).toContain('Akceptuj wersję');
  });

  it('leaves Reject pressable on the same lapsed offer', () => {
    // !1137 gates accept and nothing else here: refusing the decline would
    // leave the buyer no way to clear a row they have been told is dead.
    const html = render({ status: 'Pending', awaiting: true, expiresAt: PAST });
    expect(html).toContain('Odrzuć');
    expect(disabledCount(html)).toBe(1);
  });

  it('disables Place order on a lapsed approved quote and names the dead end', () => {
    const html = render({ status: 'Approved', awaiting: false, expiresAt: PAST });
    expect(disabledCount(html)).toBe(1);
    expect(html).toContain('aria-describedby="rfq-validity-notice"');
    expect(html).toContain('deadline can no longer be moved');
    expect(html).toContain('submit the request again');
  });

  it('promotes the remedy to the one filled button in the view', () => {
    const lapsed = render({ status: 'Approved', awaiting: false, expiresAt: PAST });
    // Place order keeps `btn--dark` but is inert; the live filled button is
    // the resubmit, which is the one thing that works.
    expect(lapsed).toContain('class="btn btn--dark">Submit again</button>');

    const live = render({ status: 'Approved', awaiting: false, expiresAt: FUTURE });
    expect(live).toContain('class="btn btn--outline">Submit again</button>');
  });

  it('renders the remedy button in the language the sentence is written in', () => {
    const html = render({ status: 'Approved', awaiting: false, expiresAt: PAST, locale: 'pl-PL' });
    expect(html).toContain('Złóż ponownie');
    expect(html).toContain('Zaakceptowana oferta straciła ważność');
    expect(html).not.toContain('Submit again');
  });
});

describe('no deadline at all', () => {
  it('behaves exactly as it did before this change', () => {
    for (const input of [
      { status: 'Pending' as const, awaiting: true },
      { status: 'Approved' as const, awaiting: false },
    ]) {
      const html = render({ ...input, expiresAt: null });
      expect(disabledCount(html)).toBe(0);
      expect(html).not.toContain('rfq-validity-notice');
      expect(html).not.toContain('aria-describedby');
    }
  });
});

describe('a status the deadline decides nothing for', () => {
  it('offers only the resubmit, unpromoted, and no warning', () => {
    const html = render({ status: 'Completed', awaiting: false, expiresAt: PAST });
    expect(disabledCount(html)).toBe(0);
    expect(html).not.toContain('rfq-validity-notice');
    expect(html).toContain('class="btn btn--outline">Submit again</button>');
  });
});
