import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Users } from 'lucide-react';
import {
  ListPage,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { ApiError, cn, useAuth, useDerivedKey } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  customerGroupsClient,
  type AdminCustomerGroup,
} from '../api/customer-groups-client.js';

/** The longest code `upsertCustomerGroupRequestSchema` accepts. */
const CODE_MAX_LENGTH = 64;

const rowId = (row: AdminCustomerGroup): string => row.id;

/**
 * Customer groups — the management screen (feature 076, D-79).
 *
 * It writes through `PUT /customer-groups/:code` and `DELETE /customer-groups/:id`.
 * The `PUT` is an upsert keyed by `code`, so creating and editing are one form
 * and the code is fixed once the group exists.
 *
 * Since UX audit slice S2 (DS-05 #1439, DS-07 #1441, DS-15 #1448) it is the
 * kit's `ListPage`: the list comes first, *New customer group* in the header
 * opens a dialog instead of a form drawn open above the rows, *Edit* and
 * *Delete* sit in the row's menu (*Delete* last and confirmed, never a filled
 * red button in every row), and an empty list is an `EmptyState` that carries
 * the one create action. The endpoint answers every group, unpaged: the three
 * pickers that read it need the whole set, and groups are a short segmentation
 * list, so the screen shows no pager.
 */
