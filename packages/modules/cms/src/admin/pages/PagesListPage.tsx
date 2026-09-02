import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CmsPageSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
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

export function PagesListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one: a link whose
  // destination the operator's codes cannot open answers the admin's not-found
  // page, which says nothing about permissions at all. That is batch 14's
  // `/sales-channels/new` shape, applied to the five create entry points these
  // two modules have.
  const canWrite = hasPermission('cms.write');
  const [rows, setRows] = useState<CmsPageSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await cmsClient.listPages({ ...(q ? { q } : {}), limit: 50 });
      setRows(out.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="b2b-page b2b-page--wide space-y-4">
      <PageHeader
        title={t('pagesList.title')}
        description={t('pagesList.description')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/cms/pages/new">{t('pagesList.new')}</Link>
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
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t('pagesList.cardTitle')}</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void load();
              }}
              placeholder={t('pagesList.searchPlaceholder')}
              className="w-64"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t('common.search')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('pagesList.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pagesList.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.slug')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead>{t('columns.languages')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell>
                      <Link
                        to={`/cms/pages/${page.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {page.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{page.slug}</TableCell>
                    <TableCell>
                      <Badge variant={page.status === 'published' ? 'default' : 'outline'}>
                        {t(`status.${page.status}`)}
                      </Badge>
                      {!page.active ? (
                        <Badge variant="outline" className="ml-2">
                          {t('state.inactive')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {page.languages.join(', ')}
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
export default PagesListPage;
