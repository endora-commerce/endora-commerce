import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MegamenuSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { megamenuClient } from '../api/megamenu-client';

export function MegamenuListPage(): ReactNode {
  const t = useTranslation('megamenu');
  const navigate = useNavigate();
  const [rows, setRows] = useState<MegamenuSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await megamenuClient.listMenus();
      setRows(out.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await megamenuClient.createMenu({ name: name.trim() });
      navigate(`/megamenu/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('list.newNamePlaceholder')}
              className="w-72"
            />
            <Button onClick={() => void create()} disabled={creating || !name.trim()}>
              {t('common.create')}
            </Button>
          </div>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('list.cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.bindings')}</TableHead>
                  <TableHead>{t('columns.active')}</TableHead>
                  <TableHead className="text-right">{t('columns.version')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link to={`/megamenu/${row.id}`} className="font-medium text-primary hover:underline">
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.bindings.length}
                    </TableCell>
                    <TableCell>
                      {row.activeIn > 0 ? (
                        <Badge>{t('list.activeScopes', { count: row.activeIn })}</Badge>
                      ) : (
                        <Badge variant="outline">{t('state.staged')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">v{row.version}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
