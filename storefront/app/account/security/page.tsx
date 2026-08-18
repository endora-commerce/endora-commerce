import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  activateMfa,
  disableMfa,
  getMfaStatus,
  regenerateMfaRecoveryCodes,
  startMfaSetup,
} from '../../../lib/api/mfa';
import { StorefrontApiError } from '../../../lib/api/client';
import { getServerContext } from '../../../lib/server-context';
import {
  clearMfaSetupCookie,
  getMfaSetupCookie,
  getSessionCookie,
  readAndClearMfaRecoveryFlash,
  setMfaRecoveryFlash,
  setMfaSetupCookie,
} from '../../../lib/session';

/**
 * Storefront account security page (feature 042, US1). Lets a customer enable
 * TOTP 2FA (scan → confirm → save recovery codes), disable it, and regenerate
 * recovery codes. Multi-step state is carried in short-lived httpOnly cookies
 * so the flow survives the server-action round-trips.
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/security');

  // Constitution XVII item 5 — this whole page is `mfa`'s contribution to the
  // storefront, so it goes when the module does. Without this it kept offering
  // "Enable 2FA" for a capability that was switched off, and every server
  // action below answered 503 on the click. Absence is projected rather than
  // inferred from that 503: the page is not rendered at all.
  const { modules } = await getServerContext();
  if (!modules.isPresent('mfa')) notFound();

  const params = await searchParams;

  const status = await getMfaStatus(session);
  const recoveryFlash = await readAndClearMfaRecoveryFlash();

  return (
    <div className="b2b-auth">
      <h1>Account security</h1>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}

      {recoveryFlash ? <RecoveryCodes codes={recoveryFlash} /> : null}

      {status.totpActive ? (
        <ActivePanel remaining={status.recoveryCodesRemaining} />
      ) : params.step === 'confirm' ? (
        await ConfirmPanel()
      ) : (
        <StartPanel />
      )}
    </div>
  );
}

function StartPanel(): ReactNode {
  return (
    <section>
      <h2>Two-factor authentication</h2>
      <p>Add a second step to your sign-in using an authenticator app.</p>
      <form action={startAction}>
        <button type="submit">Enable 2FA</button>
      </form>
    </section>
  );
}

async function ConfirmPanel(): Promise<ReactNode> {
  const setup = await getMfaSetupCookie();
  if (!setup) {
    redirect('/account/security');
  }
  return (
    <section>
      <h2>Scan and confirm</h2>
      <p>Scan this setup link in your authenticator app, or enter the key manually:</p>
      <p>
        <code>{setup.otpauthUri}</code>
      </p>
      <p>
        Manual key: <code>{setup.secret}</code>
      </p>
      <form action={confirmAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="confirm-code">6-digit code</label>
          <input
            id="confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="123456"
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Confirm and enable</button>
        </div>
      </form>
    </section>
  );
}

function ActivePanel({ remaining }: { remaining: number }): ReactNode {
  return (
    <section>
      <h2>Two-factor authentication is on</h2>
      <p>Unused recovery codes remaining: {remaining}</p>
      <form action={disableAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="disable-code">Enter a current code to turn off 2FA</label>
          <input id="disable-code" name="code" autoComplete="one-time-code" required placeholder="123456" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Disable 2FA</button>
        </div>
      </form>
      <form action={regenerateAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="regen-code">Enter a current code to regenerate recovery codes</label>
          <input id="regen-code" name="code" inputMode="numeric" required placeholder="123456" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Regenerate recovery codes</button>
        </div>
      </form>
    </section>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }): ReactNode {
  return (
    <section className="b2b-auth__recovery">
      <h2>Save your recovery codes</h2>
      <p>Each code works once. Store them somewhere safe — they are shown only now.</p>
      <ul>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function startAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/security');
  try {
    const { secret, otpauthUri } = await startMfaSetup(session);
    await setMfaSetupCookie({ secret, otpauthUri });
  } catch (err) {
    redirect(`/account/security?error=${encodeURIComponent(errMsg(err))}`);
  }
  redirect('/account/security?step=confirm');
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    const { recoveryCodes } = await activateMfa(session, code);
    await clearMfaSetupCookie();
    await setMfaRecoveryFlash(recoveryCodes);
  } catch (err) {
    redirect(`/account/security?step=confirm&error=${encodeURIComponent(errMsg(err))}`);
  }
  redirect('/account/security');
}

async function disableAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    await disableMfa(session, code);
  } catch (err) {
    redirect(`/account/security?error=${encodeURIComponent(errMsg(err))}`);
  }
  redirect('/account/security');
}

async function regenerateAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/security');
  const code = ((formData.get('code') as string) ?? '').trim();
  try {
    const { recoveryCodes } = await regenerateMfaRecoveryCodes(session, code);
    await setMfaRecoveryFlash(recoveryCodes);
  } catch (err) {
    redirect(`/account/security?error=${encodeURIComponent(errMsg(err))}`);
  }
  redirect('/account/security');
}

function errMsg(err: unknown): string {
  return err instanceof StorefrontApiError ? err.detail : 'Something went wrong. Please try again.';
}
