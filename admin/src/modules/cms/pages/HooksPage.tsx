import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CmsHookSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { cmsClient } from '../api/cms-client';
import { HookBlockAttachmentsPanel } from '../components/HookBlockAttachmentsPanel';

export function HooksPage(): ReactNode {
  const t = useTranslation('cms');
  const [rows, setRows] = useState<CmsHookSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await cmsClient.listHooks();
      setRows(out.data);
      setSelectedId((current) => current ?? out.data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = rows.find((hook) => hook.id === selectedId) ?? null;

  return (
    <div className="b2b-page b2b-page--wide space-y-4">
      <PageHeader
        title={t('hooksList.title')}
        description={t('hooksList.description')}
        actions={
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {t('common.refresh')}
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-7">
          <CardHeader>
            <CardTitle className="text-base">{t('hooksList.cardTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t('hooksList.loading')}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('hooksList.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.name')}</TableHead>
                    <TableHead>{t('columns.code')}</TableHead>
                    <TableHead>{t('columns.state')}</TableHead>
                    <TableHead className="text-right">{t('columns.channels')}</TableHead>
                    <TableHead className="text-right">{t('columns.blocks')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((hook) => (
                    <TableRow
                      key={hook.id}
                      className={hook.id === selectedId ? 'bg-muted/50' : undefined}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-medium text-primary hover:underline"
                          onClick={() => setSelectedId(hook.id)}
                        >
                          {hook.name}
                        </button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{hook.code}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={hook.active ? 'default' : 'outline'}>
                            {hook.active ? t('state.active') : t('state.inactive')}
                          </Badge>
                          {hook.isSystem ? (
                            <Badge variant="outline">{t('state.system')}</Badge>
                          ) : (
                            <Badge variant="secondary">{t('state.custom')}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {hook.salesChannelIds.length}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {hook.attachmentCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="col-span-5">
          <HookBlockAttachmentsPanel hook={selected} onChanged={() => void load()} />
        </div>
      </div>
    </div>
  );
}
