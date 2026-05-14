import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useAppLanguage } from '@/i18n/app-language-context';
import { setPreferredLanguage } from '@/i18n/language-storage';
import { useTranslation } from '@/i18n/useTranslation';
import type { SupportedAdminLanguage } from '@/i18n/types';

/**
 * ProfilePage — feature 010 admin polish.
 *
 * Self-edit form for the logged-in admin user. Hits
 * `PATCH /api/v1/admin/me`, which any authenticated admin can call
 * without holding `admin_users:manage`. Linked from the avatar in the
 * top-right corner of the AppShell.
 */
export function ProfilePage(): ReactNode {
  const t = useTranslation('core');
  const { me, refresh } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setFirstName(me.adminUser.firstName);
      setLastName(me.adminUser.lastName);
    }
  }, [me]);

  if (!me) {
    return <div className="b2b-page">{t('profile.loading')}</div>;
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const body: Record<string, unknown> = {};
      if (firstName !== me.adminUser.firstName) body['firstName'] = firstName;
      if (lastName !== me.adminUser.lastName) body['lastName'] = lastName;
      if (password.trim().length > 0) body['password'] = password;
      if (Object.keys(body).length === 0) {
        setInfo(t('profile.info.nothingToSave'));
        setSubmitting(false);
        return;
      }
      await apiClient.patch<unknown>('/api/v1/admin/me', body);
      setPassword('');
      setInfo(t('profile.info.updated'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('profile.error.save'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-page">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('profile.page.title')}</div>
          <div className="b2b-page-head__sub">
            {t('profile.page.descriptionPrefix')} <code className="b2b-mono">admin_users:manage</code> {t('profile.page.descriptionSuffix')}
          </div>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}
      {info ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(142 50% 80%)',
          }}
        >
          {info}
        </div>
      ) : null}

      <form onSubmit={(e): void => { void handleSubmit(e); }}>
        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>{t('profile.identityTitle')}</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-grid b2b-grid--cols-2">
              <div>
                <label className="b2b-label" htmlFor="me-email">{t('profile.field.email')}</label>
                <input
                  id="me-email"
                  className="b2b-field"
                  value={me.adminUser.email}
                  disabled
                />
                <div className="b2b-help">{t('profile.emailHelp')}</div>
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-role">{t('profile.field.role')}</label>
                <input
                  id="me-role"
                  className="b2b-field"
                  value={me.role?.name ?? '—'}
                  disabled
                />
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-first">{t('profile.field.firstName')}</label>
                <input
                  id="me-first"
                  className="b2b-field"
                  value={firstName}
                  onChange={(e): void => setFirstName(e.target.value)}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-last">{t('profile.field.lastName')}</label>
                <input
                  id="me-last"
                  className="b2b-field"
                  value={lastName}
                  onChange={(e): void => setLastName(e.target.value)}
                  required
                  maxLength={120}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>{t('profile.changePassword')}</h2></div>
          <div className="b2b-card__body">
            <div>
              <label className="b2b-label" htmlFor="me-pwd">{t('profile.field.newPassword')}</label>
              <input
                id="me-pwd"
                className="b2b-field"
                type="password"
                value={password}
                onChange={(e): void => setPassword(e.target.value)}
                minLength={12}
                maxLength={120}
                autoComplete="new-password"
                placeholder={t('profile.field.newPasswordPlaceholder')}
              />
              <div className="b2b-help">{t('profile.field.newPasswordHelp')}</div>
            </div>
          </div>
        </div>

        <div className="b2b-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="submit" className="b2b-btn b2b-btn--primary" disabled={submitting}>
            {submitting ? t('profile.saving') : t('profile.saveChanges')}
          </button>
        </div>
      </form>

      <LanguageSection />
    </div>
  );
}

/**
 * Language section — feature 019 / FR-002, FR-004, FR-005, FR-006.
 *
 * Self-service language picker. Calls
 * `PATCH /api/v1/admin/me/preferred-language` and flips the
 * `<TranslationProvider>` language at the App scope so every screen
 * re-renders without sign-out.
 */
function LanguageSection(): ReactNode {
  const t = useTranslation('core');
  const { language, setLanguage } = useAppLanguage();
  const { refresh } = useAuth();
  const [pending, setPending] = useState<SupportedAdminLanguage>(language);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPending(language);
  }, [language]);

  const handleSave = async (): Promise<void> => {
    if (pending === language) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    const previous = language;
    setLanguage(pending);
    try {
      await setPreferredLanguage(pending);
      await refresh();
      setInfo(t('profilePage.language.saved'));
    } catch (err) {
      setLanguage(previous);
      setPending(previous);
      const message =
        err instanceof ApiError
          ? err.envelope.error.message
          : t('profilePage.language.failed');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-card" style={{ marginTop: 16 }}>
      <div className="b2b-card__head">
        <h2>{t('profilePage.section.language')}</h2>
      </div>
      <div className="b2b-card__body">
        <p className="b2b-help" style={{ marginBottom: 12 }}>
          {t('profilePage.section.language.help')}
        </p>
        {error ? (
          <div
            className="b2b-card"
            style={{
              background: 'var(--danger-soft)',
              color: 'var(--danger-soft-fg)',
              padding: 12,
              marginBottom: 12,
              border: '1px solid hsl(8 80% 85%)',
            }}
          >
            {error}
          </div>
        ) : null}
        {info ? (
          <div
            className="b2b-card"
            style={{
              background: 'var(--success-soft)',
              color: 'var(--success-soft-fg)',
              padding: 12,
              marginBottom: 12,
              border: '1px solid hsl(142 50% 80%)',
            }}
          >
            {info}
          </div>
        ) : null}
        <div className="b2b-row" style={{ gap: 12, alignItems: 'center' }}>
          <select
            className="b2b-field"
            value={pending}
            onChange={(e): void =>
              setPending(e.target.value as SupportedAdminLanguage)
            }
            style={{ maxWidth: 240 }}
          >
            <option value="en">{t('profilePage.language.option.en')}</option>
            <option value="pl">{t('profilePage.language.option.pl')}</option>
          </select>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            disabled={submitting || pending === language}
            onClick={(): void => {
              void handleSave();
            }}
          >
            {submitting
              ? t('common.state.loading')
              : t('profilePage.language.action.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
