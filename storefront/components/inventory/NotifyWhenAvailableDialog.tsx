'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { publicApiBaseUrl } from '../../lib/env.mjs';

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
}

export function NotifyWhenAvailableDialog(props: {
  productId: string;
  variantId?: string | null;
  defaultEmail?: string | null;
  labels: Labels;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(props.defaultEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogId = useId();

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/storefront/inventory/notify-when-available`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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

  if (!open) {
    return (
      <button
        type="button"
        className="b2b-cta b2b-cta--secondary"
        onClick={(): void => setOpen(true)}
      >
        {props.labels.cta}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      className="industria-notify-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.55)',
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: 'var(--surface, #fff)',
          color: 'var(--fg, #111)',
          maxWidth: 460,
          width: '90%',
          padding: 24,
          borderRadius: 8,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        }}
      >
        <h2 id={`${dialogId}-title`} style={{ marginTop: 0, fontSize: 18 }}>
          {props.labels.dialogTitle}
        </h2>
        {success ? (
          <p style={{ marginTop: 16 }}>{props.labels.success}</p>
        ) : (
          <form onSubmit={(e): void => { void handleSubmit(e); }}>
            <div className="b2b-auth__field">
              <label htmlFor={`${dialogId}-email`}>
                {props.labels.emailLabel}
              </label>
              <input
                id={`${dialogId}-email`}
                type="email"
                required
                autoFocus
                placeholder=" "
                value={email}
                onChange={(e): void => setEmail(e.target.value)}
              />
            </div>
            {error ? (
              <p
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: 'var(--danger, #b00020)',
                }}
              >
                {error}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                className="b2b-btn b2b-btn--ghost"
                onClick={(): void => setOpen(false)}
                disabled={submitting}
              >
                {props.labels.cancel}
              </button>
              <button
                type="submit"
                className="b2b-cta"
                disabled={submitting || !email}
              >
                {submitting ? props.labels.submitting : props.labels.submit}
              </button>
            </div>
          </form>
        )}
        {success ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              className="b2b-btn b2b-btn--ghost"
              onClick={(): void => setOpen(false)}
            >
              {props.labels.cancel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
