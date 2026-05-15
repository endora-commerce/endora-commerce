import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

export interface Channel {
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

export interface ScopeContext {
  productId: string;
  channels: Channel[];
  languagesUnion: string[];
  primaryAdminLanguage: string;
  preference: PreferenceFields | null;
}

/**
 * Compute the language-switcher pool for a given channel context.
 *
 * - `activeChannelId === null` ⇒ union of all channels' languages
 *   (`scope.languagesUnion`).
 * - specific channel id ⇒ that channel's `languages` (or `[]` when the
 *   id is no longer in `scope.channels`).
 *
 * Always returns a sorted ascending copy so the chip order is stable
 * across channel switches (FR-021 deterministic).
 */
export function computeLanguagePool(
  scope: ScopeContext,
  activeChannelId: string | null,
): string[] {
  if (activeChannelId === null) return [...scope.languagesUnion].sort();
  const ch = scope.channels.find((c) => c.id === activeChannelId);
  return ch ? [...ch.languages].sort() : [];
}

/**
 * Resolve the active language for a new channel context.
 *
 * - When the previously-active language is still in the new pool, keep it
 *   and report `changed=false`.
 * - When it's not in the pool (or no language was active yet), fall back
 *   to the first option in the sorted pool and report `changed=true` so
 *   the caller can surface a toast (FR-021 / FR-022).
 */
export function computeLanguageFallback(
  pool: string[],
  current: string | null,
): { next: string | null; changed: boolean } {
  if (current !== null && pool.includes(current)) {
    return { next: current, changed: false };
  }
  return { next: pool[0] ?? null, changed: current !== null };
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
  const t = useTranslation('catalog');
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
          setError(
            err instanceof ApiError
              ? err.envelope.error.message
              : t('productEditor.scopeEditor.loadFailed'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, t]);

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
          setError(
            err instanceof ApiError
              ? err.envelope.error.message
              : t('productEditor.scopeEditor.resolveFailed'),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, productId, activeChannelId, activeLanguageCode, t]);

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
    return computeLanguagePool(scope, activeChannelId);
  }, [scope, activeChannelId]);

  /**
   * Look up the active override for a given system attribute at the
   * current (channel, language) context. Returns undefined when no
   * override exists at that exact slot.
   */
  const findOverride = useCallback(
    (attributeKey: 'name' | 'description'): Override | undefined => {
      if (activeChannelId === null) return undefined;
      return overrides.find(
        (o) =>
          o.attributeKey === attributeKey &&
          o.channelId === activeChannelId &&
          o.languageCode === activeLanguageCode,
      );
    },
    [overrides, activeChannelId, activeLanguageCode],
  );

  // Inline edit state per system attribute. `null` means "not editing";
  // any string means "editing — current draft value".
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  // Clear drafts when the active context changes — otherwise a draft
  // typed against (vip, en) would leak into (retail, pl) on switch.
  useEffect(() => {
    setDraftName(null);
    setDraftDescription(null);
    setInfo(null);
  }, [activeChannelId, activeLanguageCode]);

  const canEditOverride =
    activeChannelId !== null && activeLanguageCode !== null && !saving;

  /**
   * Apply a bulk override write. The same payload shape is used for
   * upserts and deletes; callers populate one array or the other.
   */
  const applyOverrides = useCallback(
    async (payload: {
      upserts: Array<{ attributeKey: string; channelId: string; languageCode: string | null; value: { v: unknown } }>;
      deletes: Array<{ attributeKey: string; channelId: string; languageCode: string | null }>;
    }) => {
      setSaving(true);
      setError(null);
      try {
        const res = await apiClient.patch<{
          data: { overrides: Override[]; applied: { upserted: number; deleted: number } };
        }>(`/api/v1/admin/catalog/products/${productId}/value-overrides`, payload);
        setOverrides(res.data.overrides);
        const { upserted, deleted } = res.data.applied;
        const parts: string[] = [];
        if (upserted > 0)
          parts.push(t('productEditor.scopeEditor.applied.upserted', { count: String(upserted) }));
        if (deleted > 0)
          parts.push(t('productEditor.scopeEditor.applied.deleted', { count: String(deleted) }));
        setInfo(parts.join(' • ') || t('productEditor.scopeEditor.applied.none'));
        // Refresh the resolver preview so the new "source" badge reflects
        // the post-write state.
        const params = new URLSearchParams();
        if (activeChannelId) params.set('channelId', activeChannelId);
        if (activeLanguageCode) params.set('languageCode', activeLanguageCode);
        if (params.toString().length === 0 && scope) {
          params.set('languageCode', scope.primaryAdminLanguage);
        }
        const r = await apiClient.get<{ data: AdminProductWithResolved }>(
          `/api/v1/admin/catalog/products/${productId}?${params.toString()}`,
        );
        setResolved(r.data.resolved ?? null);
        setDraftName(null);
        setDraftDescription(null);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(`${err.envelope.error.code}: ${err.envelope.error.message}`);
        } else {
          setError(t('productEditor.scopeEditor.saveFailed'));
        }
      } finally {
        setSaving(false);
      }
    },
    [productId, activeChannelId, activeLanguageCode, scope, t],
  );

  const saveOverride = useCallback(
    (attributeKey: 'name' | 'description', value: string) => {
      if (!canEditOverride || activeChannelId === null || activeLanguageCode === null) return;
      void applyOverrides({
        upserts: [
          {
            attributeKey,
            channelId: activeChannelId,
            languageCode: activeLanguageCode,
            value: { v: value },
          },
        ],
        deletes: [],
      });
    },
    [applyOverrides, canEditOverride, activeChannelId, activeLanguageCode],
  );

  const resetOverride = useCallback(
    (attributeKey: 'name' | 'description') => {
      if (!canEditOverride || activeChannelId === null) return;
      void applyOverrides({
        upserts: [],
        deletes: [
          {
            attributeKey,
            channelId: activeChannelId,
            languageCode: activeLanguageCode,
          },
        ],
      });
    },
    [applyOverrides, canEditOverride, activeChannelId, activeLanguageCode],
  );

  const handleChannelChange = useCallback(
    (next: string | null) => {
      setActiveChannelId(next);
      if (!scope) return;
      const pool = computeLanguagePool(scope, next);
      const fallback = computeLanguageFallback(pool, activeLanguageCode);
      if (fallback.changed) {
        setActiveLanguageCode(fallback.next);
        // FR-021 — explain the silent narrowing so editors don't lose
        // sight of which language slot they're now writing into.
        const channelName =
          next === null
            ? t('productEditor.scopeEditor.channelGlobalOption')
            : scope.channels.find((c) => c.id === next)?.code ?? '';
        setInfo(
          t('productEditor.scopeEditor.languageNarrowed', {
            previous: activeLanguageCode ?? '',
            channel: channelName,
            next: fallback.next ?? '—',
          }),
        );
      }
    },
    [scope, activeLanguageCode, t],
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

  const channelHelpText =
    activeChannelId === null
      ? t('productEditor.scopeEditor.globalHelp')
      : t('productEditor.scopeEditor.specificChannelHelp', {
          channelCode: scope.channels.find((c) => c.id === activeChannelId)?.code ?? '',
          languageCode: activeLanguageCode ?? '—',
        });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('productEditor.scopeEditor.title')}</CardTitle>
        <p className="b2b-help" style={{ marginTop: 4, marginBottom: 0 }}>
          {t('productEditor.scopeEditor.help')}
          {overridesCount > 0
            ? ` ${t('productEditor.scopeEditor.overridesCount', { count: String(overridesCount) })}`
            : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="b2b-col" style={{ gap: 14 }}>
          {/* Sales Channel switcher */}
          <div>
            <div className="b2b-label">{t('productEditor.scopeEditor.channelLabel')}</div>
            <div className="b2b-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <ScopeChip
                active={activeChannelId === null}
                label={t('productEditor.scopeEditor.channelGlobalOption')}
                onClick={() => handleChannelChange(null)}
              />
              {scope.channels.map((c) => (
                <ScopeChip
                  key={c.id}
                  active={activeChannelId === c.id}
                  label={`${c.name} (${c.code})${c.isDefault ? ` • ${t('productEditor.scopeEditor.channelDefaultBadge')}` : ''}`}
                  onClick={() => handleChannelChange(c.id)}
                />
              ))}
            </div>
            {scope.channels.length === 0 ? (
              <p className="b2b-help" style={{ marginTop: 6 }}>
                {t('productEditor.scopeEditor.channelEmpty')}
              </p>
            ) : null}
          </div>

          {/* Language switcher */}
          <div>
            <div className="b2b-label">{t('productEditor.scopeEditor.languageLabel')}</div>
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
                <span className="b2b-help">{t('productEditor.scopeEditor.languageEmpty')}</span>
              ) : null}
            </div>
          </div>

          {/* Resolved preview + override edit affordance */}
          <div>
            <div className="b2b-label">{t('productEditor.scopeEditor.resolvedPreview')}</div>
            <div className="b2b-col" style={{ gap: 14 }}>
              <ScopedField
                label={t('productEditor.scopeEditor.fieldName')}
                resolved={(resolved?.name ?? null) as string | null}
                source={nameSource}
                override={findOverride('name')}
                canEdit={canEditOverride}
                draft={draftName}
                onDraftChange={setDraftName}
                onSave={(v) => saveOverride('name', v)}
                onReset={() => resetOverride('name')}
                multiline={false}
                t={t}
              />
              <ScopedField
                label={t('productEditor.scopeEditor.fieldDescription')}
                resolved={(resolved?.description ?? null) as string | null}
                source={descriptionSource}
                override={findOverride('description')}
                canEdit={canEditOverride}
                draft={draftDescription}
                onDraftChange={setDraftDescription}
                onSave={(v) => saveOverride('description', v)}
                onReset={() => resetOverride('description')}
                multiline
                t={t}
              />
            </div>
            <p className="b2b-help" style={{ marginTop: 8, marginBottom: 0 }}>
              {channelHelpText}
            </p>
            {info ? (
              <Alert variant="default" className="mt-3">
                <AlertDescription>{info}</AlertDescription>
              </Alert>
            ) : null}
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

