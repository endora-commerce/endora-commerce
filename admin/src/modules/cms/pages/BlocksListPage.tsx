import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CmsBlockSummary } from '@b2b/contracts';
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
import { cmsClient } from '../api/cms-client';

export function BlocksListPage(): ReactNode {
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
    <div className="space-y-4">
      <PageHeader
        title="CMS Blocks"
        description="Reusable Page Builder fragments embedded in pages or attached to hooks."
        actions={
          <Button asChild>
            <Link to="/cms/blocks/new">New block</Link>
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
          <CardTitle className="text-base">Blocks</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading CMS blocks…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocks found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Languages</TableHead>
                  <TableHead className="text-right">Version</TableHead>
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
                        {block.active ? 'active' : 'inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {block.languages.join(', ')}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      v{block.version}
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
