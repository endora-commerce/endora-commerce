import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutTemplate, Plus } from 'lucide-react';
import type { EmailTemplateSummary } from '@endora-commerce/contracts';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import { CreateCodeNameDialog } from '../components/CreateCodeNameDialog.js';
import { emailScopeLabels } from '../lib/labels.js';

/**
 * The reusable e-mail templates. The kit's `ListPage` since issue #1749: the
 * create form that stood open above the list is a dialog behind *Create template* in
 * the header, and a row's *Delete* is in its menu, confirmed, its request run
 * inside the dialog. The endpoint answers every template, unpaged.
 */
export function EmailTemplatesPage(): React.ReactElement {
  const t = useTranslation('transactional_emails');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');
  const [items, setItems] = useState<EmailTemplateSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);

  const reload = useCallback((): void => {
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    transactionalEmailsClient
      .listTemplates()
      .then((res) => {
        setItems(res.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);
  useEffect(reload, [reload]);

  const create = async (value: { code: string; name: string }): Promise<void> => {
    await transactionalEmailsClient.createTemplate({ ...value, languages: ['en-US', 'pl-PL'] });
    setCreating(false);
    reload();
  };

  const remove = async (row: EmailTemplateSummary): Promise<void> => {
    const ok = await confirm({
      message: t('templates.deleteConfirm'),
      confirmLabel: tc('common.action.delete'),
      destructive: true,
      action: () => transactionalEmailsClient.deleteTemplate(row.id),
      describeError: (err) => (err instanceof Error ? err.message : String(err)),
    });
    if (ok) reload();
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('templates.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const newButton = (
    <Button onClick={(): void => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('templates.create')}
    </Button>
  );
  const nothingYet = load.kind === 'ready' && items.length === 0;

  return (
    <>
      <ListPage
        title={t('templates.title')}
        actions={canWrite && !nothingYet ? newButton : null}
        count={t('templates.count', { count: items.length })}
        load={load}
        onRetry={reload}
      >
        <ResponsiveTable
          data={items}
          keyExtractor={(row) => row.id}
          emptyState={<EmptyState icon={<LayoutTemplate size={20} />} title={t('templates.empty')} action={canWrite ? newButton : null} />}
          columns={[
            {
              id: 'name',
              header: t('list.column.name'),
              primary: true,
              render: (row) => (
                <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/templates/${row.id}`}>
                  {row.name}
                </Link>
              ),
              meta: (row) => <code className="text-xs">{row.code}</code>,
            },
            { id: 'code', header: t('list.column.code'), hideOnMobile: true, className: 'font-mono text-xs', render: (row) => row.code },
            { id: 'scope', header: t('list.column.scope'), render: (row) => emailScopeLabels.label(t, row.scope) },
          ]}
          renderActions={(row) =>
            canWrite && !row.isSystem ? (
              <RowActionMenu label={t('templates.rowActions', { name: row.name })}>
                <RowActionMenuItem destructive onSelect={(): void => void remove(row)}>
                  {tc('common.action.delete')}
                </RowActionMenuItem>
              </RowActionMenu>
            ) : null
          }
        />
      </ListPage>
      {creating ? (
        <CreateCodeNameDialog title={t('templates.create')} onSubmit={create} onClose={(): void => setCreating(false)} />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default EmailTemplatesPage;