const ScopedField = ({
  label,
  resolved,
  source,
  override,
  canEdit,
  draft,
  onDraftChange,
  onSave,
  onReset,
  multiline,
  t,
}: {
  label: string;
  resolved: string | null;
  source: ResolvedSource;
  override: Override | undefined;
  canEdit: boolean;
  draft: string | null;
  onDraftChange: (v: string | null) => void;
  onSave: (v: string) => void;
  onReset: () => void;
  multiline: boolean;
  t: (key: string, params?: Record<string, string>) => string;
}): ReactNode => {
  const isEditing = draft !== null;
  // Seed the draft with the override's value when entering edit mode;
  // fall back to the resolved value so editors don't lose the current
  // text when switching from "view" to "edit".
  const startEditing = (): void => {
    const seed =
      (override?.value.v as string | undefined) ?? (resolved ?? '');
    onDraftChange(seed);
  };
  return (
    <div>
      <div className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="b2b-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <Badge variant={source === 'absent' ? 'destructive' : 'secondary'}>
          {t(sourceLabelKey(source))}
        </Badge>
      </div>
      {!isEditing ? (
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
          {resolved ?? <em className="b2b-help">{t('productEditor.scopeEditor.noValue')}</em>}
        </div>
      ) : (
        <div className="b2b-col" style={{ gap: 6, marginTop: 4 }}>
          {multiline ? (
            <textarea
              rows={3}
              className="b2b-field"
              value={draft}
              onChange={(e): void => onDraftChange(e.target.value)}
            />
          ) : (
            <Input value={draft} onChange={(e): void => onDraftChange(e.target.value)} />
          )}
          <div className="b2b-row" style={{ gap: 6 }}>
            <Button type="button" size="sm" onClick={(): void => onSave(draft ?? '')}>
              {t('productEditor.scopeEditor.saveOverride')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(): void => onDraftChange(null)}
            >
              {t('productEditor.scopeEditor.cancelEdit')}
            </Button>
          </div>
        </div>
      )}
      {!isEditing ? (
        <div className="b2b-row" style={{ gap: 6, marginTop: 6 }}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={startEditing}
            disabled={!canEdit}
          >
            {override
              ? t('productEditor.scopeEditor.editOverride')
              : t('productEditor.scopeEditor.addOverride')}
          </Button>
          {override ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReset}
              disabled={!canEdit}
            >
              {t('productEditor.scopeEditor.resetToGlobal')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

function sourceLabelKey(source: ResolvedSource): string {
  switch (source) {
    case 'channel+language':
      return 'productEditor.scopeEditor.source.channelLanguage';
    case 'channel':
      return 'productEditor.scopeEditor.source.channel';
    case 'global+language':
      return 'productEditor.scopeEditor.source.globalLanguage';
    case 'global':
      return 'productEditor.scopeEditor.source.global';
    case 'absent':
      return 'productEditor.scopeEditor.source.absent';
  }
}
