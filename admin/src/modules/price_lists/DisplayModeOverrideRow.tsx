import { useEffect, useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import type { DisplayMode } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';

type Scope = 'organization' | 'category' | 'product';

const MODE_LABEL: Record<DisplayMode | 'inherit', string> = {
  inherit: 'Inherit (use parent in chain)',
  gross_only: 'Gross only',
  net_only: 'Net only',
  both: 'Both columns',
  none: 'None — quote only',
};

/**
 * Reusable per-entity display-mode override row (US7 / T089 + T090).
 *
 * Drops into the Org / Category / Product editor. Reads the current
 * override (if any) from `/api/v1/admin/pricing/display-mode-overrides/
 * :scope/:targetId` and writes via PUT. `inherit` is sent to remove
 * the override and revert the entity to its parent in the resolution
 * chain.
 *
 * The component renders a single label + select pair to keep it
 * unobtrusive — the parent editor controls layout (this is just the
 * widget, not a card).
 */
export function DisplayModeOverrideRow(props: {
  scope: Scope;
  targetId: string;
  /** Optional copy override for the label. */
  label?: string;
  /** Optional copy for the inherited-mode hint. */
  inheritHint?: string;
  /** Hide the icon when embedding inside an existing labelled row. */
  withoutIcon?: boolean;
}): ReactNode {
  const { scope, targetId, label, inheritHint, withoutIcon } = props;
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
        {label ?? 'Price display mode override'}
        {saved ? (
          <span style={{ color: 'var(--success-soft-fg)', fontSize: 11 }}>· saved</span>
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
          ? inheritHint ?? 'Inherits the parent in the resolution chain (Settings → Org → Category → Product).'
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
