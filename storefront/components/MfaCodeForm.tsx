import type { ReactNode } from 'react';

/**
 * Presentational second-step code form (feature 042, US1). Resembles the login
 * screen (Principle IX). Accepts a server action and an optional error; used by
 * the storefront `/login/mfa` page.
 */
export function MfaCodeForm({
  action,
  next,
  error,
}: {
  action: (formData: FormData) => void | Promise<void>;
  next: string;
  error?: string | undefined;
}): ReactNode {
  return (
    <div className="b2b-auth">
      <h1>Two-step verification</h1>
      <p>Enter the 6-digit code from your authenticator app, or a recovery code.</p>
      {error ? <div className="b2b-auth__error">{error}</div> : null}
      <form action={action} className="b2b-auth__form">
        <input type="hidden" name="next" value={next} />
        <div className="b2b-auth__field">
          <label htmlFor="mfa-code">Authentication code</label>
          <input
            id="mfa-code"
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Verify</button>
        </div>
      </form>
    </div>
  );
}
