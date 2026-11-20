import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { FolderTree, Plus } from 'lucide-react';
import {
  ListPage,
  ModalDialog,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EmptyState, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import type { SettingGroupRowDto } from '@endora-commerce/contracts';
import { settingsClient } from '../api/settings-client.js';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
/**
 * Settings groups page — feature 004 / US2.
 *
 * Manage logical sections used to organise settings in the Admin UI.
 * `general` is system-protected: the server refuses deletion (T032 contract).
 * Deleting any other group reassigns its settings to `general` and preserves
 * their per-channel values (T033 integration).
 *
 * The kit's `ListPage` (issue #1501, UX audit SHELL-14): the list comes first,
 * "New group" in the header opens a two-field dialog instead of a form drawn
 * open above the rows (Hick), and *Rename* / *Delete* sit in the row's
 * overflow menu, *Delete* last and confirmed (Fitts — destructive actions get
 * distance).
 */
export function GroupsPage(): ReactNode {
  const t = useTranslation('settings');
  const { confirm, confirmDialog } = useConfirmDialog();
  // Issue #313 — the group being renamed, in a dialog rather than `prompt()`.
  const [renaming, setRenaming] = useState<SettingGroupRowDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [rows, setRows] = useState<SettingGroupRowDto[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await settingsClient.listGroupsOnly();
      setRows(res.groups);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({
        kind: 'error',
        message: err instanceof ApiError ? err.envelope.error.message : t('groups.error.load'),
      });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Throws on a refused create, so the dialog stays open and says why. */
  const onCreate = useCallback(
    async (code: string, name: string): Promise<void> => {
      await settingsClient.createGroup({ code, name });
      setCreating(false);
      await refresh();
    },
    [refresh],
  );

  /** Throws on a refused rename, so the dialog stays open and says why. */
  const onRename = useCallback(
    async (code: string, name: string): Promise<void> => {
      await settingsClient.updateGroup(code, { name });
      setRenaming(null);
      await refresh();
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (code: string): Promise<void> => {
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('groups.deleteConfirm', { code }),
        confirmLabel: t('groups.action.delete'),
        destructive: true,
        action: () => settingsClient.deleteGroup(code),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('groups.error.delete')),
      });
      if (ok) await refresh();
    },
    [refresh, confirm, t],
  );

  const newGroupButton = (variant: 'default' | 'outline'): ReactNode => (
    <Button type="button" variant={variant} onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('groups.newGroup.action')}
    </Button>
  );

  return (
    <>
      <ListPage
        title={t('groups.page.title')}
        description={t('groups.page.description')}
        actions={newGroupButton('default')}
        load={load}
        onRetry={() => void refresh()}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree size={20} />}
            title={t('groups.list.empty')}
            action={newGroupButton('outline')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('groups.column.code')}</TableHead>
                <TableHead>{t('groups.column.name')}</TableHead>
                <TableHead>{t('groups.column.ownerModule')}</TableHead>
                <TableHead>{t('groups.column.settings')}</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">{t('groups.column.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={g.code}>
                  <TableCell className="font-mono text-xs">{g.code}</TableCell>
                  <TableCell>{g.name}</TableCell>
                  <TableCell className="text-xs">{g.ownerModule}</TableCell>
                  <TableCell>{g.settingCount}</TableCell>
                  <TableCell className="text-right">
                    <RowActionMenu
                      label={t('groups.rowActions', { code: g.code })}
                      disabled={g.isSystemProtected}
                      title={g.isSystemProtected ? t('groups.action.protected') : undefined}
                    >
                      <RowActionMenuItem onSelect={() => setRenaming(g)}>{t('groups.action.rename')}</RowActionMenuItem>
                      <RowActionMenuSeparator />
                      <RowActionMenuItem destructive onSelect={() => void onDelete(g.code)}>
                        {t('groups.action.delete')}
                      </RowActionMenuItem>
                    </RowActionMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPage>
      {creating ? <CreateGroupDialog onClose={() => setCreating(false)} onCreate={onCreate} /> : null}
      {renaming ? (
        <RenameGroupDialog
          group={renaming}
          onClose={() => setRenaming(null)}
          onRename={(name) => onRename(renaming.code, name)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * Creates a setting group (issue #1501): the two fields the inline card held,
 * now labelled rather than placeholder-only, refused inline when blank, and the
 * server's refusal shown inside the dialog with the typed values kept.
 */
function CreateGroupDialog(props: {
  onClose: () => void;
  onCreate: (code: string, name: string) => Promise<void>;
}): ReactNode {
  const { onClose, onCreate } = props;
  const t = useTranslation('settings');
  const tc = useTranslation('core');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [missing, setMissing] = useState<{ code: boolean; name: boolean }>({ code: false, name: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const codeId = `${baseId}-code`;
  const nameId = `${baseId}-name`;

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (busy) return;
    const next = { code: code.trim() === '', name: name.trim() === '' };
    setMissing(next);
    if (next.code || next.name) return;
    setError(null);
    setBusy(true);
    try {
      await onCreate(code.trim(), name.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('groups.error.create'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('groups.newGroup.title')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tc('common.action.cancel')}
          </Button>
          <Button type="submit" form={`${baseId}-form`} disabled={busy} aria-busy={busy}>
            {t('groups.newGroup.create')}
          </Button>
        </>
      }
    >
      <form id={`${baseId}-form`} noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={codeId}>{t('groups.newGroup.codeLabel')}</Label>
          <Input
            id={codeId}
            required
            className="font-mono"
            placeholder={t('groups.newGroup.codePlaceholder')}
            value={code}
            aria-invalid={missing.code ? true : undefined}
            aria-describedby={missing.code ? `${codeId}-missing` : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              if (e.target.value.trim()) setMissing((m) => ({ ...m, code: false }));
            }}
          />
          {missing.code ? (
            <p id={`${codeId}-missing`} className="text-xs text-destructive">
              {t('groups.newGroup.codeMissing')}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={nameId}>{t('groups.newGroup.nameLabel')}</Label>
          <Input
            id={nameId}
            required
            value={name}
            aria-invalid={missing.name ? true : undefined}
            aria-describedby={missing.name ? `${nameId}-missing` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setMissing((m) => ({ ...m, name: false }));
            }}
          />
          {missing.name ? (
            <p id={`${nameId}-missing`} className="text-xs text-destructive">
              {t('groups.newGroup.nameMissing')}
            </p>
          ) : null}
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * Renames a setting group (issue #313, in place of the browser's `prompt()`):
 * one required field prefilled with the current name, refused inline when
 * blank, and the server's refusal shown inside the dialog with the typed name
 * kept.
 */
function RenameGroupDialog(props: {
  group: SettingGroupRowDto;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
}): ReactNode {
  const { group, onClose, onRename } = props;
  const t = useTranslation('settings');
  const tc = useTranslation('core');
  const [name, setName] = useState(group.name);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const missingId = useId();

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMissing(true);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onRename(trimmed);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('groups.renameDialog.failed'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('groups.renameDialog.title', { code: group.code })}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tc('common.action.cancel')}
          </Button>
          <Button type="submit" form={`${inputId}-form`} disabled={busy} aria-busy={busy}>
            {tc('common.action.save')}
          </Button>
        </>
      }
    >
      <form id={`${inputId}-form`} noValidate className="space-y-3" onSubmit={(e) => void submit(e)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={inputId}>{t('groups.renameDialog.name')}</Label>
          <Input
            id={inputId}
            required
            value={name}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? missingId : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setMissing(false);
            }}
          />
          {missing ? (
            <p id={missingId} className="text-xs text-destructive">
              {t('groups.renameDialog.nameMissing')}
            </p>
          ) : null}
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default GroupsPage;
