import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { CmsPage } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface ListEnvelope {
  data: CmsPage[];
}
interface SingleEnvelope {
  data: CmsPage;
}

const LOCALE_OPTIONS = ['en-US', 'pl-PL'];

export function CmsPagesPage(): ReactNode {
  const [rows, setRows] = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<CmsPage | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListEnvelope>('/api/v1/admin/cms/pages');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: {
      path: string;
      title: Record<string, string>;
      body: Record<string, string>;
    }): Promise<void> => {
      try {
        await apiClient.post<SingleEnvelope>('/api/v1/admin/cms/pages', input);
        setInfo('Page created as draft. Publish to expose it on the storefront.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const save = useCallback(
    async (
      id: string,
      patch: { title: Record<string, string>; body: Record<string, string> },
    ): Promise<void> => {
      try {
        await apiClient.patch<SingleEnvelope>(`/api/v1/admin/cms/pages/${id}`, patch);
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const action = useCallback(
    async (id: string, verb: 'publish' | 'unpublish' | 'archive'): Promise<void> => {
      try {
        await apiClient.post<SingleEnvelope>(`/api/v1/admin/cms/pages/${id}/${verb}`);
        setInfo(`Page ${verb}ed.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : `${verb} failed.`);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this page? This is permanent.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/cms/pages/${id}`);
        setInfo('Page deleted.');
        if (editing?.id === id) setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh, editing],
  );

  return (
    <>
      <PageHeader
        title="CMS pages"
        description="Editorial copy served at the configured path. Title and body are multilingual."
      />

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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Create page</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePageForm onSubmit={create} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Pages</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No CMS pages yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono">/{row.path}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(row.publishedAt)}</TableCell>
                    <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => setEditing(editing?.id === row.id ? null : row)}
                        >
                          {editing?.id === row.id ? 'Close' : 'Edit'}
                        </Button>
                        {row.status === 'published' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(): void => {
                              void action(row.id, 'unpublish');
                            }}
                          >
                            Unpublish
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={(): void => {
                              void action(row.id, 'publish');
                            }}
                          >
                            Publish
                          </Button>
                        )}
                        {row.status !== 'archived' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(): void => {
                              void action(row.id, 'archive');
                            }}
                          >
                            Archive
                          </Button>
                        ) : null}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => {
                            void remove(row.id);
                          }}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing ? <EditorCard page={editing} onSave={save} /> : null}
    </>
  );
}

function StatusBadge({ status }: { status: CmsPage['status'] }): ReactNode {
  const variant =
    status === 'published' ? 'success' : status === 'archived' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{status}</Badge>;
}

function CreatePageForm(props: {
  onSubmit: (input: {
    path: string;
    title: Record<string, string>;
    body: Record<string, string>;
  }) => Promise<void>;
}): ReactNode {
  const [path, setPath] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!path.trim() || !titleEn.trim()) return;
    setBusy(true);
    try {
      await props.onSubmit({
        path: path.trim(),
        title: { 'en-US': titleEn.trim() },
        body: { 'en-US': bodyEn },
      });
      setPath('');
      setTitleEn('');
      setBodyEn('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <div className="space-y-2">
        <Label>Path</Label>
        <Input
          value={path}
          onChange={(e): void => setPath(e.target.value)}
          placeholder="about-us or policies/privacy"
        />
        <p className="text-xs text-muted-foreground">kebab-case; / for nested paths.</p>
      </div>
      <div className="space-y-2">
        <Label>Title (en-US)</Label>
        <Input value={titleEn} onChange={(e): void => setTitleEn(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Body (en-US)</Label>
        <Textarea
          rows={6}
          value={bodyEn}
          onChange={(e): void => setBodyEn(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !path.trim() || !titleEn.trim()}>
        {busy ? 'Creating…' : 'Create page'}
      </Button>
    </form>
  );
}

function EditorCard(props: {
  page: CmsPage;
  onSave: (
    id: string,
    patch: { title: Record<string, string>; body: Record<string, string> },
  ) => Promise<void>;
}): ReactNode {
  const initialLocales = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(props.page.title),
          ...Object.keys(props.page.body),
          ...LOCALE_OPTIONS,
        ]),
      ),
    [props.page],
  );
  const [title, setTitle] = useState<Record<string, string>>(props.page.title);
  const [body, setBody] = useState<Record<string, string>>(props.page.body);
  const [busy, setBusy] = useState(false);

  const onSave = async (): Promise<void> => {
    setBusy(true);
    try {
      await props.onSave(props.page.id, { title, body });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Edit <code className="font-mono">/{props.page.path}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {initialLocales.map((locale) => (
          <div key={locale} className="space-y-3 rounded-md border p-4">
            <h3 className="text-sm font-semibold">{locale}</h3>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={title[locale] ?? ''}
                onChange={(e): void => setTitle((t) => ({ ...t, [locale]: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea
                rows={6}
                value={body[locale] ?? ''}
                onChange={(e): void => setBody((b) => ({ ...b, [locale]: e.target.value }))}
              />
            </div>
          </div>
        ))}
        <Button
          disabled={busy}
          onClick={(): void => {
            void onSave();
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </CardContent>
    </Card>
  );
}
