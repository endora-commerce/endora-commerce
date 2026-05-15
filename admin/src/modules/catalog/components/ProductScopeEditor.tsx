import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Feature 022 — Product Scope Editor panel (read-only first slice).
 *
 * Renders above the existing Details-tab locale inputs on the product
 * edit page. Loads the scope-context (channels assigned to the product +
 * languages per channel + the editor's remembered preference) and the
 * current override map, then surfaces:
 *
 *   - A Sales Channel switcher (Global + each assigned channel).
 *   - A Language switcher narrowed to the active channel's languages
 *     (or the union of all assigned channels' languages when Global).
 *   - An effective-value preview for Name + Description per the active
 *     (channel, language) context — driven by the backend resolver
 *     (`GET /admin/catalog/products/:id?channelId=&languageCode=`).
 *   - A small "sources" badge per field showing whether the value came
 *     from a channel+language override, a channel-only override, the
 *     global+language baseline, or the pure global baseline.
 *
 * Edits flow through the existing locale-side-by-side inputs (global
 * baseline) for now; the channel-aware write path (PATCH
 * `/value-overrides`) is mounted on the backend and will be exposed
 * here in a follow-up patch. This first slice is read-only.
 */

interface Channel {
  id: string;
  code: string;
  name: string;
  languages: string[];
  isDefault: boolean;
}

interface PreferenceFields {
  lastChannelId: string | null;
  lastLanguageCode: string | null;
}

interface ScopeContext {
  productId: string;
  channels: Channel[];
  languagesUnion: string[];
  primaryAdminLanguage: string;
  preference: PreferenceFields | null;
}

interface Override {
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
  value: { v: unknown };
}

type ResolvedSource =
  | 'channel+language'
  | 'channel'
  | 'global+language'
  | 'global'
  | 'absent';

interface AdminProductWithResolved {
  id: string;
  resolved?: {
    context: { channelId: string | null; languageCode: string | null };
    name: unknown;
    description: unknown;
    attributeValues: Record<string, unknown>;
    sources: Record<string, ResolvedSource>;
  };
}

interface Props {
  productId: string;
}

export const ProductScopeEditor = ({ productId }: Props): ReactNode => {
  const [scope, setScope] = useState<ScopeContext | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeLanguageCode, setActiveLanguageCode] = useState<string | null>(null);
  const [resolved, setResolved] = useState<AdminProductWithResolved['resolved'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch: scope-context + overrides in parallel. Seed the
  // switchers from the editor's remembered preference (if any) or the
  // primary admin language.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ctxRes, ovRes] = await Promise.all([
          apiClient.get<{ data: ScopeContext }>(
            `/api/v1/admin/catalog/products/${productId}/scope-context`,
          ),
          apiClient.get<{ data: { overrides: Override[] } }>(
            `/api/v1/admin/catalog/products/${productId}/value-overrides`,
          ),
        ]);
        if (cancelled) return;
        const ctx = ctxRes.data;
        setScope(ctx);
        setOverrides(ovRes.data.overrides);
        const seedChannel = ctx.preference?.lastChannelId ?? null;
        const channelMatch = ctx.channels.find((c) => c.id === seedChannel);
        const initialChannelId = channelMatch ? seedChannel : null;
        const languagePool =
          initialChannelId !== null && channelMatch
            ? [...channelMatch.languages].sort()
            : [...ctx.languagesUnion].sort();
        const preferredLang = ctx.preference?.lastLanguageCode ?? ctx.primaryAdminLanguage;
        const initialLanguage =
          languagePool.find((l) => l === preferredLang) ?? languagePool[0] ?? null;
        setActiveChannelId(initialChannelId);
        setActiveLanguageCode(initialLanguage);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load scope.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Re-fetch the resolved preview when the switchers change. We hit the
  // existing single-product GET with the context params — the backend
  // returns the resolved block when either param is present.
  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (activeChannelId) params.set('channelId', activeChannelId);
        if (activeLanguageCode) params.set('languageCode', activeLanguageCode);
        if (params.toString().length === 0) {
          // Global / no language — still ask for resolved so the editor
          // sees the global baseline through the resolver.
          params.set('languageCode', scope.primaryAdminLanguage);
        }
        const res = await apiClient.get<{ data: AdminProductWithResolved }>(
          `/api/v1/admin/catalog/products/${productId}?${params.toString()}`,
        );
        if (!cancelled) setResolved(res.data.resolved ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to resolve.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, productId, activeChannelId, activeLanguageCode]);

  // Persist the (channel, language) preference for next visit. Debounced
  // best-effort — failures are swallowed.
  useEffect(() => {
    if (!scope) return;
    const handle = window.setTimeout(() => {
      void apiClient
        .put(`/api/v1/admin/catalog/products/${productId}/editor-preference`, {
          lastChannelId: activeChannelId,
          lastLanguageCode: activeLanguageCode,
        })
        .catch(() => {
          // Silent — preference is best-effort.
        });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [scope, productId, activeChannelId, activeLanguageCode]);

  const availableLanguages = useMemo(() => {
    if (!scope) return [];
    if (activeChannelId === null) return [...scope.languagesUnion].sort();
    const ch = scope.channels.find((c) => c.id === activeChannelId);
    return ch ? [...ch.languages].sort() : [];
  }, [scope, activeChannelId]);

  const handleChannelChange = useCallback(
    (next: string | null) => {
      setActiveChannelId(next);
      // If the active language is not in the new channel's set, fall
      // back to the first (sorted) option.
      if (!scope) return;
      const pool =
        next === null
          ? [...scope.languagesUnion].sort()
          : scope.channels.find((c) => c.id === next)?.languages.slice().sort() ?? [];
      if (activeLanguageCode && !pool.includes(activeLanguageCode)) {
        setActiveLanguageCode(pool[0] ?? null);
      }
    },
    [scope, activeLanguageCode],
  );

  if (loading) return null;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!scope) return null;

  const overridesCount = overrides.length;
  const nameSource = resolved?.sources['name'] ?? 'absent';
  const descriptionSource = resolved?.sources['description'] ?? 'absent';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scope: Sales Channel + Language</CardTitle>
        <p className="b2b-help" style={{ marginTop: 4, marginBottom: 0 }}>
          Preview how this product resolves per (channel, language) using the platform's resolver.
          {overridesCount > 0 ? ` ${overridesCount} channel-aware override(s) in place.` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="b2b-col" style={{ gap: 14 }}>
          {/* Sales Channel switcher */}
          <div>
            <div className="b2b-label">Sales Channel</div>
            <div className="b2b-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <ScopeChip
                active={activeChannelId === null}
                label="Global / no channel"
                onClick={() => handleChannelChange(null)}
              />
              {scope.channels.map((c) => (
                <ScopeChip
                  key={c.id}
                  active={activeChannelId === c.id}
                  label={`${c.name} (${c.code})${c.isDefault ? ' • default' : ''}`}
                  onClick={() => handleChannelChange(c.id)}
                />
              ))}
            </div>
            {scope.channels.length === 0 ? (
              <p className="b2b-help" style={{ marginTop: 6 }}>
                Product has no assigned channels — only the global baseline is editable.
              </p>
            ) : null}
          </div>

          {/* Language switcher */}
          <div>
            <div className="b2b-label">Language</div>
            <div className="b2b-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {availableLanguages.map((l) => (
                <ScopeChip
                  key={l}
                  active={activeLanguageCode === l}
                  label={l}
                  onClick={() => setActiveLanguageCode(l)}
                />
              ))}
              {availableLanguages.length === 0 ? (
                <span className="b2b-help">No languages available in this context.</span>
              ) : null}
            </div>
          </div>

          {/* Resolved preview */}
          <div>
            <div className="b2b-label">Resolved preview</div>
            <div className="b2b-col" style={{ gap: 10 }}>
              <ResolvedField
                label="Name"
                value={(resolved?.name ?? null) as string | null}
                source={nameSource}
              />
              <ResolvedField
                label="Description"
                value={(resolved?.description ?? null) as string | null}
                source={descriptionSource}
              />
            </div>
            <p className="b2b-help" style={{ marginTop: 8, marginBottom: 0 }}>
              Edit the per-language baseline below; channel-aware overrides land via the
              backend's <code>PATCH .../value-overrides</code> endpoint (UI editing surface in
              a follow-up).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const ScopeChip = ({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): ReactNode => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('b2b-chip', active && 'is-active')}
      aria-pressed={active}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--b2b-border, #d4d4d8)',
        background: active ? 'var(--b2b-primary-soft, #eef2ff)' : 'transparent',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
};

const ResolvedField = ({
  label,
  value,
  source,
}: {
  label: string;
  value: string | null;
  source: ResolvedSource;
}): ReactNode => {
  return (
    <div>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="b2b-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <Badge variant={source === 'absent' ? 'destructive' : 'secondary'}>
          {sourceLabel(source)}
        </Badge>
      </div>
      <div
        style={{
          marginTop: 4,
          padding: '6px 10px',
          background: 'var(--b2b-surface-muted, #f9fafb)',
          borderRadius: 6,
          fontSize: 14,
          minHeight: 24,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value ?? <em className="b2b-help">— no value at any slot —</em>}
      </div>
    </div>
  );
};

function sourceLabel(source: ResolvedSource): string {
  switch (source) {
    case 'channel+language':
      return 'channel + language override';
    case 'channel':
      return 'channel override';
    case 'global+language':
      return 'global baseline (language)';
    case 'global':
      return 'global baseline (fallback)';
    case 'absent':
      return 'no value';
  }
}
