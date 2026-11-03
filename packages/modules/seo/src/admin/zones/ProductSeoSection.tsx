import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import type { AdminZoneProps, ResolvedMeta, ScopeRef, ScopedFieldView } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { Button, Input, Textarea } from '@endora-commerce/admin-kit/ui';
import { ScopedField, ScopedFieldGrid } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 170 (T125; US10, FR-090…FR-093, `contracts/editor-ui.md` §5) — `seo`'s section of
 * the product editor, contributed to `product.editor.seo`. It shows the product's SEO fields at
 * the **editor scope** (Global, Channel or Channel × language) as `ScopedField`s with their
 * source, read from `GET /api/v1/admin/seo/meta/product/:id`; an empty field names the derived
 * value the storefront falls back to. It never writes: every change goes to the host through
 * `onStage`, and the product editor's one Save writes it with the catalog values in one Command.
 *
 * When the host's read already carries the SEO views (`view`), those are shown, so the section
 * and the editor agree after a save; the section's own read then supplies the derived values.
 */

export type ProductSeoSectionProps = AdminZoneProps<'product.editor.seo'>;

const FIELDS = ['title', 'description', 'ogTitle', 'ogDescription', 'ogImageUrl'] as const;
type SeoField = (typeof FIELDS)[number];
const MULTILINE = new Set<SeoField>(['description', 'ogDescription']);
const MAX_LENGTH: Record<SeoField, number> = { title: 255, description: 1000, ogTitle: 255, ogDescription: 1000, ogImageUrl: 2048 };

interface SeoProductRead {
  scope: ScopeRef;
  scoped: Record<SeoField, ScopedFieldView<string>>;
  resolved: ResolvedMeta;
}

function query(scope: ScopeRef): string {
  if (scope.level === 'global') return '';
  const sp = new URLSearchParams({ channelId: scope.channelId });
  if (scope.level === 'channel_language') sp.set('languageCode', scope.languageCode);
  return `?${sp.toString()}`;
}

function derivedOf(field: SeoField, resolved: ResolvedMeta): string | null {
  switch (field) {
    case 'title':
      return resolved.title || null;
    case 'description':
      return resolved.description || null;
    case 'ogTitle':
      return resolved.openGraph.title || null;
    case 'ogDescription':
      return resolved.openGraph.description || null;
    case 'ogImageUrl':
      return resolved.openGraph.image;
  }
}

export function ProductSeoSection(props: ProductSeoSectionProps): ReactNode {
  const { productId, scope, scopeLabel, parentScopeLabel, view, staged, onStage, readOnly, errors, version } = props;
  const t = useTranslation('seo');
  const [read, setRead] = useState<SeoProductRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const scopeQuery = query(scope);

  const load = useCallback(async (): Promise<SeoProductRead> => {
    const res = await apiClient.get<{ data: SeoProductRead }>(
      `/api/v1/admin/seo/meta/product/${encodeURIComponent(productId)}${scopeQuery}`,
    );
    return res.data;
  }, [productId, scopeQuery]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    load()
      .then((data) => {
        if (!cancelled) setRead(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
    // A Save (or a copy) moves the product's version: read again so the derived values follow.
  }, [load, reload, view, version]);

  if (failed && !read) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="product-seo-error">
        <span role="alert" className="text-destructive">
          {t('productSeo.loadFailed')}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={(): void => setReload((n) => n + 1)}>
          <RotateCw size={14} aria-hidden="true" /> {t('productSeo.retry')}
        </Button>
      </div>
    );
  }
  if (!read) {
    return (
      <div aria-busy="true" className="space-y-2" data-testid="product-seo-loading">
        <span className="sr-only">{t('productSeo.loading')}</span>
        {[0, 1].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  }

  const views = (view ?? read.scoped) as Record<SeoField, ScopedFieldView<string>>;
  return (
    <section className="space-y-2" aria-labelledby="product-seo-heading">
      <h3 id="product-seo-heading" className="text-base font-semibold">
        {t('productSeo.title')}
      </h3>
      <p className="m-0 text-sm text-muted-foreground">{t('productSeo.help')}</p>
      <ScopedFieldGrid>
        {FIELDS.map((field) => {
          const fieldView = views[field];
          if (!fieldView) return null;
          const derived = derivedOf(field, read.resolved);
          const op = staged.get(field);
          const shown = op?.op === 'set' ? op.value : op?.op === 'empty' || op?.op === 'inherit' ? null : fieldView.value;
          const note = !shown && derived ? t('productSeo.derived', { value: derived }) : undefined;
          return (
            <ScopedField<string>
              key={field}
              id={`product-seo-${field}`}
              label={t(`productSeo.field.${field}`)}
              fieldPath={`seo:${field}`}
              view={fieldView}
              scope={scope}
              scopeLabel={scopeLabel}
              parentScopeLabel={parentScopeLabel ?? ''}
              staged={op}
              onStage={(next): void => onStage(field, next)}
              readOnly={readOnly}
              textField
              wide={MULTILINE.has(field)}
              note={note}
              error={errors[field]}
              renderControl={({ value, readOnly: ro, onChange, inputProps }): ReactNode =>
                MULTILINE.has(field) ? (
                  <Textarea
                    {...inputProps}
                    rows={3}
                    readOnly={ro}
                    maxLength={MAX_LENGTH[field]}
                    placeholder={derived ?? undefined}
                    value={value ?? ''}
                    onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)}
                  />
                ) : (
                  <Input
                    {...inputProps}
                    type={field === 'ogImageUrl' ? 'url' : 'text'}
                    readOnly={ro}
                    maxLength={MAX_LENGTH[field]}
                    placeholder={derived ?? undefined}
                    value={value ?? ''}
                    onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)}
                  />
                )
              }
            />
          );
        })}
      </ScopedFieldGrid>
    </section>
  );
}

/** The zone renderer reads a contribution's default export (feature 091, FR-013). */
export default ProductSeoSection;
