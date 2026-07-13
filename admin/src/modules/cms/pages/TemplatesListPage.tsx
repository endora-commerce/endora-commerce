import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CmsTemplateSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export function TemplatesListPage(): ReactNode {
  const t = useTranslation('cms');
  const [rows, setRows] = useState<CmsTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await cmsClient.listTemplates();
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

  return (
    <div className="b2b-page b2b-page--wide space-y-4">
      <PageHeader
        title={t('templatesList.title')}
        description={t('templatesList.description')}
        actions={
          <Button asChild>
            <Link to="/cms/templates/new">{t('templatesList.new')}</Link>
          </Button>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('templatesList.cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('templatesList.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('templatesList.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.code')}</TableHead>
                  <TableHead>{t('columns.languages')}</TableHead>
                  <TableHead className="text-right">{t('columns.version')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <Link
                        to={`/cms/templates/${template.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {template.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{template.code}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {template.languages.join(', ')}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      v{template.version}
                    </TableCell>
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
