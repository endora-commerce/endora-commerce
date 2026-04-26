import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../../lib/session';
import { getMe, enableTwoFactor, confirmTwoFactor, disableTwoFactor } from '../../../../lib/api/account';
import { StorefrontApiError } from '../../../../lib/api/client';

/**
 * Two-factor enrolment (T154 / FR-040). Three flows on one page:
 *   - "enable" issues a fresh TOTP secret + backup codes (Pass 1 of enrolment).
 *   - "confirm" submits the first valid code, marking 2FA as confirmed (Pass 2).
 *   - "disable" requires the current code to turn 2FA off.
 *
 * Secrets are revealed exactly once via the URL state machine —
 * `?stage=enrolling` carries the otpauth URI in the query string only on
 * the same response that issued it. We deliberately don't persist it in
 * any client storage.
 */

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; otpauth?: string; backups?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const me = await getMe(session);
  const params = await searchParams;
  const stage = params.stage;

  return (
    <>
      <h2>Two-factor authentication</h2>
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      {me.customerAccount.twoFactorEnabled ? (
        <DisableForm />
      ) : stage === 'enrolling' ? (
        <ConfirmForm
          otpauth={params.otpauth ?? ''}
          backups={params.backups ? params.backups.split(',') : []}
        />
      ) : (
        <EnableForm />
      )}
    </>
  );
}

function EnableForm(): ReactNode {
  return (
    <>
      <p>Add a second factor (TOTP) to your account.</p>
      <form action={enableAction}>
        <button type="submit">Begin enrolment</button>
      </form>
    </>
  );
}

function ConfirmForm({ otpauth, backups }: { otpauth: string; backups: string[] }): ReactNode {
  return (
    <>
      <p className="b2b-auth__success">
        Scan this URI in your authenticator app, then enter the code it shows.
      </p>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{otpauth}</pre>
      {backups.length > 0 ? (
        <>
          <p>
            <strong>Backup codes</strong> — store these somewhere safe. Each one works once if
            you lose your authenticator.
          </p>
          <ul>
            {backups.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <form action={confirmAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="totp-code">Code from your app</label>
          <input
            id="totp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            minLength={4}
            maxLength={64}
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Confirm</button>
        </div>
      </form>
    </>
  );
}

function DisableForm(): ReactNode {
  return (
    <>
      <p>Two-factor is currently <strong>enabled</strong>. Enter a current code to disable it.</p>
      <form action={disableAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="disable-code">Code from your app</label>
          <input
            id="disable-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            minLength={4}
            maxLength={64}
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Disable</button>
        </div>
      </form>
    </>
  );
}

async function enableAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    const enrolment = await enableTwoFactor(session);
    redirect(
      `/account/two-factor?stage=enrolling&otpauth=${encodeURIComponent(enrolment.otpauthUri)}&backups=${encodeURIComponent(enrolment.backupCodes.join(','))}`,
    );
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not start two-factor enrolment.';
    redirect(`/account/two-factor?error=${encodeURIComponent(message)}`);
  }
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const code = (formData.get('code') as string) ?? '';
  try {
    await confirmTwoFactor(session, code);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'That code did not match.';
    redirect(`/account/two-factor?error=${encodeURIComponent(message)}`);
  }
  redirect(`/account/two-factor`);
}

async function disableAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const code = (formData.get('code') as string) ?? '';
  try {
    await disableTwoFactor(session, code);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not disable two-factor.';
    redirect(`/account/two-factor?error=${encodeURIComponent(message)}`);
  }
  redirect(`/account/two-factor`);
}
