import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BlogPostStatus, BlogPostSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
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
        title="Blog posts"
        description="Author and publish editorial content with the same Page Builder used for CMS pages."
        actions={
          <Button asChild>
            <Link to="/blog/posts/new">New post</Link>
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
            Posts
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({totalItems} total)
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
              placeholder="Search name or slug…"
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
              <option value="">All statuses</option>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Search
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading blog posts…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Languages</TableHead>
                    <TableHead className="text-right">Version</TableHead>
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
                    Page {page} / {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
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
