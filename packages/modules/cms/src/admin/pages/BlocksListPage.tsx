import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CmsBlockSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
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

export function BlocksListPage(): ReactNode {
  const t = useTranslation('cms');
  const { hasPermission } = useAuth();
  // The create route this screen links to takes the **write** code (feature
  // 091, batch 16), so the button is gated on the same one: a link whose
  // destination the operator's codes cannot open answers the admin's not-found
  // page, which says nothing about permissions at all. That is batch 14's
  // `/sales-channels/new` shape, applied to the five create entry points these
  // two modules have.
  const canWrite = hasPermission('cms.write');
  const [rows, setRows] = useState<CmsBlockSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await cmsClient.listBlocks();
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
        title={t('blocksList.title')}
        description={t('blocksList.description')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/cms/blocks/new">{t('blocksList.new')}</Link>
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
          <CardTitle className="text-base">{t('blocksList.cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('blocksList.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('blocksList.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.code')}</TableHead>
                  <TableHead>{t('columns.state')}</TableHead>
                  <TableHead>{t('columns.languages')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((block) => (
                  <TableRow key={block.id}>
                    <TableCell>
                      <Link
                        to={`/cms/blocks/${block.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {block.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{block.code}</TableCell>
                    <TableCell>
                      <Badge variant={block.active ? 'default' : 'outline'}>
                        {block.active ? t('state.active') : t('state.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {block.languages.join(', ')}
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
export default BlocksListPage;
