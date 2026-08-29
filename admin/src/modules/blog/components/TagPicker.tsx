import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BlogTagDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n/useTranslation';
import { blogClient } from '../api/blog-client';
import { normalize } from '@/lib/text-normalization';

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface TagPickerProps {
  /** Ordered list of currently-attached tag ids. */
  value: string[];
  onChange: (next: string[]) => void;
}

export function TagPicker({ value, onChange }: TagPickerProps): ReactNode {
  const t = useTranslation('blog');
  const [allTags, setAllTags] = useState<BlogTagDetail[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    blogClient
      .listTags({ perPage: 100 })
      .then((res) => {
        if (!live) return;
        setAllTags(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const tagsById = new Map(allTags.map((t) => [t.id, t] as const));

  const needle = normalize(q);
  const candidates = allTags.filter((tag) => {
    if (value.includes(tag.id)) return false;
    if (needle === '') return true;
    const haystack = `${normalize(pickName(tag.name, tag.code))} ${normalize(tag.code)}`;
    return haystack.includes(needle);
  });

  const attach = useCallback(
    (id: string) => onChange([...value, id]),
    [onChange, value],
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
        <Label>{t('tagPicker.title', { count: value.length })}</Label>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('tagPicker.empty')}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {value.map((id, idx) => {
              const tag = tagsById.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                >
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {tag?.code ?? id}
                  </Badge>
                  <span>{tag ? pickName(tag.name, tag.code) : t('common.unknown')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-1 h-6 w-6 p-0"
                    disabled={idx === 0}
                    onClick={() => move(id, 'up')}
                    aria-label={t('tagPicker.moveUp')}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={idx === value.length - 1}
                    onClick={() => move(id, 'down')}
                    aria-label={t('tagPicker.moveDown')}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => detach(id)}
                  >
                    ×
                  </Button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="tag-picker-search">{t('tagPicker.add')}</Label>
        <Input
          id="tag-picker-search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t('tagPicker.searchPlaceholder')}
        />
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('tagPicker.loading')}</p>
        ) : candidates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {q ? t('tagPicker.noMatches') : t('tagPicker.noCandidates')}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {candidates.slice(0, 25).map((tag) => (
              <Button
                key={tag.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => attach(tag.id)}
              >
                <span className="mr-2 font-mono text-[10px]">{tag.code}</span>
                {pickName(tag.name, tag.code)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
