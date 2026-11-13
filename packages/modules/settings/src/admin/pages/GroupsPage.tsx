import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ModalDialog, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { settingsClient, type GroupRow } from '../api/settings-client.js';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
/**
 * Settings groups page — feature 004 / US2.
 *
 * Manage logical sections used to organise settings in the Admin UI.
 * `general` is system-protected: the server refuses deletion (T032 contract).
 * Deleting any other group reassigns its settings to `general` and preserves
 * their per-channel values (T033 integration).
 */
export function GroupsPage(): ReactNode {
  const t = useTranslation('settings');
  const { confirm, confirmDialog } = useConfirmDialog();
  // Issue #313 — the group being renamed, in a dialog rather than `prompt()`.
  const [renaming, setRenaming] = useState<GroupRow | null>(null);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftCode, setDraftCode] = useState('');
  const [draftName, setDraftName] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await settingsClient.listGroupsOnly();
      setRows(res.groups);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to load groups.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      if (!draftCode.trim() || !draftName.trim()) return;
      try {
        await settingsClient.createGroup({ code: draftCode, name: draftName });
        setDraftCode('');
        setDraftName('');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [draftCode, draftName, refresh],
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
      const ok = await confirm({
        message: t('groups.deleteConfirm', { code }),
        confirmLabel: t('groups.action.delete'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await settingsClient.deleteGroup(code);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh, confirm, t],
  );

  return (
    <>
      <PageHeader
        title={t('groups.page.title')}
        description={t('groups.page.description')}
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">{t('groups.newGroup.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-[1fr_2fr_auto]" onSubmit={onCreate}>
            <Input
              placeholder={t('groups.newGroup.codePlaceholder')}
              value={draftCode}
              onChange={(e) => setDraftCode(e.target.value)}
            />
            <Input
              placeholder={t('groups.newGroup.namePlaceholder')}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <Button type="submit">{t('groups.newGroup.create')}</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('groups.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('groups.column.code')}</TableHead>
                  <TableHead>{t('groups.column.name')}</TableHead>
                  <TableHead>{t('groups.column.ownerModule')}</TableHead>
                  <TableHead>{t('groups.column.settings')}</TableHead>
                  <TableHead className="w-44 text-right">{t('groups.column.actions')}</TableHead>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenaming(g)}
                        disabled={g.isSystemProtected}
                      >
                        {t('groups.action.rename')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void onDelete(g.code)}
                        disabled={g.isSystemProtected}
                      >
                        {t('groups.action.delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
 * Renames a setting group (issue #313, in place of the browser's `prompt()`):
 * one required field prefilled with the current name, refused inline when
 * blank, and the server's refusal shown inside the dialog with the typed name
 * kept.
 */
function RenameGroupDialog(props: {
  group: GroupRow;
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
