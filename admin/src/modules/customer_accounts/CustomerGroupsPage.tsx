import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  customerGroupsClient,
  type AdminCustomerGroup,
} from './api/customer-groups-client';

/**
 * Customer groups — the management screen (feature 076, D-79).
 *
 * The `PUT` and `DELETE` endpoints existed with no caller in this repository:
 * the SPA only ever listed groups, from three pickers. This screen is the
 * missing half. It writes through the same two endpoints, which is why creating
 * and editing are one form — the endpoint is an upsert keyed by `code`, so the
 * code is fixed once the group exists.
 */
export function CustomerGroupsPage(): ReactNode {
  const t = useTranslation('customer_accounts');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('customer_groups:write');
  const [rows, setRows] = useState<AdminCustomerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // `null` = the blank "new group" form; a row = an edit seeded from it. The
  // nonce remounts the blank form after a save so it does not keep stale input.
  const [editing, setEditing] = useState<AdminCustomerGroup | null>(null);
  const [formNonce, setFormNonce] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setRows(await customerGroupsClient.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('groups.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = useCallback((): void => {
    setEditing(null);
    setFormNonce((n) => n + 1);
  }, []);

  const handleSubmit = useCallback(
    async (value: GroupFormValue): Promise<void> => {
      setError(null);
      try {
        await customerGroupsClient.upsert(value.code, {
          code: value.code,
          name: value.name,
          description: value.description.trim() === '' ? null : value.description,
        });
        setInfo(t('groups.message.saved', { code: value.code }));
        resetForm();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('groups.error.save'));
      }
    },
    [refresh, resetForm, t],
  );

  const handleDelete = useCallback(
    async (row: AdminCustomerGroup): Promise<void> => {
      if (!confirm(t('groups.action.delete.confirm', { code: row.code }))) return;
      setError(null);
      try {
        await customerGroupsClient.remove(row.id);
        if (editing?.id === row.id) resetForm();
        setInfo(t('groups.message.deleted'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('groups.error.delete'));
      }
    },
    [editing, refresh, resetForm, t],
  );

  const startEdit = useCallback((row: AdminCustomerGroup): void => {
    setError(null);
    setInfo(null);
    setEditing(row);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <>
      <PageHeader title={t('groups.page.title')} description={t('groups.page.description')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {canWrite ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>
              {editing
                ? t('groups.form.editTitle', { code: editing.code })
                : t('groups.form.newTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GroupForm
              key={editing ? `edit-${editing.id}` : `new-${formNonce}`}
              initial={editing}
              onSubmit={handleSubmit}
              {...(editing ? { onCancel: resetForm } : {})}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('groups.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('groups.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('groups.column.code')}</TableHead>
                  <TableHead>{t('groups.column.name')}</TableHead>
                  <TableHead>{t('groups.column.description')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{row.code}</code>
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {canWrite ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={(): void => startEdit(row)}
                          >
                            <Pencil />
                            {t('groups.action.edit')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            type="button"
                            onClick={(): void => void handleDelete(row)}
                          >
                            <Trash2 />
                            {t('groups.action.delete')}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

interface GroupFormValue {
  code: string;
  name: string;
  description: string;
}

function GroupForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AdminCustomerGroup | null;
  onSubmit: (value: GroupFormValue) => Promise<void>;
  onCancel?: () => void;
}): ReactNode {
  const t = useTranslation('customer_accounts');
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({ code, name, description });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cgcode">{t('groups.field.code')}</Label>
          <Input
            id="cgcode"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
            disabled={isEdit}
            aria-describedby="cgcode-help"
          />
          <p id="cgcode-help" className="text-xs text-muted-foreground">
            {t('groups.field.code.help')}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cgname">{t('groups.field.name')}</Label>
          <Input
            id="cgname"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="cgdesc">{t('groups.field.description')}</Label>
          <Input
            id="cgdesc"
            value={description}
            onChange={(e): void => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{t('groups.action.save')}</Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('groups.action.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
