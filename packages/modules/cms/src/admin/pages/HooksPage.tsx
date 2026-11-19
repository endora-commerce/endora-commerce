import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Anchor, RotateCw } from 'lucide-react';
import type { CmsHookSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, EmptyState, Card, CardContent, PageHeader, Skeleton } from '@endora-commerce/admin-kit/ui';
import {
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useConfirmDialog,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
import { HookBlockAttachmentsPanel } from '../components/HookBlockAttachmentsPanel.js';
import { cmsDeleteErrorMessage, loadErrorMessage } from '../components/list-delete-error.js';

const SKELETON_ROWS = ['a', 'b', 'c', 'd'] as const;

/**
 * The CMS hooks screen: the hook list beside the selected hook's attached
 * blocks. Issue #1495 (UX audit CONTENT-13): no card titled with the page's own
 * title, the kit empty state and a skeleton instead of a grey sentence, and a
 * row menu that deletes a **custom** hook through the confirmation and
 * `DELETE /api/v1/admin/cms/hooks/:id`. A system hook is refused by the server
 * (`CMS_HOOK_SYSTEM_PROTECTED`), so it is offered no delete at all.
 */
export function HooksPage(): ReactNode {
  const t = useTranslation('cms');
  const tc = useTranslation('core');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cms.write');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<CmsHookSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setFailed(false);
    try {
      const out = await cmsClient.listHooks();
      setRows(out.data);
      setSelectedId((current) => current ?? out.data[0]?.id ?? null);
    } catch (err) {
      setFailed(true);
      setError(loadErrorMessage(err).message ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (hook: CmsHookSummary): Promise<void> => {
    setNotice(null);
    const deleted = await confirm({
      title: t('hooksList.deleteTitle'),
      message: t('hooksList.deleteConfirm', { name: hook.name }),
      confirmLabel: t('listActions.delete'),
      destructive: true,
      action: () => cmsClient.deleteHook(hook.id),
      describeError: (err) => cmsDeleteErrorMessage(err, t),
    });
    if (!deleted) return;
    setRows((current) => current.filter((row) => row.id !== hook.id));
    setSelectedId((current) => (current === hook.id ? null : current));
    setNotice(t('hooksList.deleted', { name: hook.name }));
  };

  const selected = rows.find((hook) => hook.id === selectedId) ?? null;
  const columns: ResponsiveColumn<CmsHookSummary>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      render: (hook) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          onClick={() => setSelectedId(hook.id)}
        >
          {hook.name}
        </button>
      ),
      meta: (hook) => <code className="text-xs">{hook.code}</code>,
    },
    {
      id: 'code',
      header: t('columns.code'),
      hideOnMobile: true,
      render: (hook) => <code className="text-xs">{hook.code}</code>,
    },
    {
      id: 'state',
      header: t('columns.state'),
      render: (hook) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={hook.active ? 'success' : 'outline'}>
            {hook.active ? t('state.active') : t('state.inactive')}
          </Badge>
          {hook.isSystem ? (
            <Badge variant="outline">{t('state.system')}</Badge>
          ) : (
            <Badge variant="secondary">{t('state.custom')}</Badge>
          )}
        </span>
      ),
    },
    {
      id: 'channels',
      header: t('columns.channels'),
      hideOnMobile: true,
      className: 'text-right',
      render: (hook) => <span className="text-xs text-muted-foreground">{hook.salesChannelIds.length}</span>,
    },
    {
      id: 'blocks',
      header: t('columns.blocks'),
      className: 'text-right',
      render: (hook) => <span className="text-xs text-muted-foreground">{hook.attachmentCount}</span>,
    },
  ];

  return (
    <div className="b2b-page b2b-page--wide space-y-4">
      <PageHeader
        title={t('hooksList.title')}
        help={t('hooksList.help')}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RotateCw size={14} aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        }
      />
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-7" aria-busy={loading || undefined}>
          <CardContent className="space-y-4 p-4">
            {notice ? (
              <Alert live="polite">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {failed ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{error ?? tc('common.list.loadError')}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                    <RotateCw size={14} aria-hidden="true" />
                    {tc('common.action.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {loading ? (
              <div aria-hidden="true" className="space-y-3">
                {SKELETON_ROWS.map((row) => (
                  <Skeleton key={row} className="h-9" />
                ))}
              </div>
            ) : failed ? null : (
              <ResponsiveTable
                columns={columns}
                data={rows}
                keyExtractor={(hook) => hook.id}
                emptyState={<EmptyState icon={<Anchor size={20} />} title={t('hooksList.emptyTitle')} />}
                {...(canWrite
                  ? {
                      renderActions: (hook: CmsHookSummary) =>
                        hook.isSystem ? null : (
                          <RowActionMenu label={t('listActions.label', { name: hook.name })}>
                            <RowActionMenuItem destructive onSelect={() => void remove(hook)}>
                              {t('listActions.delete')}
                            </RowActionMenuItem>
                          </RowActionMenu>
                        ),
                    }
                  : {})}
              />
            )}
          </CardContent>
        </Card>
        <div className="col-span-5">
          <HookBlockAttachmentsPanel hook={selected} onChanged={() => void load()} />
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default HooksPage;
