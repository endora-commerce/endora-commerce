import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  ConfigurationDto,
  ConfigurationTypeDescriptor,
  CreateConfiguration,
  UpdateConfiguration,
} from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { credentialsClient } from '../api/credentials-client';
import { ConfigurationForm } from '../components/ConfigurationForm';
import { ConfigurationPreviewModal } from '../components/ConfigurationPreviewModal';

/**
 * Credentials management page (feature 058 US1).
 *
 * Lists configurations (secrets masked), supports create/edit via the dynamic
 * `ConfigurationForm`, delete via `window.confirm`, and a read-only preview.
 * Inert configurations (unregistered type) render read-only.
 */
export function CredentialsPage(): ReactNode {
  const t = useTranslation('credentials');
  const [types, setTypes] = useState<ConfigurationTypeDescriptor[]>([]);
  const [items, setItems] = useState<ConfigurationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');
  const [editing, setEditing] = useState<ConfigurationDto | null>(null);
  const [preview, setPreview] = useState<ConfigurationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const messageFor = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const code = err.envelope.error.code;
        // CREDENTIAL_IN_USE carries the referencing settings — list them so the
        // operator knows exactly what to detach before deleting (FR-012).
        if (code === 'CREDENTIAL_IN_USE') {
          const details = err.envelope.error.details as
            | { referencedBy?: { settingCode: string; salesChannelCode?: string }[] }
            | undefined;
          const referrers = (details?.referencedBy ?? [])
            .map((r) => (r.salesChannelCode ? `${r.settingCode} (${r.salesChannelCode})` : r.settingCode))
            .join(', ');
          return referrers
            ? t('error.inUseWith', { settings: referrers })
            : t('error.inUse');
        }
        const key = ERROR_KEY_BY_CODE[code];
        if (key) return t(key);
        return err.envelope.error.message;
      }
      return t('error.generic');
    },
    [t],
  );

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setListError(null);
    try {
      const [ts, list] = await Promise.all([credentialsClient.listTypes(), credentialsClient.list()]);
      setTypes(ts);
      setItems(list);
    } catch (err) {
      setListError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }, [messageFor]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async (body: CreateConfiguration): Promise<void> => {
    setBusy(true);
    setFormError(null);
    try {
      await credentialsClient.create(body);
      setMode('list');
      await reload();
    } catch (err) {
      setFormError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async (code: string, body: UpdateConfiguration): Promise<void> => {
    setBusy(true);
    setFormError(null);
    try {
      await credentialsClient.update(code, body);
      setMode('list');
      setEditing(null);
      await reload();
    } catch (err) {
      setFormError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (row: ConfigurationDto): Promise<void> => {
    if (!window.confirm(t('page.deleteConfirm'))) return;
    try {
      await credentialsClient.delete(row.code);
      await reload();
    } catch (err) {
      setListError(messageFor(err));
    }
  };

  const columns: ResponsiveColumn<ConfigurationDto>[] = [
    { id: 'name', header: t('table.name'), primary: true, render: (r) => r.name },
    { id: 'code', header: t('table.code'), render: (r) => <code className="text-xs">{r.code}</code> },
    {
      id: 'type',
      header: t('table.type'),
      render: (r) =>
        r.inert ? <Badge variant="destructive">{r.typeCode}</Badge> : (r.typeLabel ?? r.typeCode),
    },
    {
      id: 'provider',
      header: t('table.provider'),
      render: (r) => r.providerLabel ?? r.providerCode,
    },
  ];

  if (mode !== 'list') {
    return (
      <div>
        <PageHeader title={mode === 'new' ? t('page.new') : t('page.edit')} />
        <ConfigurationForm
          types={types}
          existing={mode === 'edit' ? editing : null}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onCancel={() => {
            setMode('list');
            setEditing(null);
            setFormError(null);
          }}
          busy={busy}
          error={formError}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('page.title')}
        description={t('page.subtitle')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormError(null);
              setMode('new');
            }}
            disabled={types.length === 0}
          >
            {t('page.new')}
          </Button>
        }
      />

      {listError ? <p className="mb-3 text-sm text-destructive">{listError}</p> : null}

      {loading ? null : (
        <ResponsiveTable
          columns={columns}
          data={items}
          keyExtractor={(r) => r.id}
          emptyState={<p className="text-sm text-muted-foreground">{t('page.empty')}</p>}
          renderActions={(r) => (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview(r)}>
                {t('action.preview')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={r.inert}
                onClick={() => {
                  setEditing(r);
                  setFormError(null);
                  setMode('edit');
                }}
              >
                {t('action.edit')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void onDelete(r)}>
                {t('action.delete')}
              </Button>
            </div>
          )}
        />
      )}

      <ConfigurationPreviewModal
        open={preview !== null}
        configuration={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

/** Map contract error codes to translation keys for user-facing messages. */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  CREDENTIAL_NOT_FOUND: 'error.notFound',
  CREDENTIAL_CODE_TAKEN: 'error.codeTaken',
  CREDENTIAL_TYPE_UNKNOWN: 'error.typeUnknown',
  CREDENTIAL_VALIDATION_FAILED: 'error.validationFailed',
  CREDENTIAL_IN_USE: 'error.inUse',
  CREDENTIAL_TYPE_IMMUTABLE: 'error.typeImmutable',
};
