import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BlogPostStatus, BlogPostSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { blogClient } from '../api/blog-client';
import { PostStatusBadge } from '../components/PostStatusBadge';

const PER_PAGE = 20;

type StatusFilter = BlogPostStatus | '';

function pickPrimaryName(
  name: Record<string, string> | undefined | null,
  fallback: string,
): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

export function BlogPostListPage(): ReactNode {
  const t = useTranslation('blog');
  const [rows, setRows] = useState<BlogPostSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await blogClient.listPosts({
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        page,
        perPage: PER_PAGE,
      });
      setRows(out.data);
      setTotalPages(out.pagination.totalPages);
      setTotalItems(out.pagination.totalItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('postList.title')}
        description={t('postList.description')}
        actions={
          <Button asChild>
            <Link to="/blog/posts/new">{t('postList.newPost')}</Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t('postList.cardTitle')}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t('postList.total', { total: totalItems })}
            </span>
          </CardTitle>
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
              placeholder={t('postList.searchPlaceholder')}
              className="w-64"
            />
            <Select
              value={status}
              onChange={(event) => {
                setStatus((event.target.value as StatusFilter) ?? '');
                setPage(1);
              }}
              className="w-40"
            >
              <option value="">{t('postList.allStatuses')}</option>
              <option value="draft">{t('status.draft')}</option>
              <option value="published">{t('status.published')}</option>
              <option value="archived">{t('status.archived')}</option>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t('common.search')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('postList.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('postList.empty')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.name')}</TableHead>
                    <TableHead>{t('columns.slug')}</TableHead>
                    <TableHead>{t('columns.status')}</TableHead>
                    <TableHead>{t('columns.languages')}</TableHead>
                    <TableHead className="text-right">{t('columns.version')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <Link
                          to={`/blog/posts/${post.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {pickPrimaryName(post.name, post.slug)}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{post.slug}</TableCell>
                      <TableCell>
                        <PostStatusBadge status={post.status} active={post.active} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {post.languages.join(', ')}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        v{post.version}
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
