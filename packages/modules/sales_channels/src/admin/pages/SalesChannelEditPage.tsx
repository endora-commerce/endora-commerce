import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SaveSessionSummary, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useNavigate, useParams } from 'react-router-dom';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import {
  ApiError,
  SaveSessionProvider,
  useAuth,
  useSaveSession,
  useUnsavedChangesPrompt,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, PageHeader } from '@endora-commerce/admin-kit/ui';
import { salesChannelsClient } from '../api/sales-channels-client.js';
import {
  ChannelIdentityForm,
  type ChannelIdentityFormValue,
} from '../components/ChannelIdentityForm.js';
import { DefaultChannelBadge } from '../components/DefaultChannelBadge.js';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * SalesChannelEditPage — feature 005 / T042.
 *
 * Two roles in one component, distinguished by the `:code` path
 * parameter:
 *   - `code === 'new'` → create form (POST).
 *   - any other value  → edit form (GET → PATCH).
 *
 * The form surfaces 409 / 412 / 422 errors from the backend as a
 * conflict banner so the operator can choose to refresh and retry
 * (412) or rename / re-pick a code (409).
 *
 * The header carries no description (issue #1482): the title, the status
 * badges and the lifecycle actions beside it already say what the page is.
 */
export function SalesChannelEditPage(): ReactNode {
  const t = useTranslation('sales_channels');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { code: routeCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  // Feature 167 (US3 #3) — an operator who may only read channels sees the
  // URL-prefix switch, disabled.
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('sales_channels:write');
  const isCreate = routeCode === 'new' || routeCode === undefined;

  const [channel, setChannel] = useState<SalesChannelDetail | null>(null);
  // Feature 180 (#407) — whether the channel in state is the answer of the header's activation
  // toggle rather than of a read or the form's own Save: the form then keeps the fields the
  // operator has changed (and the toggle has not) instead of re-seeding them away.
  const [reseedKeepsEdits, setReseedKeepsEdits] = useState(false);
  const setChannelFromForm = useCallback((next: SalesChannelDetail): void => {
    setReseedKeepsEdits(false);
    setChannel(next);
  }, []);
  const setChannelFromToggle = useCallback((next: SalesChannelDetail): void => {
    setReseedKeepsEdits(true);
    setChannel(next);
  }, []);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    // Fire-and-forget: the body catches its own errors.
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await salesChannelsClient.getByCode(routeCode!);
        if (!cancelled) {
          setReseedKeepsEdits(false);
          setChannel(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.envelope.error.message : t('edit.error.load'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreate, routeCode, t]);

  const handleCreate = useCallback(
    async (value: ChannelIdentityFormValue): Promise<void> => {
      setSaving(true);
      setError(null);
      try {
        const created = await salesChannelsClient.create({
          code: value.code,
          name: { 'en-US': value.name },
          ...(value.themeCode ? { themeCode: value.themeCode } : {}),
          languages: value.languages,
          defaultLanguage: value.defaultLanguage,
          currencies: value.currencies,
          defaultCurrency: value.defaultCurrency,
          active: value.active,
          anonymousAccess: value.anonymousAccess,
          prefixDefaultLanguage: value.prefixDefaultLanguage,
        });
        navigate(`/sales-channels/${encodeURIComponent(created.code)}`, { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('edit.error.save'));
      } finally {
        setSaving(false);
      }
    },
    [navigate, t],
  );

  const handleDeactivate = useCallback(async (): Promise<void> => {
    if (!channel || channel.systemDefault) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await salesChannelsClient.deactivate(channel.code);
      setChannelFromToggle(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('edit.error.deactivate'));
    } finally {
      setSaving(false);
    }
  }, [channel, setChannelFromToggle, t]);

  const handleActivate = useCallback(async (): Promise<void> => {
    if (!channel) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await salesChannelsClient.activate(channel.code);
      setChannelFromToggle(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('edit.error.activate'));
    } finally {
      setSaving(false);
    }
  }, [channel, setChannelFromToggle, t]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!channel || channel.systemDefault) return;
    const ok = await confirm({
      message: t('edit.deleteConfirm', { code: channel.code }),
      confirmLabel: tc('common.action.delete'),
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      try {
        await salesChannelsClient.delete(channel.code, { fallbackToDefault: false });
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.envelope.error.code === 'ENTITY_WOULD_HAVE_ZERO_CHANNELS'
        ) {
          const rebind = await confirm({
            message: (
              <>
                <p>{err.envelope.error.message}</p>
                <p className="mt-2">{t('edit.rebindConfirm')}</p>
              </>
            ),
            confirmLabel: t('edit.action.rebindAndDelete'),
            destructive: true,
          });
          if (rebind) {
            await salesChannelsClient.delete(channel.code, { fallbackToDefault: true });
          } else {
            return;
          }
        } else {
          throw err;
        }
      }
      navigate('/sales-channels');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('edit.error.delete'));
    } finally {
      setSaving(false);
    }
  }, [channel, navigate, confirm, t, tc]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('edit.loading')}</p>;
  }

  if (!isCreate && !channel) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? t('edit.notFound')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title={
          isCreate ? (
            t('edit.page.newTitle')
          ) : (
            <span className="flex items-center gap-2">
              <span className="font-mono text-base">{channel!.code}</span>
              <DefaultChannelBadge systemDefault={channel!.systemDefault} />
              {!channel!.active && (
                <Badge variant="outline" className="text-[10px]">
                  {t('status.inactive')}
                </Badge>
              )}
            </span>
          )
        }
        actions={
          channel ? (
            <div className="flex gap-2">
              {channel.active ? (
                <Button
                  variant="outline"
                  onClick={() => void handleDeactivate()}
                  disabled={saving || channel.systemDefault}
                >
                  {t('edit.action.deactivate')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void handleActivate()} disabled={saving}>
                  {t('edit.action.activate')}
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={saving || channel.systemDefault}
              >
                {tc('common.action.delete')}
              </Button>
            </div>
          ) : null
        }
      />
      {channel && !isCreate ? (
        // Feature 180, WP-9 — one save session per channel, the existing-channel branch only:
        // a create form has no id and mounts no zone.
        <SaveSessionProvider resetKey={channel.id} hostModule="sales_channels">
          <ChannelEditSection
            channel={channel}
            canWrite={canWrite}
            error={error}
            saving={saving}
            onError={setError}
            onSaving={setSaving}
            onChannel={setChannelFromForm}
            reseedKeepsEdits={reseedKeepsEdits}
            onCancel={() => { navigate('/sales-channels'); }}
          />
        </SaveSessionProvider>
      ) : (
        <ChannelIdentityForm
          mode="create"
          initial={channel}
          errorMessage={error}
          saving={saving}
          readOnly={!canWrite}
          onSubmit={(v) => void handleCreate(v)}
          onCancel={() => { navigate('/sales-channels'); }}
        />
      )}
      {confirmDialog}
    </>
  );
}

