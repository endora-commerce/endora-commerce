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
import { useTranslation } from '@/i18n/useTranslation';
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
  const t = useTranslation('core');
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
      setInfo(t('legacyCmsPages.messages.created'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyCmsPages.errors.create'));
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
        setInfo(t('common.toast.saved'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyCmsPages.errors.save'));
      }
    },
    [refresh],
  );

  const action = useCallback(
    async (id: string, verb: 'publish' | 'unpublish' | 'archive'): Promise<void> => {
      try {
        await apiClient.post<SingleEnvelope>(`/api/v1/admin/cms/pages/${id}/${verb}`);
        setInfo(t(`legacyCmsPages.messages.${verb}`));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t(`legacyCmsPages.errors.${verb}`));
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('legacyCmsPages.deleteConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/cms/pages/${id}`);
        setInfo(t('legacyCmsPages.messages.deleted'));
        if (editing?.id === id) setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyCmsPages.errors.delete'));
      }
    },
    [refresh, editing],
  );

  return (
    <>
      <PageHeader
        title={t('legacyCmsPages.title')}
        description={t('legacyCmsPages.description')}
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
          <CardTitle>{t('legacyCmsPages.createTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePageForm onSubmit={create} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('legacyCmsPages.pagesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('legacyCmsPages.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('legacyCmsPages.columns.path')}</TableHead>
                  <TableHead>{t('legacyCmsPages.columns.status')}</TableHead>
                  <TableHead>{t('legacyCmsPages.columns.published')}</TableHead>
                  <TableHead>{t('legacyCmsPages.columns.updated')}</TableHead>
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
                          {editing?.id === row.id ? t('common.action.close') : t('common.action.edit')}
                        </Button>
                        {row.status === 'published' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(): void => {
                              void action(row.id, 'unpublish');
                            }}
                          >
                            {t('legacyCmsPages.actions.unpublish')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={(): void => {
                              void action(row.id, 'publish');
                            }}
                          >
                            {t('legacyCmsPages.actions.publish')}
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
                            {t('legacyCmsPages.actions.archive')}
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
                          {t('common.action.delete')}
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
  const t = useTranslation('core');
  const variant =
    status === 'published' ? 'success' : status === 'archived' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{t(`legacyCmsPages.status.${status}`)}</Badge>;
}

function CreatePageForm(props: {
  onSubmit: (input: {
    path: string;
    title: Record<string, string>;
    body: Record<string, string>;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
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
        <Label>{t('legacyCmsPages.fields.path')}</Label>
        <Input
          value={path}
          onChange={(e): void => setPath(e.target.value)}
          placeholder={t('legacyCmsPages.placeholders.path')}
        />
        <p className="text-xs text-muted-foreground">{t('legacyCmsPages.pathHelp')}</p>
      </div>
      <div className="space-y-2">
        <Label>{t('legacyCmsPages.fields.titleEn')}</Label>
        <Input value={titleEn} onChange={(e): void => setTitleEn(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>{t('legacyCmsPages.fields.bodyEn')}</Label>
        <Textarea
          rows={6}
          value={bodyEn}
          onChange={(e): void => setBodyEn(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={busy || !path.trim() || !titleEn.trim()}>
        {busy ? t('legacyCmsPages.actions.creating') : t('legacyCmsPages.actions.create')}
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
  const t = useTranslation('core');
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
          {t('legacyCmsPages.editTitle')} <code className="font-mono">/{props.page.path}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {initialLocales.map((locale) => (
          <div key={locale} className="space-y-3 rounded-md border p-4">
            <h3 className="text-sm font-semibold">{locale}</h3>
            <div className="space-y-2">
              <Label>{t('legacyCmsPages.fields.title')}</Label>
              <Input
                value={title[locale] ?? ''}
                onChange={(e): void => setTitle((t) => ({ ...t, [locale]: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('legacyCmsPages.fields.body')}</Label>
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
          {busy ? t('legacyCmsPages.actions.saving') : t('common.action.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
