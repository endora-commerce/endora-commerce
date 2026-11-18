import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { SalesChannelListResponse } from '@endora-commerce/contracts';
import { AssetFieldPicker, ModalDialog } from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient, useAuth, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  ColorPicker,
  FormField,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import { brandingPatch, draftOfBranding, type BrandingDraft } from '../components/branding-draft.js';

const READ_PERMISSION = 'transactional_emails:read';
const WRITE_PERMISSION = 'transactional_emails:write';

/**
 * Active sales channels, through the HTTP path and contract type both sides
 * compile — the same exit `EmailEditor` takes, for the same reason (feature
 * 091, P6): `sales_channels`' admin client is another module's code.
 */
function listActiveSalesChannels(): Promise<SalesChannelListResponse> {
  return apiClient.get<SalesChannelListResponse>('/api/v1/admin/sales-channels?activeOnly=true');
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/**
 * E-mail branding — the header logo and the accent colour every transactional
 * e-mail renders with (feature 047 US2; mounted by issue #1466).
 *
 * The values are settings the module owns, read and written per scope: *All
 * channels* is the default, and a sales channel overrides only what is changed
 * while it is selected (`brandingPatch` sends the difference, never the
 * inherited value back). One Save for the screen (FR-083); switching the scope
 * with unsaved edits asks Save / Discard / Stay, and leaving the page asks
 * through the shared unsaved-changes prompt.
 */
export function EmailBrandingPage(): ReactNode {
  const t = useTranslation('transactional_emails');
  const tc = useTranslation('core');
  const { hasPermission } = useAuth();
  const canRead = hasPermission(READ_PERMISSION);
  const canWrite = hasPermission(WRITE_PERMISSION);

  const [channels, setChannels] = useState<Array<{ id: string; code: string }>>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<BrandingDraft | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  /** A scope the operator asked for while the current one had unsaved edits. */
  const [pendingScope, setPendingScope] = useState<string | null | undefined>(undefined);

  const patch = loaded && draft ? brandingPatch(loaded, draft) : null;
  const dirty = patch !== null;
  useUnsavedChangesPrompt(dirty);

  useEffect(() => {
    if (!canRead) return undefined;
    let live = true;
    // A channel list that does not load leaves the all-channels scope usable.
    listActiveSalesChannels()
      .then((res) => {
        if (live) setChannels(res.items.map((c) => ({ id: c.id, code: c.code })));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [canRead]);

  const load = useCallback(
    async (scope: string | null): Promise<void> => {
      setLoaded(null);
      setDraft(null);
      setLoadError(null);
      try {
        const next = draftOfBranding(await transactionalEmailsClient.branding(scope));
        setLoaded(next);
        setDraft(next);
      } catch (error) {
        setLoadError(messageOf(error, t('branding.loadError')));
      }
    },
    [t],
  );

  useEffect(() => {
    if (canRead) void load(channelId);
  }, [canRead, channelId, load]);

  const edit = (change: Partial<BrandingDraft>): void => {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => (current ? { ...current, ...change } : current));
  };

  const save = async (): Promise<boolean> => {
    if (!patch || !canWrite) return false;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next = draftOfBranding(await transactionalEmailsClient.putBranding(channelId, patch));
      setLoaded(next);
      setDraft(next);
      setSaved(true);
      return true;
    } catch (error) {
      setSaveError(messageOf(error, t('branding.saveError')));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const switchScope = (scope: string | null): void => {
    setSaved(false);
    setSaveError(null);
    setChannelId(scope);
  };

  const requestScope = (scope: string | null): void => {
    if (scope === channelId) return;
    if (dirty) setPendingScope(scope);
    else switchScope(scope);
  };

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('branding.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('branding.title')}
        description={t('branding.description')}
        actions={
          canWrite ? (
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              aria-busy={saving || undefined}
            >
              {saving ? tc('common.state.saving') : tc('common.action.save')}
            </Button>
          ) : null
        }
      />

      {/* Mounted before it has text, so the confirmation is announced (SC 4.1.3). The
          visible banner beside it stays silent, so the confirmation is announced once. */}
      <div role="status" aria-live="polite" className="sr-only">
        {saved ? t('branding.saved') : ''}
      </div>
      {saved ? (
        <Alert variant="success" live="off">
          <AlertDescription>{t('branding.saved')}</AlertDescription>
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      ) : null}
      {!canWrite ? (
        <Alert>
          <AlertDescription>{t('branding.readOnly')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="max-w-xl space-y-4 pt-6">
          <FormField label={t('editor.scope')} hint={t('branding.scope.hint')}>
            <Select
              value={channelId ?? ''}
              onChange={(e) => requestScope(e.target.value === '' ? null : e.target.value)}
              disabled={saving}
            >
              <option value="">{t('scope.global')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </FormField>

          {loadError !== null ? (
            <Alert variant="destructive">
              <AlertDescription>
                {loadError}{' '}
                <Button type="button" variant="link" className="h-auto p-0" onClick={() => void load(channelId)}>
                  {tc('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : draft === null ? (
            <div aria-busy="true" className="space-y-4">
              <span className="sr-only">{t('branding.loading')}</span>
              <div className="h-16 rounded-md bg-muted motion-safe:animate-pulse" />
              <div className="h-16 rounded-md bg-muted motion-safe:animate-pulse" />
            </div>
          ) : (
            <>
              <FormField label={t('branding.logo')} hint={t('branding.logo.hint')} group>
                <AssetFieldPicker
                  value={draft.logoAssetId}
                  onChange={(logoAssetId) => edit({ logoAssetId })}
                  acceptMimePrefix="image/"
                  allowUpload
                  disabled={!canWrite || saving}
                  placeholder={t('branding.logo.placeholder')}
                  ariaLabel={t('branding.logo')}
                />
              </FormField>
              <FormField label={t('branding.accent')} hint={t('branding.accent.hint')} group>
                <ColorPicker
                  value={draft.accentColor}
                  onChange={(accentColor) => edit({ accentColor })}
                  label={t('branding.accent')}
                  customLabel={t('branding.accent.custom')}
                  disabled={!canWrite || saving}
                />
              </FormField>
            </>
          )}
        </CardContent>
      </Card>

      {pendingScope !== undefined ? (
        <ModalDialog
          title={t('branding.switchScope.title')}
          onClose={() => setPendingScope(undefined)}
          busy={saving}
          dismissOnScrim={false}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setPendingScope(undefined)} disabled={saving}>
                {t('branding.switchScope.stay')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const scope = pendingScope;
                  setPendingScope(undefined);
                  switchScope(scope);
                }}
                disabled={saving}
              >
                {t('branding.switchScope.discard')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const scope = pendingScope;
                  void save().then((ok) => {
                    setPendingScope(undefined);
                    if (ok) switchScope(scope);
                  });
                }}
                disabled={saving || !canWrite}
                aria-busy={saving || undefined}
              >
                {t('branding.switchScope.save')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('branding.switchScope.message')}</p>
        </ModalDialog>
      ) : null}
    </div>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default EmailBrandingPage;
