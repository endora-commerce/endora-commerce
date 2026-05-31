import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

interface StatusDef {
  code: string;
  name: Record<string, string>;
  isInitial: boolean;
  isTerminal: boolean;
  isSystem: boolean;
  weight: number;
  inUseCount: number;
}
interface TransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
  isSystem: boolean;
}
interface StatusGraph {
  statuses: StatusDef[];
  transitions: TransitionDef[];
}

function statusLabel(s: StatusDef): string {
  return s.name['en'] ?? Object.values(s.name)[0] ?? s.code;
}

export function OrderStatusConfigPage(): ReactNode {
  const t = useTranslation('core');
  const [graph, setGraph] = useState<StatusGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newTerminal, setNewTerminal] = useState(false);
  const [transFrom, setTransFrom] = useState('');
  const [transTo, setTransTo] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: StatusGraph }>('/api/v1/admin/orders/statuses');
      setGraph(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Operation failed.');
      }
    },
    [load],
  );

  const addStatus = (): void => {
    if (!newCode.trim()) return;
    void run(async () => {
      await apiClient.post('/api/v1/admin/orders/statuses', {
        code: newCode.trim(),
        name: { en: newName.trim() || newCode.trim() },
        isTerminal: newTerminal,
      });
      setNewCode('');
      setNewName('');
      setNewTerminal(false);
    });
  };

  const deleteStatus = (code: string): void => {
    void run(() => apiClient.delete(`/api/v1/admin/orders/statuses/${code}`));
  };

  const addTransition = (): void => {
    if (!transFrom || !transTo || transFrom === transTo) return;
    void run(async () => {
      await apiClient.put('/api/v1/admin/orders/transitions', {
        add: [{ fromStatusCode: transFrom, toStatusCode: transTo }],
      });
      setTransFrom('');
      setTransTo('');
    });
  };

  const removeTransition = (from: string, to: string): void => {
    void run(() =>
      apiClient.put('/api/v1/admin/orders/transitions', {
        remove: [{ fromStatusCode: from, toStatusCode: to }],
      }),
    );
  };

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>;

  const statuses = graph?.statuses ?? [];

  return (
    <>
      <PageHeader
        title={t('orderStatusConfig.title')}
        description={t('orderStatusConfig.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/orders">
              <ArrowLeft />
              {t('common.action.back')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('orderStatusConfig.statuses')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderStatusConfig.col.code')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.name')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.flags')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.inUse')}</TableHead>
                <TableHead aria-label="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => {
                const locked = s.isSystem || s.isInitial || s.inUseCount > 0;
                return (
                  <TableRow key={s.code}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell>{statusLabel(s)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        s.isInitial ? t('orderStatusConfig.flag.initial') : null,
                        s.isTerminal ? t('orderStatusConfig.flag.terminal') : null,
                        s.isSystem ? t('orderStatusConfig.flag.system') : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </TableCell>
                    <TableCell className="tabular-nums">{s.inUseCount}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={locked}
                        aria-label={`delete-${s.code}`}
                        onClick={(): void => deleteStatus(s.code)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="newCode">{t('orderStatusConfig.col.code')}</Label>
              <input
                id="newCode"
                className="h-9 rounded-md border px-3 text-sm"
                value={newCode}
                onChange={(e): void => setNewCode(e.target.value)}
                placeholder="awaiting_stock"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="newName">{t('orderStatusConfig.col.name')}</Label>
              <input
                id="newName"
                className="h-9 rounded-md border px-3 text-sm"
                value={newName}
                onChange={(e): void => setNewName(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newTerminal}
                onChange={(e): void => setNewTerminal(e.target.checked)}
              />
              {t('orderStatusConfig.flag.terminal')}
            </label>
            <Button onClick={addStatus} disabled={!newCode.trim()}>
              <Plus />
              {t('orderStatusConfig.addStatus')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orderStatusConfig.transitions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderStatusConfig.col.from')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.to')}</TableHead>
                <TableHead aria-label="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(graph?.transitions ?? []).map((tr) => (
                <TableRow key={`${tr.fromStatusCode}->${tr.toStatusCode}`}>
                  <TableCell className="font-mono text-xs">{tr.fromStatusCode}</TableCell>
                  <TableCell className="font-mono text-xs">{tr.toStatusCode}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={tr.isSystem}
                      aria-label={`remove-${tr.fromStatusCode}-${tr.toStatusCode}`}
                      onClick={(): void => removeTransition(tr.fromStatusCode, tr.toStatusCode)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="transFrom">{t('orderStatusConfig.col.from')}</Label>
              <Select id="transFrom" value={transFrom} onChange={(e): void => setTransFrom(e.target.value)}>
                <option value="">—</option>
                {statuses.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="transTo">{t('orderStatusConfig.col.to')}</Label>
              <Select id="transTo" value={transTo} onChange={(e): void => setTransTo(e.target.value)}>
                <option value="">—</option>
                {statuses.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={addTransition} disabled={!transFrom || !transTo || transFrom === transTo}>
              <Plus />
              {t('orderStatusConfig.addTransition')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
