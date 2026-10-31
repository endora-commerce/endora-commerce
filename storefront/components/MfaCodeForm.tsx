import type { ReactNode } from 'react';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Presentational second-step code form (feature 042, US1). Resembles the login
 * screen (Principle IX). Accepts a server action and an optional error; used by
 * the storefront `/login/mfa` page.
 */
export function MfaCodeForm({
  action,
  next,
  error,
  locale,
}: {
  action: (formData: FormData) => void | Promise<void>;
  next: string;
  error?: string | undefined;
  /** The page's language, from the server component that renders the form. */
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth">
      <h1>{t('auth.mfa.heading')}</h1>
      <p>{t('auth.mfa.intro')}</p>
      {error ? (
        <div className="b2b-auth__error" role="alert">
          {error}
        </div>
      ) : null}
      <form action={action} className="b2b-auth__form">
        <input type="hidden" name="next" value={next} />
        <div className="b2b-auth__field">
          <label htmlFor="mfa-code">{t('auth.mfa.codeLabel')}</label>
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
          <button type="submit">{t('auth.mfa.submit')}</button>
        </div>
      </form>
    </div>
  );
}
