import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RfqValidityMeta } from '../../components/rfq/RfqValidityMeta';
import { RfqValidityNotice } from '../../components/rfq/RfqValidityNotice';
import { rfqValidityGate, rfqValidity } from '../../lib/quote-requests/validity';

/**
 * The buyer's three states, asserted from the rendered markup (the storefront
 * harness is SSR-only — `renderToString`, node env, no jsdom/RTL).
 *
 * The owner's decision of 2026-08-29 is the order these assert in: the date is
 * rendered first, and only then is anything disabled. A screen that disabled
 * without rendering would replace one silent refusal with another.
 */
const NOW = new Date('2026-08-29T12:00:00.000Z');
const FUTURE = '2026-09-12T09:14:00.000Z';
const PAST = '2026-08-12T09:14:00.000Z';

describe('RfqValidityMeta — the separator', () => {
  it('prints its own separator inline and none in a table cell', () => {
    // The caller cannot decide this without repeating the "is there a deadline"
    // test the component already makes.
    expect(renderToString(<RfqValidityMeta expiresAt={FUTURE} now={NOW} locale="en-US" />)).toContain(
      ' · ',
    );
    expect(
      renderToString(
        <RfqValidityMeta expiresAt={FUTURE} now={NOW} locale="en-US" display="block" />,
      ),
    ).not.toContain(' · ');
  });
});

describe('RfqValidityMeta — a deadline still ahead', () => {
  it('renders the date the buyer is held to, in English', () => {
    const html = renderToString(
      <RfqValidityMeta expiresAt={FUTURE} now={NOW} locale="en-US" />,
    );
    expect(html).toContain('Valid until');
    expect(html).toContain('2026');
    // A machine-readable instant beside the human one. React 19's
    // `renderToString` emits the JSX spelling of the attribute; HTML attribute
    // names are case-insensitive, so this is `<time datetime>` to a browser.
    expect(html).toContain(`dateTime="${FUTURE}"`);
    expect(html).not.toContain('Validity ended');
  });

  it('renders it in Polish too', () => {
    const html = renderToString(
      <RfqValidityMeta expiresAt={FUTURE} now={NOW} locale="pl-PL" />,
    );
    expect(html).toContain('Ważne do');
    expect(html).not.toContain('Valid until');
  });
});

describe('RfqValidityMeta — a deadline that has passed', () => {
  it('changes the sentence rather than only the colour', () => {
    const html = renderToString(<RfqValidityMeta expiresAt={PAST} now={NOW} locale="en-US" />);
    // WCAG 1.4.1: the state survives a monochrome render and a screen reader.
    expect(html).toContain('Validity ended');
    expect(html).not.toContain('Valid until');
    // Reinforcement only, from a token rather than a hex, and from one that
    // flips under `:root.is-dark` — this line sits on `--surface`, which flips,
    // and the static warn ramp measures 3.5:1 against the dark surface.
    expect(html).toContain('var(--ink-900)');
    expect(html).toContain('font-weight:600');
  });

  it('says it in Polish with the lapsed wording, not the promise wording', () => {
    const html = renderToString(<RfqValidityMeta expiresAt={PAST} now={NOW} locale="pl-PL" />);
    expect(html).toContain('Ważność zakończona');
    expect(html).not.toContain('Ważne do');
  });
});

describe('RfqValidityMeta — no deadline at all', () => {
  it('renders nothing rather than a blank where a date would go', () => {
    // An absent `expiresAt` means the operator set none and nothing refuses
    // this buyer. A dash or an empty cell cannot be told apart from a date the
    // page failed to load.
    for (const value of [null, undefined, '']) {
      expect(renderToString(<RfqValidityMeta expiresAt={value} now={NOW} locale="en-US" />)).toBe(
        '',
      );
      expect(renderToString(<RfqValidityMeta expiresAt={value} now={NOW} locale="pl-PL" />)).toBe(
        '',
      );
    }
  });
});

describe('RfqValidityNotice', () => {
  function noticeFor(
    status: Parameters<typeof rfqValidityGate>[0]['status'],
    awaiting: boolean,
    expiresAt: string | null,
    locale = 'en-US',
  ): string {
    const gate = rfqValidityGate({
      status,
      awaitingCustomerRevisionAcceptance: awaiting,
      validity: rfqValidity(expiresAt, NOW),
    });
    return renderToString(
      <RfqValidityNotice noticeKey={gate.noticeKey} id="rfq-validity-notice" locale={locale} />,
    );
  }

  it('names the consequence and the remedy for a lapsed offer', () => {
    const html = noticeFor('Pending', true, PAST);
    expect(html).toContain('validity period has ended');
    expect(html).toContain('Submit the request again');
    // The id the disabled control points at with `aria-describedby`.
    expect(html).toContain('id="rfq-validity-notice"');
  });

  it('tells an approved buyer the deadline cannot be moved, and what to do instead', () => {
    const html = noticeFor('Approved', false, PAST);
    expect(html).toContain('can no longer be turned into an order');
    expect(html).toContain('deadline can no longer be moved');
    expect(html).toContain('submit the request again');
  });

  it('ships both sentences in Polish', () => {
    expect(noticeFor('Pending', true, PAST, 'pl-PL')).toContain('Okres ważności tej oferty minął');
    expect(noticeFor('Approved', false, PAST, 'pl-PL')).toContain(
      'Zaakceptowana oferta straciła ważność',
    );
  });

  it('renders nothing while the deadline is ahead, and nothing when there is none', () => {
    expect(noticeFor('Pending', true, FUTURE)).toBe('');
    expect(noticeFor('Approved', false, FUTURE)).toBe('');
    expect(noticeFor('Pending', true, null)).toBe('');
    expect(noticeFor('Approved', false, null)).toBe('');
  });

  it('renders nothing on a status the deadline decides nothing for', () => {
    expect(noticeFor('Completed', false, PAST)).toBe('');
    expect(noticeFor('Canceled', false, PAST)).toBe('');
  });
});
