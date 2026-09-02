import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { salesChannelsClient } from '../api/sales-channels-client';
import {
  ChannelIdentityForm,
  type ChannelIdentityFormValue,
} from '../components/ChannelIdentityForm';
import { DefaultChannelBadge } from '../components/DefaultChannelBadge';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { useTranslation } from '@/i18n/useTranslation';

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
 * Membership tabs (US3 / T064) are NOT rendered here yet; the page
 * deliberately scopes itself to identity + lifecycle so US2 ships
 * standalone.
 */
export function SalesChannelEditPage(): ReactNode {
  const t = useTranslation('sales_channels');
  const { code: routeCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const isCreate = routeCode === 'new' || routeCode === undefined;

  const [channel, setChannel] = useState<SalesChannelDetail | null>(null);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await salesChannelsClient.getByCode(routeCode!);
        if (!cancelled) setChannel(detail);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.envelope.error.message : 'Failed to load channel.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreate, routeCode]);

  const handleSubmit = useCallback(
    async (value: ChannelIdentityFormValue): Promise<void> => {
      setSaving(true);
      setError(null);
      try {
        if (isCreate) {
          const created = await salesChannelsClient.create({
            code: value.code,
            name: { 'en-US': value.name },
            ...(value.themeCode ? { themeCode: value.themeCode } : {}),
            languages: value.languages,
            defaultLanguage: value.defaultLanguage,
            currencies: value.currencies,
            defaultCurrency: value.defaultCurrency,
            active: value.active,
          });
          navigate(`/sales-channels/${encodeURIComponent(created.code)}`, { replace: true });
          return;
        }
        if (!channel) return;
        const updated = await salesChannelsClient.update(channel.code, {
          expectedVersion: channel.version,
          name: { 'en-US': value.name },
          ...(value.themeCode !== undefined ? { themeCode: value.themeCode || null } : {}),
          languages: value.languages,
          defaultLanguage: value.defaultLanguage,
          currencies: value.currencies,
          defaultCurrency: value.defaultCurrency,
          active: value.active,
        });
        setChannel(updated);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Save failed.',
        );
      } finally {
        setSaving(false);
      }
    },
    [channel, isCreate, navigate],
  );

  const handleDeactivate = useCallback(async (): Promise<void> => {
    if (!channel || channel.systemDefault) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await salesChannelsClient.deactivate(channel.code);
      setChannel(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Deactivate failed.');
    } finally {
      setSaving(false);
    }
  }, [channel]);

  const handleActivate = useCallback(async (): Promise<void> => {
    if (!channel) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await salesChannelsClient.activate(channel.code);
      setChannel(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Activate failed.');
    } finally {
      setSaving(false);
    }
  }, [channel]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!channel || channel.systemDefault) return;
    if (
      !window.confirm(
        `Delete sales channel "${channel.code}"? This is irreversible. ` +
          `If any product / customer / category would be left with zero channels, ` +
          `the platform will refuse — you can opt to rebind them to the system default instead.`,
      )
    )
      return;
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
          if (
            window.confirm(
              `${err.envelope.error.message}\n\nRebind those entities to the system default and delete?`,
            )
          ) {
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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
    } finally {
      setSaving(false);
    }
  }, [channel, navigate]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('edit.loading')}</p>;
  }

  if (!isCreate && !channel) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? 'Channel not found.'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title={
          isCreate ? (
            'New Sales Channel'
          ) : (
            <span className="flex items-center gap-2">
              <span className="font-mono text-base">{channel!.code}</span>
              <DefaultChannelBadge systemDefault={channel!.systemDefault} />
              {!channel!.active && (
                <Badge variant="outline" className="text-[10px]">
                  Inactive
                </Badge>
              )}
            </span>
          )
        }
        description={
          isCreate
            ? 'Create a new place of sale. After saving, manage its product / customer / price-list memberships from the channel detail page or from the entity edit screens.'
            : 'Edit the channel’s identity. Lifecycle actions live in the toolbar; membership tabs land in a follow-up.'
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
                  Deactivate
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void handleActivate()} disabled={saving}>
                  Re-activate
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={saving || channel.systemDefault}
              >
                Delete
              </Button>
            </div>
          ) : null
        }
      />
      <ChannelIdentityForm
        mode={isCreate ? 'create' : 'edit'}
        initial={channel}
        lockCode={!isCreate}
        errorMessage={error}
        saving={saving}
        onSubmit={(v) => void handleSubmit(v)}
        onCancel={() => navigate('/sales-channels')}
      />
      {/* Feature 091 / P7c — the place below this screen's identity form.
          `inventory` contributes its warehouse routing panel here; this screen
          used to import that panel out of `admin/src/modules/warehouses/`. The
          mount is conditional on an existing channel, not on the zone being
          empty: a create form has no id to pass, and `<AdminZone>` renders
          nothing at all when no contribution survives the filter, so there is
          no chrome of this screen's to hide. */}
      {channel && !isCreate ? (
        <div style={{ marginTop: 24 }}>
          <AdminZone name="sales_channel.editor.after" props={{ channelId: channel.id }} />
        </div>
      ) : null}
    </>
  );
}
