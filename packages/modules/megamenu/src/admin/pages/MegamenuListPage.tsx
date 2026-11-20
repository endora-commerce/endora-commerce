import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Menu, Plus } from 'lucide-react';
import { ERROR_CODES, type MegamenuSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, EmptyState, FormField, Input } from '@endora-commerce/admin-kit/ui';
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
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

import { megamenuClient } from '../api/megamenu-client.js';

const rowId = (row: { id: string }): string => row.id;

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * What the delete confirmation says when a megamenu's delete is refused: one
 * still bound to an active sales channel and language is the refusal an
 * operator can act on; anything else is the generic retry line. Exported for
 * the tests.
 */
export function megamenuDeleteErrorMessage(err: unknown, t: Translate): string {
  if (err instanceof ApiError && err.envelope.error.code === ERROR_CODES.MEGAMENU_HAS_ACTIVE_BINDINGS) {
    return t('listActions.deleteActiveBindings');
  }
  return t('listActions.deleteFailed');
}

/** "New megamenu": one field, so a dialog rather than a form drawn open in the header. */
function CreateMegamenuDialog({ onClose }: { onClose: () => void }): ReactNode {
  const t = useTranslation('megamenu');
  const navigate = useNavigate();
  const formId = useId();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    if (!name.trim()) {
      setNameError(t('list.validation.nameRequired'));
      return;
    }
    setNameError(null);
    setCreating(true);
    try {
      const created = await megamenuClient.createMenu({ name: name.trim() });
      navigate(`/megamenu/${created.id}`);
    } catch {
      setFailure(t('list.createFailed'));
      setCreating(false);
    }
  };

  return (
    <ModalDialog
      title={t('list.new')}
      onClose={onClose}
      busy={creating}
      dismissOnScrim={false}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={creating} aria-busy={creating || undefined}>
            {creating ? <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormField label={t('list.nameLabel')} required error={nameError}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </FormField>
        {/* Mounted before it has text, so a failure that arrives is announced. */}
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      </form>
    </ModalDialog>
  );
}

/**
 * The megamenu list — the kit's `ListPage` (issue #1495, UX audit
 * CONTENT-13): one heading, a "New megamenu" that opens a dialog instead of a
 * name field drawn open in the header, the active state as a badge with text,
 * and a row menu that opens a megamenu or deletes it through the confirmation
 * and `DELETE /api/v1/admin/megamenu/menus/:id` (refused while it is active on
 * a channel). Create and delete take `megamenu.write`, as their routes do.
 */
export function MegamenuListPage(): ReactNode {
  const t = useTranslation('megamenu');
  const { language } = useTranslationContext();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('megamenu.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<MegamenuSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // After a delete, focus goes to the next row, or to "New megamenu" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    megamenuClient
      .listMenus()
      .then((out) => {
        if (!alive) return;
        setRows(out.data);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (alive) {
          setLoad({ kind: 'error', ...(err instanceof ApiError ? { message: err.envelope.error.message } : {}) });
        }
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const remove = async (menu: MegamenuSummary): Promise<void> => {
    setNotice(null);
    const deleted = await confirm({
      title: t('list.deleteTitle'),
      message: t('list.deleteConfirm', { name: menu.name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => megamenuClient.deleteMenu(menu.id),
      describeError: (err) => megamenuDeleteErrorMessage(err, t),
      returnFocusTo: removalFocus.returnFocusTo(menu),
    });
    if (!deleted) return;
    setRows((current) => current.filter((row) => row.id !== menu.id));
    setNotice(t('list.deleted', { name: menu.name }));
  };

  const newMenu = (
    <Button
      ref={(element) => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      className="min-h-11 sm:min-h-9"
      onClick={() => setCreating(true)}
    >
      <Plus size={16} aria-hidden="true" />
      {t('list.new')}
    </Button>
  );
  // With no megamenu at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<MegamenuSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (row) => (
        <Link ref={removalFocus.targetRef(row)} to={`/megamenu/${row.id}`} className="font-medium text-primary hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      id: 'bindings',
      header: t('columns.bindings'),
      render: (row) => <span className="text-xs text-muted-foreground">{row.bindings.length}</span>,
    },
    {
      id: 'active',
      header: t('columns.active'),
      render: (row) =>
        row.activeIn > 0 ? (
          <Badge variant="success">{t(`list.activeScopes.${new Intl.PluralRules(language).select(row.activeIn)}`, { count: new Intl.NumberFormat(language).format(row.activeIn) })}</Badge>
        ) : (
          <Badge variant="outline">{t('state.staged')}</Badge>
        ),
    },
    {
      id: 'version',
      header: t('columns.version'),
      hideOnMobile: true,
      className: 'text-right',
      render: (row) => <span className="text-xs text-muted-foreground">v{row.version}</span>,
    },
  ];

  return (
    <>
      <ListPage
        title={t('list.title')}
        description={t('list.activeRule')}
        actions={canWrite && !nothingYet ? newMenu : null}
        count={t('list.count', { count: rows.length })}
        notice={
          notice ? (
            <Alert live="polite">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Menu size={20} />}
              title={t('list.emptyTitle')}
              description={canWrite ? t('list.emptyBody') : null}
              action={canWrite ? newMenu : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (row: MegamenuSummary) => (
                  <RowActionMenu label={t('listActions.label', { name: row.name })}>
                    <RowActionMenuItem asChild>
                      <Link to={`/megamenu/${row.id}`}>{t('listActions.open')}</Link>
                    </RowActionMenuItem>
                    <RowActionMenuSeparator />
                    <RowActionMenuItem destructive onSelect={() => void remove(row)}>
                      {t('listActions.delete')}
                    </RowActionMenuItem>
                  </RowActionMenu>
                ),
              }
            : {})}
        />
      </ListPage>
      {creating ? <CreateMegamenuDialog onClose={() => setCreating(false)} /> : null}
      {confirmDialog}
    </>
  );
}
export default MegamenuListPage;
