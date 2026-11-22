import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Blocks, Plus } from 'lucide-react';
import type { EmailBlockSummary } from '@endora-commerce/contracts';
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
 * The reusable e-mail blocks. The kit's `ListPage` since issue #1749: the
 * create form that stood open above the list is a dialog behind *Create block* in
 * the header, and a row's *Delete* is in its menu, confirmed, its request run
 * inside the dialog. The endpoint answers every block, unpaged.
 */
export function EmailBlocksPage(): React.ReactElement {
  const t = useTranslation('transactional_emails');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');
  const [items, setItems] = useState<EmailBlockSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);

  const reload = useCallback((): void => {
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    transactionalEmailsClient
      .listBlocks()
      .then((res) => {
        setItems(res.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);
  useEffect(reload, [reload]);

  const create = async (value: { code: string; name: string }): Promise<void> => {
    await transactionalEmailsClient.createBlock({ ...value, languages: ['en-US', 'pl-PL'] });
    setCreating(false);
    reload();
  };

  const remove = async (row: EmailBlockSummary): Promise<void> => {
    const ok = await confirm({
      message: t('blocks.deleteConfirm'),
      confirmLabel: tc('common.action.delete'),
      destructive: true,
      action: () => transactionalEmailsClient.deleteBlock(row.id),
      describeError: (err) => (err instanceof Error ? err.message : String(err)),
    });
    if (ok) reload();
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('blocks.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const newButton = (
    <Button onClick={(): void => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('blocks.create')}
    </Button>
  );
  const nothingYet = load.kind === 'ready' && items.length === 0;

  return (
    <>
      <ListPage
        title={t('blocks.title')}
        actions={canWrite && !nothingYet ? newButton : null}
        count={t('blocks.count', { count: items.length })}
        load={load}
        onRetry={reload}
      >
        <ResponsiveTable
          data={items}
          keyExtractor={(row) => row.id}
          emptyState={<EmptyState icon={<Blocks size={20} />} title={t('blocks.empty')} action={canWrite ? newButton : null} />}
          columns={[
            {
              id: 'name',
              header: t('list.column.name'),
              primary: true,
              render: (row) => (
                <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/blocks/${row.id}`}>
                  {row.name}
                </Link>
              ),
              meta: (row) => <code className="text-xs">{row.code}</code>,
            },
            { id: 'code', header: t('list.column.code'), hideOnMobile: true, className: 'font-mono text-xs', render: (row) => row.code },
            { id: 'scope', header: t('list.column.scope'), render: (row) => emailScopeLabels.label(t, row.scope) },
            { id: 'system', header: t('list.column.system'), render: (row) => (row.isSystem ? t('list.system.yes') : '—') },
          ]}
          renderActions={(row) =>
            canWrite && !row.isSystem ? (
              <RowActionMenu label={t('blocks.rowActions', { name: row.name })}>
                <RowActionMenuItem destructive onSelect={(): void => void remove(row)}>
                  {tc('common.action.delete')}
                </RowActionMenuItem>
              </RowActionMenu>
            ) : null
          }
        />
      </ListPage>
      {creating ? (
        <CreateCodeNameDialog title={t('blocks.create')} onSubmit={create} onClose={(): void => setCreating(false)} />
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
export default EmailBlocksPage;
