import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import type { ApiKey, ApiKeyListResponse } from '@endora-commerce/contracts';
import { Link } from 'react-router-dom';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Badge,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  RowActionMenu,
  RowActionMenuItem,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { API_KEYS_NEW_PATH } from '../paths.js';

/**
 * The API-keys list — the kit's `ListPage` (issue #1501, UX audit SHELL-14).
 * The create form used to be drawn open above the table; it is its own route
 * now (`ApiKeyCreatePage`, `/api-keys/new`), reached from the header's *New API
 * key* — the form is long, and the one-time token it ends on deserves a screen
 * of its own rather than a card above a list. *Revoke* is in the row's overflow
 * menu and confirmed (Fitts: destructive actions get distance).
 */
export default function ApiKeysPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // Feature 062 — best-effort id → name lookup for the binding column.
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await apiClient.get<ApiKeyListResponse>('/api/v1/admin/api-keys');
      setKeys(res.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.load') });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve organization names for bound keys (same pattern as WebhooksPage).
  useEffect(() => {
    const missing = Array.from(
      new Set(
        keys
          .map((k) => k.organizationId)
          .filter((id): id is string => typeof id === 'string' && !orgNames.has(id)),
      ),
    );
    if (missing.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await apiClient.get<{ data: { name: string } }>(
              `/api/v1/admin/organizations/${id}`,
            );
            return [id, res.data.name] as const;
          } catch {
            return [id, id] as const;
          }
        }),
      );
      setOrgNames((prev) => {
        const next = new Map(prev);
        for (const [id, name] of entries) next.set(id, name);
        return next;
      });
    })();
  }, [keys, orgNames]);

  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('apiKeys.action.revokeConfirm'),
        confirmLabel: t('apiKeys.action.revoke'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/api-keys/${id}`),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.revoke')),
      });
      if (ok) await refresh();
    },
    [refresh, t, confirm],
  );

  const newKeyLink = (variant: 'default' | 'outline'): ReactNode => (
    <Button asChild variant={variant}>
      <Link to={API_KEYS_NEW_PATH}>
        <Plus aria-hidden="true" />
        {t('apiKeys.create.action')}
      </Link>
    </Button>
  );

  return (
    <>
      <ListPage
        title={t('apiKeys.page.title')}
        actions={newKeyLink('default')}
        load={load}
        onRetry={(): void => void refresh()}
      >
        {keys.length === 0 ? (
          <EmptyState icon={<KeyRound size={20} />} title={t('apiKeys.empty')} action={newKeyLink('outline')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('apiKeys.column.name')}</TableHead>
                <TableHead>{t('apiKeys.column.status')}</TableHead>
                <TableHead>{t('apiKeys.column.scopes')}</TableHead>
                <TableHead>{t('apiKeys.column.binding')}</TableHead>
                <TableHead>{t('apiKeys.column.expires')}</TableHead>
                <TableHead>{t('apiKeys.column.last4')}</TableHead>
                <TableHead>{t('apiKeys.column.lastUsed')}</TableHead>
                <TableHead>{t('apiKeys.column.created')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <Badge variant={k.status === 'active' ? 'success' : 'destructive'}>
                      {t(`apiKeys.status.${k.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="font-mono text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {k.organizationId ? (
                      <Badge variant="outline">{orgNames.get(k.organizationId) ?? k.organizationId}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('apiKeys.binding.unbound')}</span>
                    )}
                  </TableCell>
                  <TableCell>{k.expiresAt ? formatDateTime(k.expiresAt) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">…{k.lastFour}</TableCell>
                  <TableCell>{formatDateTime(k.lastUsedAt)}</TableCell>
                  <TableCell>{formatDateTime(k.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {/* A revoked key has nothing left to do: no menu rather than an empty one. */}
                    {k.status === 'active' ? (
                      <RowActionMenu label={t('apiKeys.rowActions', { name: k.name })}>
                        <RowActionMenuItem destructive onSelect={(): void => void handleRevoke(k.id)}>
                          {t('apiKeys.action.revoke')}
                        </RowActionMenuItem>
                      </RowActionMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPage>
      {confirmDialog}
    </>
  );
}
