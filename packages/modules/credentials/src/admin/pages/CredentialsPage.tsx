import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import type {
  ConfigurationDto,
  ConfigurationTypeDescriptor,
  CreateConfiguration,
  UpdateConfiguration,
} from '@endora-commerce/contracts';
import { Badge, Button, EmptyState, PageHeader } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { credentialsClient } from '../api/credentials-client.js';
import { ConfigurationForm } from '../components/ConfigurationForm.js';
import { ConfigurationPreviewModal } from '../../admin-ui/ConfigurationPreviewModal.js';

/**
 * Credentials management page (feature 058 US1).
 *
 * Lists configurations (secrets masked), supports create/edit via the dynamic
 * `ConfigurationForm`, a confirmed delete, and a read-only preview. Inert
 * configurations (unregistered type) render read-only.
 *
 * The list is the kit's `ListPage` (issue #1749): the name opens the
 * configuration, *Preview*, *Edit* and *Delete* are the row's menu — *Delete*
 * last, confirmed, its request run inside the dialog so a refusal (a setting
 * still uses it) is read there. The endpoint answers every configuration,
 * unpaged: a deployment holds a few dozen at most, so the screen shows no pager.
 *
 * `initialMode` lets the `/credentials/new` route (the command-palette
 * "New credential configuration" action) land straight on the empty form.
 */
/** Stable, module-level: `useRemovalFocus` keys its targets by it. */
const rowId = (row: ConfigurationDto): string => row.id;

export interface CredentialsPageProps {
  initialMode?: 'list' | 'new';
}

export function CredentialsPage({ initialMode = 'list' }: CredentialsPageProps = {}): ReactNode {
  const t = useTranslation('credentials');
  const { confirm, confirmDialog } = useConfirmDialog();
  const navigate = useNavigate();
  const [types, setTypes] = useState<ConfigurationTypeDescriptor[]>([]);
  const [items, setItems] = useState<ConfigurationDto[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>(initialMode);
  const [editing, setEditing] = useState<ConfigurationDto | null>(null);
  const [preview, setPreview] = useState<ConfigurationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    // A reload after a save keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const [ts, list] = await Promise.all([credentialsClient.listTypes(), credentialsClient.list()]);
      setTypes(ts);
      setItems(list);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: messageFor(err) });
    }
  }, [messageFor]);

  // After a delete, focus goes to the next row's name, or to New once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(items, rowId, load.kind === 'ready');

  useEffect(() => {
    void reload();
  }, [reload]);

  // Leaving the form. When the page was entered through the /credentials/new
  // deep link, drop that segment too so a reload does not reopen the form.
  const backToList = useCallback((): void => {
    setMode('list');
    setEditing(null);
    setFormError(null);
    if (initialMode === 'new') navigate('/credentials', { replace: true });
  }, [initialMode, navigate]);

  const onCreate = async (body: CreateConfiguration): Promise<void> => {
    setBusy(true);
    setFormError(null);
    try {
      await credentialsClient.create(body);
      backToList();
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
      backToList();
      await reload();
    } catch (err) {
      setFormError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (row: ConfigurationDto): Promise<void> => {
    // The request runs inside the dialog: a configuration a setting still
    // references is refused there, with the settings to detach (FR-012).
    const ok = await confirm({
      message: t('page.deleteConfirm'),
      confirmLabel: t('action.delete'),
      destructive: true,
      action: () => credentialsClient.delete(row.code),
      describeError: messageFor,
      returnFocusTo: removalFocus.returnFocusTo(row),
    });
    if (!ok) return;
    // The row goes in place rather than through a reload, so the row focus moved to stays mounted.
    setItems((current) => current.filter((candidate) => candidate.id !== row.id));
  };

  const openEdit = (row: ConfigurationDto): void => {
    setEditing(row);
    setFormError(null);
    setMode('edit');
  };

  const columns: ResponsiveColumn<ConfigurationDto>[] = [
    {
      id: 'name',
      header: t('table.name'),
      primary: true,
      // The name opens the configuration: its editor, or — for an inert one, which cannot be edited — its preview.
      render: (r) => (
        <button
          ref={removalFocus.targetRef(r)}
          type="button"
          className="rounded-sm text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(): void => (r.inert ? setPreview(r) : openEdit(r))}
        >
          {r.name}
        </button>
      ),
    },
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
          onCancel={backToList}
          busy={busy}
          error={formError}
        />
      </div>
    );
  }

  const newButton = (
    <Button
      ref={(element) => {
        removalFocus.createRef.current = element;
      }}
      onClick={() => {
        setEditing(null);
        setFormError(null);
        setMode('new');
      }}
      disabled={types.length === 0}
    >
      {t('page.new')}
    </Button>
  );
  // Issue #1448 (DS-15): while there is no configuration, the empty state's
  // New configuration is the view's one primary; the header does not repeat it
  // (Von Restorff). With no type to create, the empty state says why instead.
  const noData = load.kind === 'ready' && items.length === 0;

  return (
    <>
      <ListPage
        title={t('page.title')}
        actions={noData ? null : newButton}
        count={t('page.count', { count: items.length })}
        load={load}
        onRetry={() => void reload()}
      >
        <ResponsiveTable
          columns={columns}
          data={items}
          keyExtractor={(r) => r.id}
          emptyState={
            <EmptyState
              icon={<KeyRound size={20} />}
              title={t('page.empty')}
              description={types.length === 0 ? t('page.emptyNoTypes') : t('page.emptyBody')}
              action={types.length === 0 ? null : newButton}
            />
          }
          renderActions={(r) => (
            <RowActionMenu label={t('action.menu', { name: r.name })}>
              <RowActionMenuItem onSelect={() => setPreview(r)}>{t('action.preview')}</RowActionMenuItem>
              <RowActionMenuItem disabled={r.inert} onSelect={() => openEdit(r)}>
                {t('action.edit')}
              </RowActionMenuItem>
              <RowActionMenuSeparator />
              <RowActionMenuItem destructive onSelect={() => void onDelete(r)}>
                {t('action.delete')}
              </RowActionMenuItem>
            </RowActionMenu>
          )}
        />
      </ListPage>

      <ConfigurationPreviewModal
        open={preview !== null}
        configuration={preview}
        onClose={() => setPreview(null)}
      />
      {confirmDialog}
    </>
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CredentialsPage;
