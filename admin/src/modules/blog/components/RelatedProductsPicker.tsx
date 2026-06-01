import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n/useTranslation';

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  status: 'draft' | 'active' | 'inactive';
  name: Record<string, string>;
}

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface RelatedProductsPickerProps {
  /** Ordered list of related-product ids (Catalog product UUIDs). */
  value: string[];
  onChange: (next: string[]) => void;
}

export function RelatedProductsPicker({
  value,
  onChange,
}: RelatedProductsPickerProps): ReactNode {
  const t = useTranslation('blog');
  const [allProducts, setAllProducts] = useState<AdminProduct[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiClient
      .get<{ data: AdminProduct[] }>('/api/v1/admin/catalog/products?includeArchived=1')
      .then((res) => {
        if (!live) return;
        setAllProducts(res.data);
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

  const productsById = new Map(allProducts.map((p) => [p.id, p] as const));

  const candidates = allProducts.filter((product) => {
    if (value.includes(product.id)) return false;
    if (!q) return true;
    const haystack = `${pickName(product.name, product.slug)} ${product.slug} ${product.sku}`.toLowerCase();
    return haystack.includes(q.toLowerCase());
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
        <Label>{t('relatedProducts.title', { count: value.length })}</Label>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('relatedProducts.empty')}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {value.map((id, idx) => {
              const product = productsById.get(id);
              const inactive = product?.status === 'inactive';
              return (
                <div
                  key={id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
                    !product || inactive ? 'opacity-60' : ''
                  }`}
                >
                  <span className="flex-1 font-medium">
                    {product ? pickName(product.name, product.slug) : t('relatedProducts.unknown')}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {product?.sku ?? id.slice(0, 8)}
                  </Badge>
                  {inactive ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t('status.inactive')}
                    </Badge>
                  ) : null}
                  {!product ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t('state.missing')}
                    </Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={idx === 0}
                    onClick={() => move(id, 'up')}
                    aria-label={t('relatedProducts.moveUp')}
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
                    aria-label={t('relatedProducts.moveDown')}
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
        <Label htmlFor="related-products-q">{t('relatedProducts.add')}</Label>
        <Input
          id="related-products-q"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t('relatedProducts.searchPlaceholder')}
        />
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('relatedProducts.loading')}</p>
        ) : candidates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {q ? t('relatedProducts.noMatches') : t('relatedProducts.noCandidates')}
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {candidates.slice(0, 15).map((product) => (
              <Button
                key={product.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => attach(product.id)}
                className="justify-start"
              >
                <span className="mr-2 font-mono text-[10px]">{product.sku}</span>
                <span className="text-left">{pickName(product.name, product.slug)}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {t(`productStatus.${product.status}`)}
                </Badge>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
