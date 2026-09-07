import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BlogTagDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { blogClient } from '../api/blog-client.js';

const PER_PAGE = 50;

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface FormState {
  name: string;
  code: string;
  description: string;
}

const blankForm: FormState = { name: '', code: '', description: '' };

export function BlogTagListPage(): ReactNode {
  const t = useTranslation('blog');
  const [rows, setRows] = useState<BlogTagDetail[]>([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await blogClient.listTags({
        ...(q ? { q } : {}),
        page,
        perPage: PER_PAGE,
      });
      setRows(out.data);
      setTotalPages(out.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = useCallback((tag: BlogTagDetail) => {
    setEditingId(tag.id);
    setForm({
      name: pickName(tag.name, tag.code),
      code: tag.code,
      description: pickName(tag.description, ''),
    });
    setInfo(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setForm(blankForm);
  }, []);

  const onSubmit = useCallback(async () => {
    if (!form.name.trim() || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(form.code)) {
      setError(t('tagList.validation.invalidForm'));
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      if (editingId) {
        const existing = rows.find((r) => r.id === editingId);
        if (!existing) throw new Error(t('tagList.validation.missingTag'));
        await blogClient.patchTag(editingId, {
          name: { 'en-US': form.name },
          code: form.code,
          ...(form.description
            ? { description: { 'en-US': form.description } }
            : { description: null }),
          version: existing.version,
        });
        setInfo(t('tagList.messages.updated', { code: form.code }));
      } else {
        await blogClient.createTag({
          name: { 'en-US': form.name },
          code: form.code,
          ...(form.description ? { description: { 'en-US': form.description } } : {}),
        });
        setInfo(t('tagList.messages.created', { code: form.code }));
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editingId, form, rows, cancelEdit, load]);

  const onDelete = useCallback(
    async (tag: BlogTagDetail) => {
      const probe = await blogClient.getTagInboundReferences(tag.id);
      if (probe.totalPosts > 0) {
        const slugs = probe.posts.map((p) => p.slug).join(', ');
        if (
          !window.confirm(
            t('tagList.deleteConfirm.inUse', {
              code: tag.code,
              count: probe.totalPosts,
              slugs,
            }),
          )
        ) {
          return;
        }
      } else if (!window.confirm(t('tagList.deleteConfirm.default', { code: tag.code }))) {
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await blogClient.deleteTag(tag.id, tag.version);
        setInfo(t('tagList.messages.deleted', { code: tag.code }));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('tagList.title')}
        description={t('tagList.description')}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {editingId ? t('tagList.editTag') : t('tagList.newTag')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tag-name">{t('tagList.nameLabel')}</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="tag-code">{t('tagList.codeLabel')}</Label>
              <Input
                id="tag-code"
                value={form.code}
                onChange={(event) =>
                  setForm((f) => ({ ...f, code: event.target.value.toLowerCase() }))
                }
                className="font-mono"
                placeholder={t('tagList.codePlaceholder')}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="tag-description">{t('tagList.descriptionLabel')}</Label>
            <Input
              id="tag-description"
              value={form.description}
              onChange={(event) =>
                setForm((f) => ({ ...f, description: event.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            {editingId ? (
              <Button type="button" variant="outline" onClick={cancelEdit}>
                {t('common.cancel')}
              </Button>
            ) : null}
            <Button type="button" disabled={saving} onClick={() => void onSubmit()}>
              {saving ? t('common.saving') : editingId ? t('tagList.saveTag') : t('tagList.createTag')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t('tagList.cardTitle')}</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void load();
              }}
              placeholder={t('tagList.searchPlaceholder')}
              className="w-64"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tagList.empty')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.name')}</TableHead>
                    <TableHead>{t('columns.code')}</TableHead>
                    <TableHead>{t('columns.version')}</TableHead>
                    <TableHead className="text-right">{t('columns.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((tag) => (
                    <TableRow key={tag.id}>
                      <TableCell>{pickName(tag.name, tag.code)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {tag.code}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        v{tag.version}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(tag)}
                          className="mr-2"
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void onDelete(tag)}
                        >
                          {t('common.delete')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {totalPages > 1 ? (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t('pagination.page', { page, totalPages })}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t('pagination.previous')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      {t('pagination.next')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
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
export default BlogTagListPage;
