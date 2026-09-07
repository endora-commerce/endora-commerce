import { useEffect, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import type { DisplayMode } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

type Scope = 'organization' | 'category' | 'product';

/**
 * Per-entity display-mode override row (feature 011, US7 / T089 + T090).
 *
 * Reads the current override (if any) from
 * `/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` and writes it
 * with a `PUT`. `inherit` removes the override and reverts the entity to its
 * parent in the resolution chain.
 *
 * ## What moved with it, and what did not (feature 091, P7a)
 *
 * The file used to live at `admin/src/modules/price_lists/`, imported by path
 * from `catalog`'s category editor and `organizations`' detail screen — two of
 * the admin keys the boundary ledger recorded. It is this module's control, so
 * it lives in this module's package and reaches its consumers through zone
 * contributions instead.
 *
 * **`label` and `inheritHint` did not come with it.** Both hosts passed their
 * own copy for this module's control (`categories.priceDisplayMode.label`,
 * `organizations.detail.pricingLabel`), which a zone cannot do: a host cannot
 * hand copy to a contributor it does not know. The row renders
 * `priceLists.displayMode.rowLabel` and its own hint, in every place it appears.
 *
 * The copy stays in the `core` namespace rather than moving to this module's
 * own. That is the larger population
 * `contracts/admin-component-contribution.md` §9.2 measured and deliberately
 * did **not** rule on — 62 files under the admin's module root render out of
 * `core` — and neither P7a nor P7b is the merge request that answers it.
 *
 * **P7b deleted the second copy.** One stood at
 * `admin/src/modules/price_lists/DisplayModeOverrideRow.tsx` for the length of
 * P7a, keeping the two props because `organizations`' detail screen still
 * passed them; that screen is a zone mount now, nothing imported the file, and
 * it is gone. Nothing in this estate compares two copies of one component, so
 * the shorter that state lasts the better — which is why the retiring condition
 * was written into this block rather than left to be remembered.
 */
export function DisplayModeOverrideRow(props: {
  scope: Scope;
  targetId: string;
  /** Hide the icon when embedding inside an existing labelled row. */
  withoutIcon?: boolean;
}): ReactNode {
  const t = useTranslation('core');
  const { scope, targetId, withoutIcon } = props;
  const MODE_LABEL: Record<DisplayMode | 'inherit', string> = {
    inherit: t('priceLists.displayMode.inherit'),
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const [mode, setMode] = useState<DisplayMode | 'inherit'>('inherit');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ data: { mode: DisplayMode } }>(
        `/api/v1/admin/pricing/display-mode-overrides/${scope}/${encodeURIComponent(targetId)}`,
      )
      .then((res) => {
        if (!cancelled) setMode(res.data.mode);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 404 means "no override yet — inherits"; anything else is an error.
        if (err instanceof ApiError && err.status === 404) setMode('inherit');
        else setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [scope, targetId]);

  const handleChange = async (next: DisplayMode | 'inherit'): Promise<void> => {
    setMode(next);
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      await apiClient.put(
        `/api/v1/admin/pricing/display-mode-overrides/${scope}/${encodeURIComponent(targetId)}`,
        { mode: next },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-col" style={{ gap: 4 }}>
      <label
        className="b2b-label"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        htmlFor={`dm-${scope}-${targetId}`}
      >
        {!withoutIcon ? <Eye size={12} /> : null}
        {t('priceLists.displayMode.rowLabel')}
        {saved ? (
          <span style={{ color: 'var(--success-soft-fg)', fontSize: 11 }}>
            {t('priceLists.displayMode.savedSuffix')}
          </span>
        ) : null}
      </label>
      <select
        id={`dm-${scope}-${targetId}`}
        className="b2b-field"
        value={mode}
        disabled={loading || submitting}
        onChange={(e): void => {
          void handleChange(e.target.value as DisplayMode | 'inherit');
        }}
      >
        {(Object.keys(MODE_LABEL) as Array<DisplayMode | 'inherit'>).map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
      <div className="b2b-help" style={{ marginTop: 2 }}>
        {mode === 'inherit'
          ? 'Inherits the parent in the resolution chain (Settings → Org → Category → Product).'
          : mode === 'none'
            ? 'Customers will not see a price; Add-to-cart is replaced by Add-to-Quote.'
            : `Customers see prices in the “${MODE_LABEL[mode]}” format on this scope.`}
      </div>
      {error ? (
        <div style={{ fontSize: 11, color: 'hsl(8 80% 40%)', marginTop: 2 }}>{error}</div>
      ) : null}
    </div>
  );
}
