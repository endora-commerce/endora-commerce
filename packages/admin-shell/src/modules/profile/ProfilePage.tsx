import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import {
  useAppLanguage,
  setPreferredLanguage,
  useTranslation,
} from '@endora-commerce/admin-kit/i18n';
import type { SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { AssetFieldPicker, ContentLanguageTabs, StickyFormActions } from '@endora-commerce/admin-kit/components';
import {
  Button,
  Card,
  CardContent,
  EditorSection,
  FormField,
  InlineStatus,
  Input,
  Label,
  PageHeader,
  RouteTabs,
  Select,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';

export type ProfileTab = 'profile' | 'security';

const PROFILE_PATH = '/profile';
const SECURITY_PATH = '/profile/security';
/** The `profile.security` mount carries nothing; one object, so the zone's memo holds. */
const SECURITY_ZONE_PROPS = {};

/**
 * The signed-in admin's own account, as two tabs (issue #1519, UX audit
 * SHELL-11, owner decision DEC-02): *Profile* — this screen's form and the
 * language preference — and *Security*, whose body is the `profile.security`
 * zone. Two-step verification used to be a row in the sidebar's *System*
 * section; it is about the account, not the platform, so it lives beside the
 * account's other settings now, reached from the avatar and from ⌘K.
 *
 * The host owns the strip, both labels and both routes, and does not know which
 * module fills the second tab: it is drawn when `useAdminZone` returns a
 * contribution, which has already applied both presence axes. With no
 * contributor there is one tab, and a strip of one is not a choice, so none is
 * drawn and `/profile/security` lands on the profile.
 */
export function ProfilePage({ tab = 'profile' }: { tab?: ProfileTab }): ReactNode {
  const t = useTranslation('core');
  const hasSecurity = useAdminZone('profile.security', SECURITY_ZONE_PROPS).length > 0;

  if (tab === 'security' && !hasSecurity) return <Navigate to={PROFILE_PATH} replace />;

  return (
    <div className="b2b-page">
      <PageHeader title={t('profile.page.title')} />
      {hasSecurity ? (
        <RouteTabs
          className="mb-4"
          tabs={[
            { to: PROFILE_PATH, label: t('profile.tabs.profile') },
            { to: SECURITY_PATH, label: t('profile.tabs.security') },
          ]}
        />
      ) : null}
      {tab === 'security' ? <AdminZone name="profile.security" props={SECURITY_ZONE_PROPS} /> : <ProfileDetails />}
    </div>
  );
}

/**
 * The Profile tab — feature 010 admin polish.
 *
 * Self-edit form for the logged-in admin user. Hits
 * `PATCH /api/v1/admin/me`, which any authenticated admin can call
 * without holding `admin_users:manage`. Linked from the avatar in the
 * top-right corner of the AppShell.
 *
 * A new password travels with the current one: the route refuses a `password`
 * without `currentPassword`, so the screen asks for it before it sends
 * anything, and shows a wrong one on that field rather than in the page
 * banner.
 *
 * A password change revokes the account's other sessions and keeps the one it
 * was made from, so the screen stays where it is and says so.
 *
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the form is one card whose parts
 * (identity, author profile, password) are `EditorSection`s, because they are
 * saved together by one Save; the language preference, saved on its own, is
 * the one card beside it (Common Region). Kit primitives throughout, so the
 * screen is held by `one-visual-system.test.ts`.
 */
function ProfileDetails(): ReactNode {
  const t = useTranslation('core');
  const { me, refresh } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentPasswordError, setCurrentPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Feature 171 (US6) — the public author profile: an avatar and a biography per
  // content language, shown beside the posts the administrator writes.
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [bio, setBio] = useState<Record<string, string>>({});
  const [contentLanguages, setContentLanguages] = useState<Array<{ code: string; label: string }>>([]);
  // The language whose text is on screen; every language's text stays in `bio`.
  const [bioLanguage, setBioLanguage] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setFirstName(me.adminUser.firstName);
      setLastName(me.adminUser.lastName);
      setAvatarAssetId(me.adminUser.avatarAssetId ?? null);
      setBio(me.adminUser.bio ?? {});
    }
  }, [me]);

  useEffect(() => {
    void apiClient
      .get<{ data: { languages: Array<{ code: string; label: string }> } }>('/api/v1/i18n/config')
      .then((config) => {
        setContentLanguages(config.data.languages);
        setBioLanguage((current) => current ?? config.data.languages[0]?.code ?? null);
      })
      .catch(() => setContentLanguages([]));
  }, []);

  if (!me) {
    return <p>{t('profile.loading')}</p>;
  }

  // Issue #1449 (DS-19) — the draft against the account, for the save bar's "Unsaved changes".
  const dirty =
    firstName !== me.adminUser.firstName ||
    lastName !== me.adminUser.lastName ||
    avatarAssetId !== (me.adminUser.avatarAssetId ?? null) ||
    !sameBio(bio, me.adminUser.bio ?? {}) ||
    password.trim().length > 0;

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setCurrentPasswordError(null);
    const changingPassword = password.trim().length > 0;
    if (changingPassword && currentPassword.length === 0) {
      setCurrentPasswordError(t('profile.error.currentPasswordRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (firstName !== me.adminUser.firstName) body['firstName'] = firstName;
      if (lastName !== me.adminUser.lastName) body['lastName'] = lastName;
      if (avatarAssetId !== (me.adminUser.avatarAssetId ?? null)) body['avatarAssetId'] = avatarAssetId;
      if (!sameBio(bio, me.adminUser.bio ?? {})) body['bio'] = bio;
      if (changingPassword) {
        body['password'] = password;
        body['currentPassword'] = currentPassword;
      }
      if (Object.keys(body).length === 0) {
        setInfo(t('profile.info.nothingToSave'));
        setSubmitting(false);
        return;
      }
      await apiClient.patch<unknown>('/api/v1/admin/me', body);
      setPassword('');
      setCurrentPassword('');
      // A password change signs every other session of the account out and
      // leaves this one alone, so there is nothing to recover from here — only
      // something to tell the administrator.
      setInfo(t(changingPassword ? 'profile.info.passwordChanged' : 'profile.info.updated'));
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'CURRENT_PASSWORD_INVALID') {
        // The refusal is about one field, so it is shown there. The new
        // password is kept: only the wrong field needs retyping.
        setCurrentPasswordError(err.envelope.error.message);
        setCurrentPassword('');
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('profile.error.save'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={(e): void => { void handleSubmit(e); }}>
        <Card>
          <CardContent className="space-y-(--section-gap)">
            <EditorSection title={t('profile.identityTitle')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t('profile.field.email')} hint={t('profile.emailHelp')}>
                  <Input id="me-email" value={me.adminUser.email} disabled />
                </FormField>
                <FormField label={t('profile.field.role')}>
                  <Input id="me-role" value={me.role?.name ?? '—'} disabled />
                </FormField>
                <FormField label={t('profile.field.firstName')}>
                  <Input
                    id="me-first"
                    value={firstName}
                    onChange={(e): void => setFirstName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </FormField>
                <FormField label={t('profile.field.lastName')}>
                  <Input
                    id="me-last"
                    value={lastName}
                    onChange={(e): void => setLastName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </FormField>
              </div>
            </EditorSection>

            <EditorSection title={t('profile.authorTitle')} description={t('profile.authorHelp')}>
              <div className="space-y-1.5">
                <Label htmlFor="me-avatar">{t('profile.field.avatar')}</Label>
                <AssetFieldPicker
                  id="me-avatar"
                  value={avatarAssetId ?? ''}
                  // The picker answers '' when the image is cleared: no avatar.
                  onChange={(assetId): void => setAvatarAssetId(assetId === '' ? null : assetId)}
                  acceptMimePrefix="image/"
                  allowUpload
                />
              </div>
              <ContentLanguageTabs
                languages={contentLanguages.map((language) => language.code)}
                activeLanguage={bioLanguage}
                onChange={setBioLanguage}
              />
              {bioLanguage !== null ? (
                <FormField
                  label={t('profile.field.bio', {
                    language: contentLanguages.find((language) => language.code === bioLanguage)?.label ?? bioLanguage,
                  })}
                >
                  <Textarea
                    id="me-bio"
                    rows={5}
                    maxLength={2000}
                    value={bio[bioLanguage] ?? ''}
                    onChange={(e): void => setBio((current) => ({ ...current, [bioLanguage]: e.target.value }))}
                  />
                </FormField>
              ) : null}
            </EditorSection>

            <EditorSection title={t('profile.changePassword')}>
              {/* Wired by hand rather than through `FormField`: the field names one
                  description at a time — the refusal, else the help — and the refusal
                  interrupts (`role="alert"`), because it is why the Save did nothing. */}
              <div className="space-y-1.5">
                <Label htmlFor="me-current-pwd">{t('profile.field.currentPassword')}</Label>
                <Input
                  id="me-current-pwd"
                  type="password"
                  value={currentPassword}
                  onChange={(e): void => {
                    setCurrentPassword(e.target.value);
                    setCurrentPasswordError(null);
                  }}
                  maxLength={256}
                  autoComplete="current-password"
                  aria-invalid={currentPasswordError ? true : undefined}
                  aria-describedby={currentPasswordError ? 'me-current-pwd-error' : 'me-current-pwd-help'}
                />
                {currentPasswordError ? (
                  <p id="me-current-pwd-error" className="text-xs text-destructive" role="alert">
                    {currentPasswordError}
                  </p>
                ) : (
                  <p id="me-current-pwd-help" className="text-xs text-muted-foreground">
                    {t('profile.field.currentPasswordHelp')}
                  </p>
                )}
              </div>
              <FormField label={t('profile.field.newPassword')} hint={t('profile.field.newPasswordHelp')}>
                <Input
                  id="me-pwd"
                  type="password"
                  value={password}
                  onChange={(e): void => setPassword(e.target.value)}
                  minLength={12}
                  maxLength={120}
                  autoComplete="new-password"
                  placeholder={t('profile.field.newPasswordPlaceholder')}
                />
              </FormField>
            </EditorSection>
          </CardContent>
        </Card>

        {/* Issue #1449 (DS-19) — the one Save, in view at the end of the form, with what it
            answered said beside it rather than in a banner at the top of the page. */}
        <StickyFormActions
          desktop="sticky"
          dirty={dirty}
          error={error}
          status={info}
          primary={
            <Button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? t('profile.saving') : t('profile.saveChanges')}
            </Button>
          }
        />
      </form>

      <LanguageSection />
    </>
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
  // Issue #1437 — what the Save answered, beside it, in a region mounted before it has text
  // (WCAG 2.2 SC 4.1.3); an icon goes with the colour (SC 1.4.1).
  const status = useInlineStatus();

  useEffect(() => {
    setPending(language);
  }, [language]);

  const handleSave = async (): Promise<void> => {
    if (pending === language) return;
    setSubmitting(true);
    status.clear();
    const previous = language;
    setLanguage(pending);
    try {
      await setPreferredLanguage(pending);
      await refresh();
      status.show(t('profilePage.language.saved'));
    } catch (err) {
      setLanguage(previous);
      setPending(previous);
      const message =
        err instanceof ApiError
          ? err.envelope.error.message
          : t('profilePage.language.failed');
      status.show(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <EditorSection
      id="profile-language"
      chrome="card"
      className="mt-4"
      title={t('profilePage.section.language')}
      description={t('profilePage.section.language.help')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Select
          // Named by the section's heading: a second "Language" label would say it twice.
          aria-labelledby="profile-language-title"
          className="max-w-60"
          value={pending}
          onChange={(e): void => {
            setPending(e.target.value as SupportedAdminLanguage);
            status.clear();
          }}
        >
          <option value="en">{t('profilePage.language.option.en')}</option>
          <option value="pl">{t('profilePage.language.option.pl')}</option>
        </Select>
        <Button
          type="button"
          disabled={submitting || pending === language}
          aria-busy={submitting || undefined}
          onClick={(): void => {
            void handleSave();
          }}
        >
          {submitting
            ? t('common.state.loading')
            : t('profilePage.language.action.save')}
        </Button>
        <InlineStatus {...status.props} />
      </div>
    </EditorSection>
  );
}

/** Whether two biographies say the same, ignoring languages left blank. */
function sameBio(a: Record<string, string>, b: Record<string, string>): boolean {
  const filled = (bio: Record<string, string>) =>
    JSON.stringify(Object.entries(bio).filter(([, text]) => text.trim() !== '').sort(([x], [y]) => x.localeCompare(y)));
  return filled(a) === filled(b);
}
