import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import {
  ListPage,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EmptyState, InlineStatus, Input, Label, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface AttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
  usageCount?: number;
}

interface CreateInput {
  code: string;
  nameEn: string;
  namePl: string;
}

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.envelope.error.message : fallback;

const rowId = (row: AttachmentType): string => row.id;

/**
 * Attachment Types dictionary CRUD (T087, feature 002 US3). The system seeds 4
 * standard rows (certificate / tech_spec / product_card / pdf) which the server
 * reports with `usageCount > 0` once any product attaches one.
 *
 * UX audit slice S6 (#1439 DS-05, #1441 DS-07, #1448 DS-15): the kit's
 * `ListPage` — the list first, *New attachment type* as the header's one
 * primary opening a dialog instead of a create form drawn under the table,
 * Delete in the row's "…" menu instead of a filled red button in every row, and
 * an `EmptyState` whose one action is *New attachment type*.
 *
 * Issue #1499 (UX audit SALES-17, DEC-12 a) — a result is said beside *New
 * attachment type*, where the dialogs hand focus back, in a region mounted
 * before it has text, not as a success banner. A refusal is the page's
 * destructive banner — or, for a create, the dialog's, so the typed values stay.
 */
export function AttachmentTypesPage(): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [types, setTypes] = useState<AttachmentType[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const status = useInlineStatus();
  const { show: showStatus, clear: clearStatus } = status;
  const removalFocus = useRemovalFocus(types, rowId, load.kind === 'ready');

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await apiClient.get<{ data: AttachmentType[] }>('/api/v1/admin/catalog/attachment-types');
      setTypes(res.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: messageOf(err, t('attachmentTypes.error.load')) });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback((): void => {
    clearStatus();
    setError(null);
    setCreating(true);
  }, [clearStatus]);

  /** Throws on a refusal, which the dialog says; resolves once the type exists. */
  const handleCreate = useCallback(
    async (input: CreateInput): Promise<void> => {
      await apiClient.post('/api/v1/admin/catalog/attachment-types', {
        code: input.code,
        name: { 'en-US': input.nameEn, 'pl-PL': input.namePl || input.nameEn },
      });
      setCreating(false);
      showStatus(t('attachmentTypes.success.create', { code: input.code }));
      await refresh();
    },
    [refresh, t, showStatus],
  );

  const handleDelete = useCallback(
    async (row: AttachmentType): Promise<void> => {
      clearStatus();
      const usage = row.usageCount ?? 0;
      if (usage > 0) {
        // Issue #313 — said on the page, not in the browser's `alert()`.
        setError(t('attachmentTypes.deleteInUse', { code: row.code, count: usage }));
        return;
      }
      setError(null);
      // The request runs inside the dialog: a refusal stays there, beside Retry and Cancel.
      const ok = await confirm({
        message: t('attachmentTypes.deleteConfirm', { code: row.code }),
        confirmLabel: tc('common.action.delete'),
        destructive: true,
        action: () => apiClient.delete(`/api/v1/admin/catalog/attachment-types/${row.id}`),
        describeError: (err) => messageOf(err, t('attachmentTypes.error.delete')),
        // The menu goes with the row: focus moves to a neighbour, or to *New …* when none is left.
        returnFocusTo: removalFocus.returnFocusTo(row),
      });
      if (!ok) return;
      showStatus(t('attachmentTypes.success.delete', { code: row.code }));
      await refresh();
    },
    [refresh, t, tc, confirm, clearStatus, showStatus, removalFocus],
  );

  const newButton = (
    <Button
      ref={(element): void => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      onClick={openCreate}
    >
      <Plus aria-hidden="true" />
      {t('attachmentTypes.action.new')}
    </Button>
  );
  // While the list is empty the empty state's *New …* is the one primary (Von Restorff).
  const nothingYet = load.kind === 'ready' && types.length === 0;

  const columns: ResponsiveColumn<AttachmentType>[] = [
    {
      id: 'code',
      header: t('attachmentTypes.column.code'),
      primary: true,
      render: (row) => (
        <code ref={removalFocus.targetRef(row)} tabIndex={-1} className="font-mono text-sm">
          {row.code}
        </code>
      ),
      meta: (row) => row.name['en-US'] ?? '—',
    },
    { id: 'nameEn', header: t('attachmentTypes.column.nameEn'), hideOnMobile: true, render: (row) => row.name['en-US'] ?? '—' },
    { id: 'namePl', header: t('attachmentTypes.column.namePl'), render: (row) => row.name['pl-PL'] ?? '—' },
    { id: 'position', header: t('attachmentTypes.column.position'), hideOnMobile: true, render: (row) => row.position },
    { id: 'inUse', header: t('attachmentTypes.column.inUse'), render: (row) => row.usageCount ?? 0 },
  ];

  return (
    <>
      <ListPage
        title={t('attachmentTypes.page.title')}
        description={t('attachmentTypes.page.description')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...status.props} />
            {canWrite && !nothingYet ? newButton : null}
          </div>
        }
        count={t('attachmentTypes.count', { count: String(types.length) })}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          columns={columns}
          data={types}
          keyExtractor={rowId}
          emptyState={
            <EmptyState
              icon={<Paperclip size={20} />}
              title={t('attachmentTypes.empty')}
              description={canWrite ? t('attachmentTypes.empty.body') : t('attachmentTypes.empty.bodyReadOnly')}
              action={canWrite ? newButton : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (row: AttachmentType): ReactNode => (
                  <RowActionMenu label={t('attachmentTypes.rowActions', { code: row.code })}>
                    <RowActionMenuItem destructive onSelect={(): void => void handleDelete(row)}>
                      {t('attachmentTypes.action.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {creating ? <CreateAttachmentTypeDialog onClose={(): void => setCreating(false)} onCreate={handleCreate} /> : null}
      {confirmDialog}
    </>
  );
}

/**
 * Three fields, so a dialog rather than a route (the kit README's list-page
 * rule). A refusal keeps it open with the server's message and what was typed.
 */
function CreateAttachmentTypeDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateInput) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const formId = useId();
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !code || !nameEn) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ code, nameEn, namePl });
    } catch (err) {
      setError(messageOf(err, t('attachmentTypes.error.create')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('attachmentTypes.create.title')}
      onClose={onClose}
      busy={busy}
      // A stray click must not throw away what was typed.
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {tc('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
            {tc('common.action.create')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" onSubmit={(e): void => void handleSubmit(e)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${formId}-code`}>{t('attachmentTypes.field.code')}</Label>
          <Input
            id={`${formId}-code`}
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            placeholder="warranty"
            pattern="[a-z0-9_]+"
            title={t('attachmentTypes.field.codeTitle')}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-name-en`}>{t('attachmentTypes.field.nameEn')}</Label>
          <Input id={`${formId}-name-en`} value={nameEn} onChange={(e): void => setNameEn(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${formId}-name-pl`}>{t('attachmentTypes.field.namePl')}</Label>
          <Input
            id={`${formId}-name-pl`}
            value={namePl}
            onChange={(e): void => setNamePl(e.target.value)}
            placeholder={t('attachmentTypes.field.namePlPlaceholder')}
          />
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default AttachmentTypesPage;
