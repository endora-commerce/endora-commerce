import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SalesChannelListResponse } from '@endora-commerce/contracts';
import { AssetFieldPicker, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  ColorPicker,
  FormField,
  InlineStatus,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import {
  brandingWrite,
  draftOfBranding,
  inheritField,
  overridden,
  withEdit,
  type BrandingDraft,
  type BrandingDraftField,
} from '../components/branding-draft.js';
import { channelDisplayName } from '../lib/labels.js';

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
 * inherited value back). A field the channel sets differently offers "Use
 * all-channels value" (issue #1588), staged like any edit: Save then removes the
 * channel's own value instead of copying the all-channels one in. One Save for
 * the screen (FR-083). Switching the scope
 * or leaving the page with unsaved edits asks Save / Discard / Stay through the
 * kit's one unsaved-changes guard (issue #1606), titled for this screen; the
 * scope switch says what it asks about.
 */
export function EmailBrandingPage(): ReactNode {
  const t = useTranslation('transactional_emails');
  const { language: adminLanguage } = useTranslationContext();
  const tc = useTranslation('core');
  const { hasPermission } = useAuth();
  const canRead = hasPermission(READ_PERMISSION);
  const canWrite = hasPermission(WRITE_PERMISSION);

  const [channels, setChannels] = useState<Array<{ id: string; code: string; name: Record<string, string> }>>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<BrandingDraft | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  /** The all-channels values a channel inherits; `null` for the all-channels scope. */
  const [allChannels, setAllChannels] = useState<BrandingDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const write = loaded && draft ? brandingWrite(loaded, draft) : null;
  const dirty = write !== null;

  useEffect(() => {
    if (!canRead) return undefined;
    let live = true;
    // A channel list that does not load leaves the all-channels scope usable.
    listActiveSalesChannels()
      .then((res) => {
        if (live) setChannels(res.items.map((c) => ({ id: c.id, code: c.code, name: c.name })));
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
      setAllChannels(null);
      setLoadError(null);
      try {
        const [own, inherited] = await Promise.all([
          transactionalEmailsClient.branding(scope),
          scope === null ? Promise.resolve(null) : transactionalEmailsClient.branding(null),
        ]);
        const next = draftOfBranding(own);
        setLoaded(next);
        setDraft(next);
        setAllChannels(inherited === null ? null : draftOfBranding(inherited));
      } catch (error) {
        setLoadError(messageOf(error, t('branding.loadError')));
      }
    },
    [t],
  );

  useEffect(() => {
    if (canRead) void load(channelId);
  }, [canRead, channelId, load]);

  const edit = (change: Partial<Pick<BrandingDraft, BrandingDraftField>>): void => {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => (current ? withEdit(current, change) : current));
  };

  // "Use all-channels value" goes with the click that staged it, so focus moves to Save —
  // the next step, enabled by that click — rather than falling to the page (WCAG 2.4.3).
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const focusSaveNext = useRef(false);
  useEffect(() => {
    if (!focusSaveNext.current) return;
    focusSaveNext.current = false;
    saveButtonRef.current?.focus();
  }, [draft]);

  const inherit = (field: BrandingDraftField): void => {
    if (!allChannels) return;
    setSaved(false);
    setSaveError(null);
    focusSaveNext.current = true;
    setDraft((current) => (current ? inheritField(current, allChannels, field) : current));
  };

  const save = async (): Promise<boolean> => {
    if (!write || !canWrite) return false;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      let stored: BrandingDraft | null = null;
      // A reset exists only in a channel's scope; the all-channels scope never stages one.
      if (write.reset.length > 0 && channelId !== null) {
        stored = draftOfBranding(await transactionalEmailsClient.resetBranding(channelId, write.reset));
        // Recorded before the next write, so a write that then fails leaves only itself unsaved.
        setLoaded(stored);
        setDraft((current) => (current ? { ...current, inherit: [] } : current));
      }
      if (write.put !== null) {
        stored = draftOfBranding(await transactionalEmailsClient.putBranding(channelId, write.put));
        setLoaded(stored);
      }
      if (stored !== null) setDraft(stored);
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

  // Leaving the page or switching the scope over unsaved edits asks Save and continue /
  // Discard changes / Stay here (Stay has the focus, so an accidental Enter keeps the work).
  const guard = useUnsavedChangesGuard({
    dirty,
    onSave: canWrite ? save : undefined,
    onDiscard: () => setDraft(loaded),
    title: t('branding.switchScope.title'),
  });

  const requestScope = (scope: string | null): void => {
    if (scope === channelId) return;
    guard.confirm(() => switchScope(scope), { message: t('branding.switchScope.message') });
  };

  /**
   * Beside a field the channel sets differently: a note saying so, and — for an
   * operator who may write — the way back to the all-channels value.
   */
  const inheritControls = (field: BrandingDraftField): { labelAddon?: ReactNode; action?: ReactNode } => {
    if (channelId === null || allChannels === null || draft === null) return {};
    if (!overridden(draft, allChannels, field)) return {};
    return {
      labelAddon: <span className="text-xs text-muted-foreground">{t('branding.inherit.overridden')}</span>,
      ...(canWrite
        ? {
            action: (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => inherit(field)}
                disabled={saving}
              >
                {t('branding.inherit.action')}
              </Button>
            ),
          }
        : {}),
    };
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
            // "Saved" is said beside Save, in a region mounted before it has text
            // (issue #1499, DEC-12 a; WCAG 2.2 SC 4.1.3).
            <div className="flex items-center gap-3">
              <InlineStatus>{saved ? t('branding.saved') : null}</InlineStatus>
              <Button
                ref={saveButtonRef}
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                aria-busy={saving || undefined}
              >
                {saving ? tc('common.state.saving') : tc('common.action.save')}
              </Button>
            </div>
          ) : null
        }
      />

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
        <CardContent className="max-w-xl space-y-4">
          <FormField label={t('editor.scope')} hint={t('branding.scope.hint')}>
            <Select
              value={channelId ?? ''}
              onChange={(e) => requestScope(e.target.value === '' ? null : e.target.value)}
              disabled={saving}
            >
              <option value="">{t('scope.global')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {channelDisplayName(c, adminLanguage)}
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
              <FormField
                label={t('branding.logo')}
                hint={t('branding.logo.hint')}
                group
                {...inheritControls('logoAssetId')}
              >
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
              <FormField
                label={t('branding.accent')}
                hint={t('branding.accent.hint')}
                group
                {...inheritControls('accentColor')}
              >
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

      {guard.dialog}
    </div>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default EmailBrandingPage;
