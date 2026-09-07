import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CmsTemplateSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';

export function TemplatesListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one: a link whose
  // destination the operator's codes cannot open answers the admin's not-found
  // page, which says nothing about permissions at all. That is batch 14's
  // `/sales-channels/new` shape, applied to the five create entry points these
  // two modules have.
  const canWrite = hasPermission('cms.write');
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
          canWrite ? (
            <Button asChild>
              <Link to="/cms/templates/new">{t('templatesList.new')}</Link>
            </Button>
          ) : null
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default TemplatesListPage;
