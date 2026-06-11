import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AdminUserPicker } from '@/components/admin-user-picker/AdminUserPicker';
import { CustomerPicker } from '@/components/customer-picker/CustomerPicker';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { useTranslationContext } from '@/i18n/TranslationProvider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Audit Log viewer (T195 / FR-084). Append-only — no edit / delete UI.
 * Filters mirror the backend query: actor, action, objectType, objectId,
 * impersonated customer. The detail row expands stateBefore / stateAfter
 * as JSON so support can compare changes inline.
 */

interface AuditLogRow {
  id: string;
  actorAdminUserId: string | null;
  /** Enriched by the backend — actor's full name, when resolvable. */
  actorName: string | null;
  /** Enriched by the backend — actor's email, when resolvable. */
  actorEmail: string | null;
  impersonatedCustomerAccountId: string | null;
  actedAt: string;
  action: string;
  actionModuleId?: string;
  objectType: string;
  objectId: string;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function AuditLogViewer(): ReactNode {
  const t = useTranslation('core');
  const { t: translate } = useTranslationContext();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [objectId, setObjectId] = useState('');
  const [impersonated, setImpersonated] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actor) params.set('filter[actor]', actor);
      if (action) params.set('filter[action]', action);
      if (objectType) params.set('filter[objectType]', objectType);
      if (objectId) params.set('filter[objectId]', objectId);
      if (impersonated) params.set('filter[customer]', impersonated);
      const path = '/api/v1/admin/audit-log' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AuditLogRow[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('auditLog.error.load'));
    } finally {
      setLoading(false);
    }
  }, [actor, action, objectType, objectId, impersonated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title={t('auditLog.page.title')}
        description={t('auditLog.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <form
            onSubmit={(e: FormEvent): void => {
              e.preventDefault();
              void refresh();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="f-action">{t('auditLog.filter.action')}</Label>
                <Input
                  id="f-action"
                  placeholder="product.update"
                  value={action}
                  onChange={(e): void => setAction(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-otype">{t('auditLog.filter.objectType')}</Label>
                <Input
                  id="f-otype"
                  placeholder="product"
                  value={objectType}
                  onChange={(e): void => setObjectType(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-oid">{t('auditLog.filter.objectId')}</Label>
                <Input
                  id="f-oid"
                  placeholder="UUID"
                  value={objectId}
                  onChange={(e): void => setObjectId(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-actor">{t('auditLog.filter.actor')}</Label>
                <AdminUserPicker
                  id="f-actor"
                  value={actor || null}
                  onChange={(v): void => setActor(v ?? '')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-customer">{t('auditLog.filter.impersonatedCustomer')}</Label>
                <CustomerPicker
                  id="f-customer"
                  value={impersonated || null}
                  onChange={(v): void => setImpersonated(v ?? '')}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t('auditLog.filter.apply')}</Button>
              <Button
                type="button"
                variant="outline"
                onClick={(): void => {
                  setActor('');
                  setAction('');
                  setObjectType('');
                  setObjectId('');
                  setImpersonated('');
                }}
              >
                {t('auditLog.filter.clear')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('auditLog.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('auditLog.column.when')}</TableHead>
                  <TableHead>{t('auditLog.column.actor')}</TableHead>
                  <TableHead>{t('auditLog.column.action')}</TableHead>
                  <TableHead>{t('auditLog.column.object')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell>{formatDateTime(r.actedAt)}</TableCell>
                      <TableCell>
                        <ActorCell row={r} />
                      </TableCell>
                      <TableCell>{translateAuditAction(translate, r)}</TableCell>
                      <TableCell>
                        {r.objectType}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {r.objectId.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => setExpandedId(expandedId === r.id ? null : r.id)}
                        >
                          {expandedId === r.id ? t('auditLog.action.hide') : t('auditLog.action.detail')}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedId === r.id ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <strong>{t('auditLog.detail.before')}</strong>
                              <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                                {JSON.stringify(r.stateBefore ?? null, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <strong>{t('auditLog.detail.after')}</strong>
                              <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                                {JSON.stringify(r.stateAfter ?? null, null, 2)}
                              </pre>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {t('auditLog.detail.ip')} {r.ipAddress ?? '—'} · {t('auditLog.detail.userAgent')}{' '}
                            {r.userAgent ? r.userAgent.slice(0, 60) : '—'} · {t('auditLog.detail.request')}{' '}
                            {r.requestId ?? '—'}
                            {r.impersonatedCustomerAccountId ? (
                              <>
                                {' '}
                                · {t('auditLog.detail.impersonatedCustomer')}{' '}
                                {r.impersonatedCustomerAccountId.slice(0, 8)}
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Renders the actor column: an admin user's name + email (linked to the
 * users admin page) when resolvable, the bare id as a fallback, or the
 * "system" label when there is no actor.
 */
function ActorCell({ row }: { row: AuditLogRow }): ReactNode {
  const t = useTranslation('core');
  if (!row.actorAdminUserId) {
    return <span className="text-muted-foreground">{t('auditLog.actor.system')}</span>;
  }
  const name = row.actorName?.trim();
  if (!name) {
    // Unknown / deleted admin user — keep the id so the row is still traceable.
    return <span className="font-mono text-xs">{row.actorAdminUserId.slice(0, 8)}</span>;
  }
  return (
    <Link
      to={`/admin-users#admin-user-${row.actorAdminUserId}`}
      className="underline underline-offset-2"
    >
      {name}
      {row.actorEmail ? (
        <span className="text-muted-foreground"> ({row.actorEmail})</span>
      ) : null}
    </Link>
  );
}

function translateAuditAction(
  translate: (
    scope: string,
    key: string,
    params?: Record<string, string | number>,
  ) => string,
  row: Pick<AuditLogRow, 'action' | 'actionModuleId'>,
): string {
  const moduleId = row.actionModuleId ?? 'core';
  const key = `auditLog.${row.action}`;
  const label = translate(moduleId, key);
  return label === `${moduleId}.${key}` ? row.action : label;
}
