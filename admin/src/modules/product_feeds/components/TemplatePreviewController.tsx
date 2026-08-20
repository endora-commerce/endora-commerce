import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Search } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFocusTrap } from '@/components/hooks/useFocusTrap';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import type { TemplatePreview } from '../api';
import { normalize } from '@/lib/text-normalization';

/**
 * The sample-product preview — ux-design §3.4, FR-072, SC-013.
 *
 * This is the load-bearing idea of the whole editor, not the dragging. A
 * merchandiser does not learn what `availability` means by reading the word;
 * they learn it by seeing `in stock` sitting next to it, computed from a
 * product they recognise. That single move replaces documentation with
 * feedback, which is what makes "a working template in fifteen minutes,
 * unaided" reachable at all.
 *
 * So the call-to-action is **text, not an icon** — it is the most important
 * discoverable on the screen — and the context (channel, language, currency) is
 * prefilled rather than configured: a merchandiser must not have to set up a
 * context before they can see a value.
 */

export interface PreviewSelection {
  productId: string;
  sku: string;
  name: string;
  variantId?: string;
}

/**
 * Controls only — no preview payload. Rendering the result from here is what
 * put a banner inside the header's button row; `TemplatePreviewVerdict` below
 * owns that half.
 */
export interface TemplatePreviewControllerProps {
  selection: PreviewSelection | null;
  onSelect: (selection: PreviewSelection | null) => void;
  disabled?: boolean;
}

interface AdminProductSummary {
  id: string;
  sku: string;
  name: Record<string, string>;
}

function pickName(name: Record<string, string>, fallback: string): string {
  return name['en-US']?.trim() || Object.values(name).find((v) => v.trim() !== '') || fallback;
}

export function TemplatePreviewController(props: TemplatePreviewControllerProps): ReactNode {
  const { selection, onSelect, disabled = false } = props;
  const t = useTranslation('product_feeds');
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={(): void => setPickerOpen(true)}
      >
        {selection ? t('builder.preview.on', { sku: selection.sku }) : t('builder.preview.off')}
      </Button>

      {selection ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(): void => onSelect(null)}
        >
          {t('builder.preview.clear')}
        </Button>
      ) : null}

      {pickerOpen ? (
        <ProductPickerDrawer
          onClose={(): void => setPickerOpen(false)}
          onPick={(picked): void => {
            onSelect(picked);
            setPickerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export interface TemplatePreviewVerdictProps {
  selection: PreviewSelection | null;
  preview: TemplatePreview | null;
  loading: boolean;
  error: string | null;
}

/**
 * The verdict, stated once at the top rather than left for the operator to
 * assemble from twenty-three rows (FR-072).
 *
 * Deliberately separate from the controller above. The controller lives in
 * `PageHeader`'s `actions` slot, which is a `flex items-center` row of buttons;
 * a full-width banner rendered from there becomes a flex item beside Save
 * rather than a block under the header. So the control stays in the header and
 * the result renders in the page body, where a banner is a banner.
 */
export function TemplatePreviewVerdict(props: TemplatePreviewVerdictProps): ReactNode {
  const { selection, preview, loading, error } = props;
  const t = useTranslation('product_feeds');

  if (!selection) return null;

  if (error !== null) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  // While a fresh preview is in flight the previous verdict describes a
  // template that is no longer on screen, so show nothing rather than a lie.
  if (loading || !preview) return null;

  return (
    <Alert variant={preview.wouldEmitItem ? 'success' : 'destructive'}>
      <AlertDescription className="flex items-center gap-2">
        {preview.wouldEmitItem ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <AlertTriangle size={14} aria-hidden="true" />
        )}
        {preview.wouldEmitItem
          ? t('builder.preview.verdict.included')
          : t('builder.preview.verdict.skipped', { reason: preview.skipReason ?? '' })}
      </AlertDescription>
    </Alert>
  );
}

/** The muted call-to-action shown above the list while the preview is off. */
export function PreviewCallToAction(): ReactNode {
  const t = useTranslation('product_feeds');
  return <p className="b2b-help">{t('builder.help.pickProduct')}</p>;
}

function ProductPickerDrawer(props: {
  onClose: () => void;
  onPick: (selection: PreviewSelection) => void;
}): ReactNode {
  const t = useTranslation('product_feeds');
  const [products, setProducts] = useState<AdminProductSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ data: AdminProductSummary[] }>('/api/v1/admin/catalog/products')
      .then((res) => {
        if (!cancelled) setProducts(res.data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.envelope.error.message : t('builder.preview.failed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [t]);

  const needle = normalize(query);
  const candidates = products.filter(
    (product) =>
      needle === '' ||
      normalize(product.sku).includes(needle) ||
      normalize(pickName(product.name, product.sku)).includes(needle),
  );

  return (
    <>
      <div className="b2b-scrim" onClick={props.onClose} />
      <aside
        ref={drawerRef}
        className="b2b-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('builder.preview.pick')}
      >
        <div className="b2b-drawer__head">
          <div className="b2b-drawer__title">{t('builder.preview.pick')}</div>
          <div className="b2b-card__sub">{t('builder.help.pickProduct')}</div>
        </div>
        <div className="b2b-drawer__body">
          <div className="b2b-input-wrap" style={{ marginBottom: 12 }}>
            <Search size={14} className="lead" aria-hidden="true" />
            <input
              autoFocus
              className="b2b-field b2b-field--addon"
              placeholder={t('builder.preview.search')}
              value={query}
              onChange={(event): void => setQuery(event.target.value)}
            />
          </div>
          {error !== null ? (
            <p className="b2b-help text-destructive">{error}</p>
          ) : loading ? (
            <p className="b2b-help">{t('builder.preview.loading')}</p>
          ) : (
            <ul className="m-0 max-h-96 list-none overflow-auto p-0">
              {candidates.slice(0, 100).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    className="w-full border-b border-border px-2 py-2 text-left hover:bg-accent"
                    onClick={(): void =>
                      props.onPick({
                        productId: product.id,
                        sku: product.sku,
                        name: pickName(product.name, product.sku),
                      })
                    }
                  >
                    <span className="block text-sm font-medium">
                      {pickName(product.name, product.sku)}
                    </span>
                    <span className="b2b-mono block text-xs text-muted-foreground">
                      {product.sku}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="b2b-drawer__foot">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('builder.inspector.close')}
          </Button>
        </div>
      </aside>
    </>
  );
}
