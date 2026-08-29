import type { ReactNode } from 'react';
import { tForLocale, type MessageKey } from '../../lib/i18n/messages';

/**
 * Why the action the buyer came here to take is refused, and what to do
 * instead.
 *
 * It sits **directly above the action row**, not at the top of the page. The
 * control it explains is `disabled`, which removes it from the tab order and
 * makes it announce nothing at all — !1141 found the same thing on the
 * operator's screen — so the reason cannot live on the control and must live in
 * visible text next to it (Law of Proximity: the explanation is grouped with
 * the buttons it is about, not with the header). The disabled buttons point at
 * it with `aria-describedby`, so a reader browsing the form still reaches the
 * sentence from the control.
 *
 * The date itself is *not* repeated here — the header meta line has already
 * said it, unconditionally, and this is the consequence and the remedy. That
 * ordering is the owner's decision of 2026-08-29: render the date first, then
 * disable.
 *
 * Warn rather than bad: nothing is broken and nobody did anything wrong. A
 * window closed, and the sentence names the way forward (`resubmit`), which is
 * the one customer path !1137 deliberately left ungated.
 */
export interface RfqValidityNoticeProps {
  /** The sentence to render; `null` renders nothing (Tesler — the caller may pass the gate's answer straight through). */
  noticeKey: MessageKey | null;
  /** DOM id the disabled controls reference with `aria-describedby`. */
  id: string;
  locale: string;
}

export function RfqValidityNotice({ noticeKey, id, locale }: RfqValidityNoticeProps): ReactNode {
  if (noticeKey === null) return null;
  const t = tForLocale(locale);
  return (
    <p
      id={id}
      role="status"
      style={{
        background: 'var(--warn-50)',
        color: 'var(--warn-700)',
        border: '1px solid var(--warn-100)',
        borderRadius: 'var(--r-sm)',
        padding: '10px 12px',
        marginBottom: 12,
        fontSize: 13,
        maxWidth: 640,
      }}
    >
      {t(noticeKey)}
    </p>
  );
}
