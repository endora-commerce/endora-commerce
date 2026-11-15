'use client';

import {
  createContext,
  useActionState,
  useContext,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { Spinner } from './PlaceOrderButton';

/**
 * Checkout coupon control (feature 036, US3). The code is applied to the **cart** (the source
 * of truth `placeOrder` reads), so the discount is reflected in the order summary before the
 * buyer places the order.
 *
 * Issue #1250 — the control is **not part of the checkout form**. Its buttons used to submit
 * that form to the coupon actions, and the form reset after the action and the reload after it
 * took the address, the methods and the note the buyer had entered with them. Its fields now
 * belong, through the `form` attribute, to a form of their own that `CouponScope` renders
 * *after* the checkout form (forms cannot nest, and the control stays where the buyer reads it).
 * That form's action answers a `CouponActionState` instead of redirecting and revalidates
 * checkout, so the totals re-render in the same response while the checkout form — which the
 * coupon form's reset does not reach — keeps everything.
 *
 * Without JavaScript the coupon form still posts on its own and the page renders the result.
 */
export const COUPON_FORM_ID = 'checkout-coupon';

/** What the coupon action answers; `message` is worded by the page, never read from a URL. */
export interface CouponActionState {
  outcome: 'idle' | 'applied' | 'removed' | 'rejected';
  /** The code the input shows after the action: the one entered, or none once removed. */
  code: string;
  message: string | null;
}

export type CouponAction = (
  prev: CouponActionState | null,
  formData: FormData,
) => Promise<CouponActionState>;

interface CouponContextValue {
  state: CouponActionState | null;
  pending: boolean;
}

const CouponContext = createContext<CouponContextValue>({ state: null, pending: false });

/**
 * Holds the coupon action's state for the `CouponField` inside `children`, and renders the
 * coupon `<form>` after them — outside the checkout form `children` contains.
 */
export function CouponScope({
  action,
  children,
}: {
  action: CouponAction;
  children: ReactNode;
}): ReactNode {
  const [state, dispatch, pending] = useActionState(action, null);
  return (
    <CouponContext.Provider value={{ state, pending }}>
      {children}
      <form id={COUPON_FORM_ID} action={dispatch} />
    </CouponContext.Provider>
  );
}

export interface CouponFieldProps {
  applied: { code: string | null; amount: number; currency: string } | null;
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
}

const STATUS_ID = 'couponCode-status';
const ERROR_ID = 'couponCode-error';

export function CouponField({ applied, locale }: CouponFieldProps): ReactNode {
  const t = tForLocale(locale);
  const { state, pending } = useContext(CouponContext);
  const [pressed, setPressed] = useState<'apply' | 'remove' | null>(null);
  const error = state?.outcome === 'rejected' ? state.message : null;
  const removed = applied === null && state?.outcome === 'removed';
  const describedBy = error ? `${STATUS_ID} ${ERROR_ID}` : STATUS_ID;
  // `aria-disabled` rather than `disabled` while in flight: a disabled button drops the focus
  // the buyer pressed it with. The second press is swallowed here instead.
  const press = (intent: 'apply' | 'remove') => (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    setPressed(intent);
  };
  return (
    <div aria-busy={pending || undefined}>
      <label
        htmlFor="couponCode"
        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted"
      >
        {t('checkout.coupon.label')}
      </label>
      <div className="flex gap-1.5">
        <input
          id="couponCode"
          name="couponCode"
          form={COUPON_FORM_ID}
          maxLength={64}
          defaultValue={state ? state.code : (applied?.code ?? '')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="h-[40px] min-w-0 flex-1 rounded-sm border border-line bg-surface px-[12px] text-[14px] text-fg outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-[color:var(--brand-600)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.16)]"
        />
        <button
          type="submit"
          form={COUPON_FORM_ID}
          name="couponIntent"
          value="apply"
          aria-disabled={pending || undefined}
          onClick={press('apply')}
          className="btn btn--dark shrink-0"
        >
          {pending && pressed === 'apply' ? <Spinner /> : null}
          {t('checkout.coupon.apply')}
        </button>
      </div>

      {/* Mounted before it has text, so the result is announced (WCAG 4.1.3). */}
      <div
        className={
          applied || removed
            ? 'b2b-auth__success mt-2 flex flex-wrap items-center gap-2'
            : undefined
        }
      >
        <p id={STATUS_ID} role="status" className="m-0">
          {applied ? (
            <>
              {t('checkout.coupon.appliedPrefix')}
              <strong>{applied.code}</strong>{' '}
              {`${t('checkout.coupon.appliedSuffix')}−${applied.amount.toFixed(2)} ${applied.currency}`}
            </>
          ) : removed ? (
            t('checkout.coupon.removed')
          ) : null}
        </p>
        {applied ? (
          <button
            type="submit"
            form={COUPON_FORM_ID}
            name="couponIntent"
            value="remove"
            aria-disabled={pending || undefined}
            onClick={press('remove')}
            className="btn btn--ghost btn--sm"
          >
            {pending && pressed === 'remove' ? <Spinner /> : null}
            {t('checkout.coupon.remove')}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={ERROR_ID} role="alert" className="b2b-auth__error mt-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}