/**
 * A summary worth showing: a refusal or failure that names a participant, or a partial save.
 * A refusal of the channel write alone is said by the form's own error, as before.
 */
function showSummary(outcome: SaveOutcome | null): boolean {
  if (outcome === null || outcome.result === 'saved') return false;
  return (
    outcome.result === 'partial' ||
    outcome.parts.some((part) => part.id !== 'host' && part.result !== 'saved' && part.result !== 'not-attempted')
  );
}

/**
 * Feature 180, WP-9 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §4;
 * FR-070, OQ-10 = A) — the identity form and the panels below it under one save session. The
 * form's Save is the session's: the channel write first (blocking), then every participant of
 * `sales_channel.editor.after` in zone order. `inventory`'s warehouse routing is no participant:
 * it applies immediately and says so on its own heading.
 */
function ChannelEditSection({
  channel,
  canWrite,
  error,
  saving,
  onError,
  onSaving,
  onChannel,
  onCancel,
  reseedKeepsEdits,
}: {
  channel: SalesChannelDetail;
  canWrite: boolean;
  error: string | null;
  saving: boolean;
  onError: (message: string | null) => void;
  onSaving: (saving: boolean) => void;
  onChannel: (channel: SalesChannelDetail) => void;
  onCancel: () => void;
  reseedKeepsEdits: boolean;
}): ReactNode {
  const t = useTranslation('sales_channels');
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [hostCount, setHostCount] = useState(0);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  // The last save's summary belongs to it: an edit of the form's own clears it (FR-016).
  useEffect(() => {
    if (hostCount > 0) sessionRef.current.clearOutcome();
  }, [hostCount]);
  // Leaving the page — an in-app link, a reload, closing the tab — asks once for every part.
  useUnsavedChangesPrompt(hostCount + session.dirtyCount > 0);

  const handleSubmit = async (value: ChannelIdentityFormValue): Promise<void> => {
    const host: SavePart | null =
      hostCount > 0
        ? {
            id: 'host',
            label: t('channelEditor.save.hostPartLabel'),
            blocking: true,
            count: hostCount,
            // The form refuses to submit while a list or a default is missing; the server
            // answers the rest on the write.
            validate: async () => ({ fields: {} }),
            save: async () => {
              try {
                const updated = await salesChannelsClient.update(channel.code, {
                  expectedVersion: channel.version,
                  name: { 'en-US': value.name },
                  ...(value.themeCode !== undefined ? { themeCode: value.themeCode || null } : {}),
                  languages: value.languages,
                  defaultLanguage: value.defaultLanguage,
                  currencies: value.currencies,
                  defaultCurrency: value.defaultCurrency,
                  active: value.active,
                  anonymousAccess: value.anonymousAccess,
                  prefixDefaultLanguage: value.prefixDefaultLanguage,
                });
                onChannel(updated);
              } catch (err) {
                // Said where it was said before, and rethrown so no participant is written.
                onError(err instanceof ApiError ? err.envelope.error.message : t('channelEditor.save.failed'));
                throw err;
              }
            },
          }
        : null;
    if (host === null && sessionRef.current.dirtyCount === 0) return;
    onSaving(true);
    onError(null);
    try {
      await sessionRef.current.run(host);
    } finally {
      onSaving(false);
    }
  };

  /** The summary's "Show": the form's first marked field, or the zone's first control. */
  const showPart = (partId: string): void => {
    setTimeout(() => {
      const root = partId === 'host' ? sectionRef.current?.querySelector<HTMLElement>('form') : zoneRef.current;
      (root?.querySelector<HTMLElement>('[aria-invalid="true"], input, select, textarea, button') ?? root)?.focus();
    }, 0);
  };

  return (
    <div ref={sectionRef}>
      <ChannelIdentityForm
        mode="edit"
        initial={channel}
        lockCode
        errorMessage={error}
        saving={saving || session.saving}
        readOnly={!canWrite}
        participantChangeCount={session.dirtyCount}
        onChangeCountChange={setHostCount}
        reseedKeepsEdits={reseedKeepsEdits}
        summary={
          showSummary(session.lastOutcome) || session.notices.length > 0 ? (
            <div className="mb-4">
              <SaveSessionSummary
                outcome={showSummary(session.lastOutcome) ? session.lastOutcome : null}
                notices={session.notices}
                onShow={showPart}
              />
            </div>
          ) : null
        }
        onSubmit={(v) => void handleSubmit(v)}
        // Cancel is *Discard* without a dialog: a programmatic navigation is not intercepted.
        onCancel={() => {
          session.discardAll();
          onCancel();
        }}
        after={
          <div ref={zoneRef} style={{ marginTop: 24 }}>
            {/* Feature 091 / P7c — the place below this screen's identity form.
                `inventory` contributes its warehouse routing panel here; this screen
                used to import that panel out of `admin/src/modules/warehouses/`. The
                mount is conditional on an existing channel, not on the zone being
                empty: a create form has no id to pass, and `<AdminZone>` renders
                nothing at all when no contribution survives the filter, so there is
                no chrome of this screen's to hide. Feature 180 — the zone gets the
                editor's save session; a participant's changes join the form's Save.
                Issue #1449 — the form draws it before its save bar, so Save follows it. */}
            <AdminZone name="sales_channel.editor.after" props={{ channelId: channel.id, saveSession: session.handle }} />
          </div>
        }
      />
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default SalesChannelEditPage;
