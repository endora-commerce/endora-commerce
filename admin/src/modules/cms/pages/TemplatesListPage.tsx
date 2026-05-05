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
import { cmsClient } from '../api/cms-client';

export function TemplatesListPage(): ReactNode {
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
    <div className="space-y-4">
      <PageHeader
        title="CMS Templates"
        description="Reusable Page Builder fragments embedded in pages or blocks via InsertTemplate."
        actions={
          <Button asChild>
            <Link to="/cms/templates/new">New template</Link>
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
          <CardTitle className="text-base">Templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading CMS templates…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Languages</TableHead>
                  <TableHead className="text-right">Version</TableHead>
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
