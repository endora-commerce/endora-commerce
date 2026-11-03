import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiClient, normalize } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  status: 'active' | 'inactive';
  /** Archived is its own fact, independent of `status`. */
  archivedAt?: string | null;
  /** Feature 170 (FR-031) — the Global name; the admin catalogue answers no per-language map. */
  name: string;
}

function productLabel(name: string | undefined | null, fallback: string): string {
  return name || fallback;
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

  const needle = normalize(q);
  const candidates = allProducts.filter((product) => {
    if (value.includes(product.id)) return false;
    if (needle === '') return true;
    const haystack = `${normalize(productLabel(product.name, product.slug))} ${normalize(product.slug)} ${normalize(product.sku)}`;
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
        <Label>{t('relatedProducts.title', { count: value.length })}</Label>
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('relatedProducts.empty')}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {value.map((id, idx) => {
              const product = productsById.get(id);
              // `inactive` no longer means archived: each is named
              // for what it is, and either one dims the row.
              const archived = product?.archivedAt != null;
              const inactive = product?.status === 'inactive';
              return (
                <div
                  key={id}
                  className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-sm ${
                    !product || inactive || archived ? 'opacity-60' : ''
                  }`}
                >
                  <span className="min-w-[8rem] flex-1 truncate font-medium">
                    {product ? productLabel(product.name, product.slug) : t('relatedProducts.unknown')}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {product?.sku ?? id.slice(0, 8)}
                  </Badge>
                  {inactive ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t('productStatus.inactive')}
                    </Badge>
                  ) : null}
                  {archived ? (
                    <Badge variant="outline" className="text-[10px]">
                      {t('productStatus.archived')}
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
                className="w-full min-w-0 justify-start"
              >
                <span className="mr-2 shrink-0 font-mono text-[10px]">{product.sku}</span>
                <span className="min-w-0 truncate text-left">{productLabel(product.name, product.slug)}</span>
                <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                  {t(`productStatus.${product.status}`)}
                </Badge>
                {product.archivedAt != null ? (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {t('productStatus.archived')}
                  </Badge>
                ) : null}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