export function CustomerGroupsPage(): ReactNode {
  const t = useTranslation('customer_accounts');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('customer_groups:write');
  const [rows, setRows] = useState<AdminCustomerGroup[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // A save is said beside "New customer group", where the dialog hands focus
  // back; a deletion — whose row has already gone — to the screen reader only.
  // Never a success banner (issue #1499, DEC-12 a). Both regions are mounted
  // before they have text (SC 4.1.3).
  const saveStatus = useInlineStatus();
  const deleteStatus = useInlineStatus();
  // `undefined`: closed; `null`: creating; a row: editing it.
  const [editing, setEditing] = useState<AdminCustomerGroup | null | undefined>(undefined);
  // After a delete, focus goes to the next row's name, or to the create action
  // once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a save keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      setRows(await customerGroupsClient.list());
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('groups.error.load') });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { clear: clearSave, show: showSave } = saveStatus;
  const { clear: clearDelete, show: showDelete } = deleteStatus;
  const clearStatuses = useCallback((): void => {
    clearSave();
    clearDelete();
  }, [clearSave, clearDelete]);

  /** Throws on a refused save, so the dialog stays open and says why. */
  const handleSubmit = useCallback(
    async (value: GroupFormValue): Promise<void> => {
      clearStatuses();
      await customerGroupsClient.upsert(value.code, {
        code: value.code,
        name: value.name,
        description: value.description === '' ? null : value.description,
      });
      setEditing(undefined);
      showSave(t('groups.message.saved', { code: value.code }));
      await refresh();
    },
    [refresh, t, showSave, clearStatuses],
  );

  const handleDelete = useCallback(
    async (row: AdminCustomerGroup): Promise<void> => {
      clearStatuses();
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('groups.action.delete.confirm', { code: row.code }),
        confirmLabel: t('groups.action.delete'),
        destructive: true,
        action: () => customerGroupsClient.remove(row.id),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('groups.error.delete')),
        returnFocusTo: removalFocus.returnFocusTo(row),
      });
      if (!ok) return;
      showDelete(t('groups.message.deleted'));
      // The row goes in place rather than through a reload, so the row focus moved to stays mounted.
      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
    },
    [t, confirm, clearStatuses, showDelete, removalFocus],
  );

  const openCreate = (): void => {
    clearStatuses();
    setEditing(null);
  };
  const openEdit = (row: AdminCustomerGroup): void => {
    clearStatuses();
    setEditing(row);
  };

  const createButton = (
    <Button
      ref={(element) => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      className="min-h-11 sm:min-h-9"
      onClick={openCreate}
    >
      <Plus aria-hidden="true" />
      {t('groups.action.new')}
    </Button>
  );
  // With no group at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<AdminCustomerGroup>[] = [
    {
      id: 'name',
      header: t('groups.column.name'),
      primary: true,
      // A group has no page of its own: its name opens the edit dialog, like the row's *Edit*.
      render: (row) =>
        canWrite ? (
          <button
            ref={removalFocus.targetRef(row)}
            type="button"
            className="rounded-sm text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(): void => openEdit(row)}
          >
            {row.name}
          </button>
        ) : (
          <span className="font-medium">{row.name}</span>
        ),
      meta: (row) => <code className="font-mono text-xs">{row.code}</code>,
    },
    {
      id: 'code',
      header: t('groups.column.code'),
      hideOnMobile: true,
      render: (row) => <code className="font-mono text-xs">{row.code}</code>,
    },
    {
      id: 'description',
      header: t('groups.column.description'),
      hideOnMobile: true,
      render: (row) => <span className="text-muted-foreground">{row.description ?? '—'}</span>,
    },
  ];

  return (
    <>
      <ListPage
        title={t('groups.page.title')}
        description={t('groups.page.description')}
        actions={
          canWrite ? (
            <>
              <InlineStatus {...deleteStatus.props} visuallyHidden />
              <div className="flex items-center gap-3">
                <InlineStatus {...saveStatus.props} />
                {nothingYet ? null : createButton}
              </div>
            </>
          ) : undefined
        }
        load={load}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={rowId}
          emptyState={
            <EmptyState
              icon={<Users size={20} />}
              title={t('groups.empty.title')}
              description={canWrite ? t('groups.empty.body') : t('groups.empty.bodyReadOnly')}
              action={canWrite ? createButton : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (row: AdminCustomerGroup) => (
                  <RowActionMenu label={t('groups.rowActions', { name: row.name })}>
                    <RowActionMenuItem onSelect={(): void => openEdit(row)}>{t('groups.action.edit')}</RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={(): void => void handleDelete(row)}>
                      {t('groups.action.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {canWrite && editing !== undefined ? (
        <GroupDialog
          initial={editing}
          takenCodes={rows.map((row) => row.code)}
          onClose={(): void => setEditing(undefined)}
          onSubmit={handleSubmit}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

interface GroupFormValue {
  code: string;
  name: string;
  description: string;
}

/**
 * Create or edit one group, in a dialog. The name comes first and the code is
 * proposed from it until the operator edits it (Tesler), normalised on blur
 * (Postel). Because the `PUT` is an upsert by code, a new group whose code is
 * already taken would silently overwrite that group, so the dialog refuses it
 * at the field instead. On edit the code is read-only. A refused save keeps the
 * dialog open with the server's message and the typed values.
 */
function GroupDialog({
  initial,
  takenCodes,
  onClose,
  onSubmit,
}: {
  initial: AdminCustomerGroup | null;
  takenCodes: readonly string[];
  onClose: () => void;
  onSubmit: (value: GroupFormValue) => Promise<void>;
}): ReactNode {
  const t = useTranslation('customer_accounts');
  const formId = useId();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeField = useDerivedKey({
    source: name,
    value: code,
    onChange: (next): void => {
      setCode(next);
      setCodeError(null);
    },
    separator: '_',
    maxLength: CODE_MAX_LENGTH,
    enabled: initial === null,
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    // Enter in the code field submits without a blur: normalise here too.
    const sentCode = initial ? initial.code : codeField.commit().trim();
    const sentName = name.trim();
    const nextNameError = sentName === '' ? t('groups.error.nameRequired') : null;
    let nextCodeError: string | null = null;
    if (!initial) {
      if (sentCode === '') nextCodeError = t('groups.error.codeRequired');
      else if (takenCodes.includes(sentCode)) nextCodeError = t('groups.error.codeTaken');
    }
    setNameError(nextNameError);
    setCodeError(nextCodeError);
    // Focus the first refused field, so its error is read with it (WCAG 3.3.1).
    if (nextNameError) {
      nameRef.current?.focus();
      return;
    }
    if (nextCodeError) {
      codeRef.current?.focus();
      return;
    }
    setSubmitError(null);
    setBusy(true);
    try {
      await onSubmit({ code: sentCode, name: sentName, description: description.trim() });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.envelope.error.message : t('groups.error.save'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={initial ? t('groups.form.editTitle', { code: initial.code }) : t('groups.form.newTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      initialFocusRef={nameRef}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('groups.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {t('groups.action.save')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" noValidate onSubmit={(e): void => void submit(e)}>
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('groups.field.name')} error={nameError} required>
          <Input
            ref={nameRef}
            value={name}
            maxLength={160}
            onChange={(e): void => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
        </FormField>
        <FormField
          label={t('groups.field.code')}
          hint={t('groups.field.code.help')}
          error={codeError}
          required={initial === null}
        >
          <Input
            ref={codeRef}
            value={code}
            onChange={codeField.onChange}
            onBlur={codeField.onBlur}
            readOnly={initial !== null}
            className={cn('font-mono', initial !== null && 'bg-muted')}
          />
        </FormField>
        <FormField label={t('groups.field.description')}>
          <Input value={description} maxLength={1000} onChange={(e): void => setDescription(e.target.value)} />
        </FormField>
      </form>
    </ModalDialog>
  );
}

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default CustomerGroupsPage;
