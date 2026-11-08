'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { publicApiBaseUrl } from '../../lib/env.mjs';
import { channelHeaders } from '../../lib/channel/channel-header';
import { ModalDialog, ModalDialogClose } from '../ModalDialog';

/**
 * NotifyWhenAvailableDialog — feature 010 / US6.
 *
 * Shown on the PDP for products that are out of stock, do NOT have
 * `backorderEnabled = true`, and DO have `manageStock = true`. The
 * email is pre-filled when the customer is signed in (the parent
 * server component passes the customer-account email via the
 * `defaultEmail` prop); anonymous callers type their own email.
 *
 * Posts to `/api/v1/storefront/inventory/notify-when-available` directly
 * — the cart's session cookie rides along automatically when present
 * so the backend can attach the row to the customer account.
 *
 * `salesChannelCode` is not optional decoration, for the reason
 * `quick-order.ts`' type-ahead gives about its own `ctx`: the backend narrows
 * this seam to the resolved sales channel, and a browser request that names no
 * channel is answered from the system default rather than from the one the
 * buyer is shopping. This component posts from the browser, so nothing on the
 * server side can stamp the header for it — the page that renders it knows the
 * channel and hands it down.
 *
 * The dialog is `ModalDialog` (issue #804): focus trap, Escape, focus back on
 * the trigger, and focus opening on the e-mail field. The actions sit in the
 * dialog's footer and submit the form through its `form` attribute; while the
 * post is in flight the dialog cannot be dismissed. The outcome — the
 * backend's refusal or the confirmation — is announced through a status region
 * mounted with the dialog, and on success focus moves to the one control left.
 */

const apiBase = publicApiBaseUrl();

interface Labels {
  cta: string;
  dialogTitle: string;
  emailLabel: string;
  submit: string;
  submitting: string;
  success: string;
  errorGeneric: string;
  cancel: string;
  /** The close button's accessible name, and the one button left after a sign-up. */
  close: string;
}

export function NotifyWhenAvailableDialog(props: {
  productId: string;
  variantId?: string | null;
  defaultEmail?: string | null;
  /** The channel this page was rendered for, forwarded as `X-Sales-Channel`. Required. */
  salesChannelCode: string | undefined;
  labels: Labels;
}): ReactNode {
  const [email, setEmail] = useState(props.defaultEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const formId = `${id}-form`;
  const emailId = `${id}-email`;
  const errorId = `${id}-error`;

  useEffect(() => {
    // The submit button the buyer pressed is gone with the form; keep focus inside the dialog.
    if (success) doneRef.current?.focus();
  }, [success]);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/storefront/inventory/notify-when-available`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...channelHeaders(props.salesChannelCode),
        },
        body: JSON.stringify({
          productId: props.productId,
          email,
          ...(props.variantId ? { variantId: props.variantId } : {}),
        }),
      });
      if (!res.ok && res.status !== 202) {
        const envelope = (await res.json().catch(() => null)) as
          | { error: { message?: string } }
          | null;
        throw new Error(envelope?.error?.message ?? props.labels.errorGeneric);
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : props.labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      triggerLabel={props.labels.cta}
      triggerClassName="btn btn--outline h-[40px] w-full justify-center md:w-auto"
      title={props.labels.dialogTitle}
      closeLabel={props.labels.close}
      dismissible={!submitting}
      footer={
        success ? (
          <ModalDialogClose ref={doneRef} className="btn btn--outline">
            {props.labels.close}
          </ModalDialogClose>
        ) : (
          <>
            <ModalDialogClose className="btn btn--outline" disabled={submitting}>
              {props.labels.cancel}
            </ModalDialogClose>
            <button
              type="submit"
              className="btn btn--primary"
              form={formId}
              disabled={submitting || !email}
              aria-busy={submitting || undefined}
            >
              {submitting ? props.labels.submitting : props.labels.submit}
            </button>
          </>
        )
      }
    >
      {success ? null : (
        <form id={formId} onSubmit={(e): void => { void handleSubmit(e); }}>
          <div className="b2b-auth__field">
            <label htmlFor={emailId}>{props.labels.emailLabel}</label>
            <input
              id={emailId}
              type="email"
              required
              data-autofocus=""
              placeholder=" "
              value={email}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e): void => setEmail(e.target.value)}
            />
          </div>
        </form>
      )}
      <div role="status">
        {success ? (
          <p className="m-0">{props.labels.success}</p>
        ) : error ? (
          <p id={errorId} className="mt-2 mb-0 text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
