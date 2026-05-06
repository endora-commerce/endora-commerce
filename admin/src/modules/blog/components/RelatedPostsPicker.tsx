import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BlogPostSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { blogClient } from '../api/blog-client';

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface RelatedPostsPickerProps {
  /** Ordered list of related-post ids. */
  value: string[];
  /** Id of the parent post — refused as a related entry (self-reference guard). */
  selfId: string;
  onChange: (next: string[]) => void;
}

export function RelatedPostsPicker({
  value,
  selfId,
  onChange,
}: RelatedPostsPickerProps): ReactNode {
  const [allPosts, setAllPosts] = useState<BlogPostSummary[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (search: string): Promise<void> => {
    setLoading(true);
    try {
      const out = await blogClient.listPosts({
        ...(search ? { q: search } : {}),
        perPage: 50,
      });
      setAllPosts(out.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload('');
  }, [reload]);

  const postsById = new Map(allPosts.map((p) => [p.id, p] as const));

  // Candidates: not the parent itself, not already attached, optionally
  // matching the search query.
  const candidates = allPosts.filter((post) => {
    if (post.id === selfId) return false;
    if (value.includes(post.id)) return false;
    if (!q) return true;
    const haystack = `${pickName(post.name, post.slug)} ${post.slug}`.toLowerCase();
    return haystack.includes(q.toLowerCase());
  });

  const attach = useCallback(
    (id: string) => {
      if (id === selfId) return;
      onChange([...value, id]);
    },
    [onChange, selfId, value],
  );

  const detach = useCallback(
    (id: string) => onChange(value.filter((existing) => existing !== id)),
    [onChange, value],
  );

  const move = useCallback(
    (id: string, dir: 'up' | 'down') => {
      const idx = value.indexOf(id);
      if (idx < 0) return;
      const next = dir === 'up' ? idx - 1 : idx + 1;
      if (next < 0 || next >= value.length) return;
      const out = [...value];
      [out[idx], out[next]] = [out[next] as string, out[idx] as string];
      onChange(out);
    },
    [onChange, value],
  );

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <Label>Related posts ({value.length})</Label>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">No related posts.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {value.map((id, idx) => {
              const post = postsById.get(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
                >
                  <span className="flex-1 font-medium">
                    {post ? pickName(post.name, post.slug) : '(loading…)'}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {post?.slug ?? id.slice(0, 8)}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={idx === 0}
                    onClick={() => move(id, 'up')}
                    aria-label="Move related post up"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={idx === value.length - 1}
                    onClick={() => move(id, 'down')}
                    aria-label="Move related post down"
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => detach(id)}
                  >
                    ×
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="related-posts-q">Add post</Label>
        <div className="flex gap-2">
          <Input
            id="related-posts-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void reload(q);
            }}
            placeholder="Search name or slug…"
          />
          <Button type="button" variant="outline" onClick={() => void reload(q)}>
            Search
          </Button>
        </div>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading posts…</p>
        ) : candidates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {q
              ? 'No matching posts.'
              : 'No more candidates (all visible posts are either this one or already attached).'}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {candidates.slice(0, 15).map((post) => (
              <Button
                key={post.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => attach(post.id)}
                className="justify-start"
              >
                <span className="mr-2 font-mono text-[10px]">{post.slug}</span>
                <span className="text-left">{pickName(post.name, post.slug)}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {post.status}
                </Badge>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
