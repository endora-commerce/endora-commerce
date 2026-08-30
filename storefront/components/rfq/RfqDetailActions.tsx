import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import type { RfqStatus } from '../../lib/api/rfq';
import type { RfqValidityGate } from '../../lib/quote-requests/validity';
import { RfqValidityNotice } from './RfqValidityNotice';

/**
 * The action row on the buyer's quote-request detail, lifted out of the page so
 * the one thing this change is about — which controls refuse to be pressed, and
 * whether the reason is on screen beside them — is assertable from rendered
 * markup. The page itself is an async Server Component that reads a session and
 * calls the API, and the storefront harness is SSR-only.
 *
 * Presentational and pure: the four server actions arrive as props, exactly as
 * `CartApprovalBanner` takes its own.
 *
 * The order inside it is the owner's decision of 2026-08-29 read at the level
 * of one component: the notice comes **before** the controls it disables, so
 * the buyer reads why before they meet the inert button. A `disabled` button is
 * out of the tab order and announces nothing (!1141 found the same on the
 * operator's screen), so the sentence cannot live on the control — it lives
 * next to it, and the control points at it with `aria-describedby`.
 */
export interface RfqDetailActionsProps {
  rfqId: string;
  status: RfqStatus;
  currentRevisionNumber: number;
  awaitingCustomerRevisionAcceptance: boolean;
  /** What the validity deadline currently refuses, and the sentence for it. */
  gate: RfqValidityGate;
  locale: string;
  acceptAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
  convertAction: (formData: FormData) => Promise<void>;
  resubmitAction: (formData: FormData) => Promise<void>;
}

const NOTICE_ID = 'rfq-validity-notice';

export function RfqDetailActions({
  rfqId,
  status,
  currentRevisionNumber,
  awaitingCustomerRevisionAcceptance,
  gate,
  locale,
  acceptAction,
  rejectAction,
  convertAction,
  resubmitAction,
}: RfqDetailActionsProps): ReactNode {
  const t = tForLocale(locale);
  /**
   * Resubmit is the remedy both blocked sentences name, and !1137 leaves it
   * ungated deliberately — it raises a new request at current prices, carrying
   * no deadline. When the deadline has taken the primary action away it becomes
   * the primary action itself, so the view keeps exactly one filled button and
   * that button points at the one thing that works (Von Restorff). Until then
   * it stays subordinate to Accept or Place order.
   */
  const anythingBlocked = gate.acceptBlocked || gate.convertBlocked;

  return (
    <>
      <RfqValidityNotice noticeKey={gate.noticeKey} id={NOTICE_ID} locale={locale} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {awaitingCustomerRevisionAcceptance ? (
          <>
            <form action={acceptAction}>
              <input type="hidden" name="rfqId" value={rfqId} />
              <input type="hidden" name="expectedRevisionNumber" value={currentRevisionNumber} />
              <button
                type="submit"
                className="btn btn--dark"
                disabled={gate.acceptBlocked}
                aria-describedby={gate.acceptBlocked ? NOTICE_ID : undefined}
              >
                Akceptuj wersję
              </button>
            </form>
            {/*
              Reject is never gated. !1137 refuses it nowhere: declining a
              lapsed offer consumes no price the seller committed to, and
              refusing it would leave the buyer no way to clear a row they have
              already been told is dead.
            */}
            <form action={rejectAction} style={{ display: 'flex', gap: 8 }}>
              <input type="hidden" name="rfqId" value={rfqId} />
              <input type="hidden" name="expectedRevisionNumber" value={currentRevisionNumber} />
              <input
                type="text"
                name="reason"
                placeholder="Powód odrzucenia (opcjonalny)"
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  padding: '8px 10px',
                  width: 240,
                }}
              />
              <button type="submit" className="btn btn--outline">
                Odrzuć
              </button>
            </form>
          </>
        ) : null}

        {status === 'Approved' ? (
          <form action={convertAction}>
            <input type="hidden" name="rfqId" value={rfqId} />
            <button
              type="submit"
              className="btn btn--dark"
              disabled={gate.convertBlocked}
              aria-describedby={gate.convertBlocked ? NOTICE_ID : undefined}
            >
              Złóż zamówienie z tej oferty
            </button>
          </form>
        ) : null}

        <form action={resubmitAction}>
          <input type="hidden" name="rfqId" value={rfqId} />
          <button type="submit" className={anythingBlocked ? 'btn btn--dark' : 'btn btn--outline'}>
            {t('quoteRequests.resubmit')}
          </button>
        </form>
      </div>
    </>
  );
}
