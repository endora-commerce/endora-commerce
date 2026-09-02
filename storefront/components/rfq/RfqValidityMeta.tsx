import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import {
  formatValidityInstant,
  rfqValidity,
  validityLabelKey,
  type RfqValidity,
} from '../../lib/quote-requests/validity';

/**
 * The validity deadline as one short sentence — the fact, before any refusal.
 *
 * Used twice on purpose: in the detail page's header meta, beside "created" and
 * "submitted", and in the list row under the status badge. Both are the places
 * the buyer already looks for when-things-happened, so the deadline reads as
 * another instant of the same kind (Law of Proximity) rather than as an alert.
 *
 * **It renders nothing at all when there is no deadline.** A dash, an em-dash
 * or an empty cell would put a blank where a date goes, and a buyer cannot tell
 * a blank apart from a date the page failed to load. An absent `expiresAt`
 * means the operator set none and nothing refuses this buyer, so there is
 * nothing to say — which is why this is a component that may return `null` and
 * not a table column that must always be filled.
 *
 * A lapsed deadline is marked by its own **wording**, not by colour: "Validity
 * ended <date>" is a different sentence from "Valid until <date>", so the state
 * survives a monochrome render and a screen reader (WCAG 2.2 AA, 1.4.1). What
 * carries it visually is weight and value — full `--ink-900` at 600 against the
 * `.muted` meta line around it — and deliberately not a hue: this line sits on
 * `--surface`, which flips under `:root.is-dark`, while `--warn-700` does not,
 * and amber on the dark surface measures 3.5:1. The notice below the buttons
 * can use the warn ramp because both its foreground and its background are
 * static, so its contrast is the same in either theme.
 */
export interface RfqValidityMetaProps {
  /** ISO-8601 `expiresAt` off `RfqDetail` / `RfqSummary`; `null` means none. */
  expiresAt: string | null | undefined;
  /**
   * The instant the classification is made against. The caller passes the
   * *server's* clock — these are Server Components, so the buyer's own clock
   * never enters, and a machine whose time is wrong cannot be told its offer
   * has lapsed when the API would still accept it.
   */
  now: Date;
  /** Active storefront locale; resolves the PL/EN copy and the date format. */
  locale: string;
  /**
   * `block` in a table cell, `inline` inside a running meta sentence.
   *
   * The inline form prints its own ` · ` separator. The caller cannot: it would
   * have to repeat the "is there a deadline at all" test this component already
   * makes, and two copies of that predicate are two things to keep in step.
   */
  display?: 'inline' | 'block';
}

export function RfqValidityMeta({
  expiresAt,
  now,
  locale,
  display = 'inline',
}: RfqValidityMetaProps): ReactNode {
  const validity: RfqValidity = rfqValidity(expiresAt, now);
  const labelKey = validityLabelKey(validity);
  if (labelKey === null || validity.kind === 'none') return null;

  const t = tForLocale(locale);
  const block = display === 'block';
  return (
    <span
      style={{
        display: block ? 'block' : 'inline',
        // The block form is a second line in a table cell and carries its own
        // spacing, so the cell holds no element at all when there is no
        // deadline — an always-rendered wrapper would put four pixels of dead
        // space in every undated row.
        marginTop: block ? 4 : undefined,
        fontSize: block ? 12 : undefined,
        color: validity.kind === 'lapsed' ? 'var(--ink-900)' : undefined,
        fontWeight: validity.kind === 'lapsed' ? 600 : undefined,
      }}
    >
      {block ? null : ' · '}
      {t(labelKey)}
      <time dateTime={validity.expiresAt}>
        {formatValidityInstant(validity.expiresAt, locale)}
      </time>
    </span>
  );
}
