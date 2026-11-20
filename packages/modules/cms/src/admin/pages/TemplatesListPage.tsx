import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LayoutTemplate, Plus } from 'lucide-react';
import type { CmsTemplateSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
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
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
import { cmsDeleteErrorMessage, loadErrorMessage } from '../components/list-delete-error.js';
import { useDuplicateAction } from '../components/duplicate-record.js';

const rowId = (row: { id: string }): string => row.id;

/**
 * The CMS template list — the kit's `ListPage` (issue #1495, UX audit
 * CONTENT-13): one heading and a row menu that opens a template or deletes it
 * through the confirmation and `DELETE /api/v1/admin/cms/templates/:id`
 * (refused while a legacy embed still uses it). The endpoint answers the whole
 * list: no pager, no search. Duplicate (DEC-17) copies the template under a
 * `-copy` code and opens the copy.
 */
export function TemplatesListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route takes the **write** code (feature 091, batch 16), and so
  // do the row actions, so both are gated on it.
  const canWrite = hasPermission('cms.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<CmsTemplateSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // After a delete, focus goes to the next row, or to "New …" once the list is empty (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows, rowId, load.kind === 'ready');
  // Issue #1495 (DEC-17) — Duplicate opens the copy's editor, or keeps the list with the reason.
  const copier = useDuplicateAction<CmsTemplateSummary>({
    run: (template, body) => cmsClient.duplicateTemplate(template.id, body),
    editorPath: (id) => `/cms/templates/${id}`,
    t,
  });

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    cmsClient
      .listTemplates()
      .then((out) => {
        if (!alive) return;
        setRows(out.data);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: 'error', ...loadErrorMessage(err) });
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const remove = async (template: CmsTemplateSummary): Promise<void> => {
    setNotice(null);
    copier.clearError();
    const deleted = await confirm({
      title: t('templatesList.deleteTitle'),
      message: t('templatesList.deleteConfirm', { name: template.name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => cmsClient.deleteTemplate(template.id),
      describeError: (err) => cmsDeleteErrorMessage(err, t),
      returnFocusTo: removalFocus.returnFocusTo(template),
    });
    if (!deleted) return;
    setRows((current) => current.filter((row) => row.id !== template.id));
    setNotice(t('templatesList.deleted', { name: template.name }));
  };

  const createLink = (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link ref={(element) => { removalFocus.createRef.current = element; }} to="/cms/templates/new">
        <Plus size={16} aria-hidden="true" />
        {t('templatesList.new')}
      </Link>
    </Button>
  );
  // With no template at all the empty state carries the one create action (Von Restorff).
  const nothingYet = load.kind === 'ready' && rows.length === 0;

  const columns: ResponsiveColumn<CmsTemplateSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (template) => (
        <Link ref={removalFocus.targetRef(template)} to={`/cms/templates/${template.id}`} className="font-medium text-primary hover:underline">
          {template.name}
        </Link>
      ),
      meta: (template) => <code className="text-xs">{template.code}</code>,
    },
    {
      id: 'code',
      header: t('columns.code'),
      hideOnMobile: true,
      render: (template) => <code className="text-xs">{template.code}</code>,
    },
    {
      id: 'languages',
      header: t('columns.languages'),
      hideOnMobile: true,
      render: (template) => <span className="text-xs text-muted-foreground">{template.languages.join(', ')}</span>,
    },
  ];

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('templatesList.title')}
        actions={canWrite && !nothingYet ? createLink : null}
        count={t('templatesList.count', { count: rows.length })}
        notice={
          copier.error ? (
            <Alert variant="destructive">
              <AlertDescription>{copier.error}</AlertDescription>
            </Alert>
          ) : notice ? (
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
          keyExtractor={(template) => template.id}
          emptyState={
            <EmptyState
              icon={<LayoutTemplate size={20} />}
              title={t('templatesList.emptyTitle')}
              description={t('templatesList.emptyBody')}
              action={canWrite ? createLink : null}
            />
          }
          {...(canWrite
            ? {
                renderActions: (template: CmsTemplateSummary) => (
                  <span className="contents" aria-busy={copier.pendingId === template.id}>
                    <RowActionMenu label={t('listActions.label', { name: template.name })}>
                      <RowActionMenuItem asChild>
                        <Link to={`/cms/templates/${template.id}`}>{t('listActions.open')}</Link>
                      </RowActionMenuItem>
                      <RowActionMenuItem
                        disabled={copier.pendingId !== null}
                        onSelect={() => void copier.duplicate(template)}
                      >
                        {t('listActions.duplicate')}
                      </RowActionMenuItem>
                      <RowActionMenuSeparator />
                      <RowActionMenuItem destructive onSelect={() => void remove(template)}>
                        {t('listActions.delete')}
                      </RowActionMenuItem>
                    </RowActionMenu>
                  </span>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default TemplatesListPage;
