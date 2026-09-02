import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiClient, cn } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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
  name: Record<string, string>;
  description: Record<string, string>;
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
  /**
   * Per-language baseline JSONB on `products`. Owned by the parent's
   * product form so the form's Save button PATCHes them via its
   * existing single PATCH; at Channel = Global the panel inputs are
   * a controlled view into these.
   */
  baselineName: Record<string, string>;
  baselineDescription: Record<string, string>;
  onBaselineNameChange: (next: Record<string, string>) => void;
  onBaselineDescriptionChange: (next: Record<string, string>) => void;
}

/**
 * Imperative handle exposed to the parent product form so its Save
 * button can flush every pending channel-scoped override in one call.
 * Baseline edits are flushed by the parent's existing PATCH because
 * `baselineName` / `baselineDescription` are controlled by the parent.
 */
export interface ProductScopeEditorHandle {
  /** True when there are pending override upserts or deletes. */
  hasPendingOverrideChanges: () => boolean;
  /** PATCH /value-overrides for every pending override change. No-op when empty. */
  flushOverrides: () => Promise<void>;
}

/** Stable internal key for an override slot. */
const slotKey = (
  attributeKey: string,
  channelId: string,
  languageCode: string | null,
): string => `${attributeKey}|${channelId}|${languageCode ?? ''}`;

export const ProductScopeEditor = forwardRef<ProductScopeEditorHandle, Props>(
  function ProductScopeEditor(
    {
      productId,
      baselineName,
      baselineDescription,
      onBaselineNameChange,
      onBaselineDescriptionChange,
    },
    ref,
  ): ReactNode {
  const t = useTranslation('catalog');
  const [scope, setScope] = useState<ScopeContext | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeLanguageCode, setActiveLanguageCode] = useState<string | null>(null);
  const [resolved, setResolved] = useState<AdminProductWithResolved['resolved'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pending channel-scoped override changes. The page-Save button flushes
  // both maps in a single PATCH; map keys are `slotKey(...)`.
  const [overrideUpserts, setOverrideUpserts] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [overrideDeletes, setOverrideDeletes] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

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

  const [info, setInfo] = useState<string | null>(null);

  // The active (channel, language) determines which override slot the
  // edit affordance writes into. Editing requires a language.
  const canEdit = activeLanguageCode !== null && !saving;

  /**
   * The effective draft value for an override slot. Returns:
   *   - the pending upsert value if user has typed something this session,
   *   - else `''` when the user queued a delete,
   *   - else the existing override row's value (if any),
   *   - else an empty string.
   */
  const getOverrideDraftValue = useCallback(
    (attributeKey: 'name' | 'description'): string => {
      if (activeChannelId === null || activeLanguageCode === null) return '';
      const key = slotKey(attributeKey, activeChannelId, activeLanguageCode);
      if (overrideUpserts.has(key)) return overrideUpserts.get(key) ?? '';
      if (overrideDeletes.has(key)) return '';
      const existing = overrides.find(
        (o) =>
          o.attributeKey === attributeKey &&
          o.channelId === activeChannelId &&
          o.languageCode === activeLanguageCode,
      );
      return (existing?.value.v as string | undefined) ?? '';
    },
    [activeChannelId, activeLanguageCode, overrideUpserts, overrideDeletes, overrides],
  );

  const setOverrideDraft = useCallback(
    (attributeKey: 'name' | 'description', value: string) => {
      if (activeChannelId === null || activeLanguageCode === null) return;
      const key = slotKey(attributeKey, activeChannelId, activeLanguageCode);
      setOverrideUpserts((prev) => {
        const next = new Map(prev);
        next.set(key, value);
        return next;
      });
      setOverrideDeletes((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [activeChannelId, activeLanguageCode],
  );

  /**
   * Queue a "reset to global" for the active slot: clear any pending
   * upsert draft and mark the existing override (if any) for delete on
   * the next flush. No-op when no existing override AND no pending draft.
   */
  const queueOverrideReset = useCallback(
    (attributeKey: 'name' | 'description') => {
      if (activeChannelId === null || activeLanguageCode === null) return;
      const key = slotKey(attributeKey, activeChannelId, activeLanguageCode);
      const hasExisting = overrides.some(
        (o) =>
          o.attributeKey === attributeKey &&
          o.channelId === activeChannelId &&
          o.languageCode === activeLanguageCode,
      );
      setOverrideUpserts((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      if (hasExisting) {
        setOverrideDeletes((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      }
    },
    [activeChannelId, activeLanguageCode, overrides],
  );

  /**
   * Page-Save dispatch. Flushes every pending override change in a
   * single PATCH and refreshes the local override list. Baseline edits
   * are NOT touched here — the parent's PATCH carries them via the
   * controlled `baselineName` / `baselineDescription` props.
   */
  const flushOverrides = useCallback(async (): Promise<void> => {
    if (overrideUpserts.size === 0 && overrideDeletes.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const upserts: Array<{
        attributeKey: string;
        channelId: string;
        languageCode: string | null;
        value: { v: unknown };
      }> = [];
      for (const [key, value] of overrideUpserts) {
        const [attributeKey, channelId, languageCode] = key.split('|');
        upserts.push({
          attributeKey: attributeKey!,
          channelId: channelId!,
          languageCode: languageCode === '' ? null : languageCode!,
          value: { v: value },
        });
      }
      const deletes: Array<{
        attributeKey: string;
        channelId: string;
        languageCode: string | null;
      }> = [];
      for (const key of overrideDeletes) {
        const [attributeKey, channelId, languageCode] = key.split('|');
        deletes.push({
          attributeKey: attributeKey!,
          channelId: channelId!,
          languageCode: languageCode === '' ? null : languageCode!,
        });
      }
      const res = await apiClient.patch<{
        data: { overrides: Override[]; applied: { upserted: number; deleted: number } };
      }>(`/api/v1/admin/catalog/products/${productId}/value-overrides`, {
        upserts,
        deletes,
      });
      setOverrides(res.data.overrides);
      setOverrideUpserts(new Map());
      setOverrideDeletes(new Set());
      const parts: string[] = [];
      if (res.data.applied.upserted > 0)
        parts.push(
          t('productEditor.scopeEditor.applied.upserted', {
            count: String(res.data.applied.upserted),
          }),
        );
      if (res.data.applied.deleted > 0)
        parts.push(
          t('productEditor.scopeEditor.applied.deleted', {
            count: String(res.data.applied.deleted),
          }),
        );
      setInfo(parts.join(' • ') || t('productEditor.scopeEditor.applied.none'));
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = `${err.envelope.error.code}: ${err.envelope.error.message}`;
        setError(msg);
        throw err;
      }
      setError(t('productEditor.scopeEditor.saveFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [overrideUpserts, overrideDeletes, productId, t]);

  useImperativeHandle(
    ref,
    () => ({
      hasPendingOverrideChanges: () =>
        overrideUpserts.size > 0 || overrideDeletes.size > 0,
      flushOverrides,
    }),
    [overrideUpserts, overrideDeletes, flushOverrides],
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

          {/* Always-editable Name + Description for the active context.
              Baseline (Channel = Global) inputs are controlled by the
              parent form; channel-scoped inputs hold pending drafts that
              the page-Save button flushes via `flushOverrides`. */}
          <div>
            <div className="b2b-col" style={{ gap: 14 }}>
              <ScopedField
                label={t('productEditor.scopeEditor.fieldName')}
                source={nameSource}
                atGlobal={activeChannelId === null}
                canEdit={canEdit}
                value={
                  activeChannelId === null
                    ? activeLanguageCode
                      ? baselineName[activeLanguageCode] ?? ''
                      : ''
                    : getOverrideDraftValue('name')
                }
                placeholder={
                  activeChannelId === null
                    ? ''
                    : ((resolved?.name as string | null) ?? '')
                }
                hasOverride={overrides.some(
                  (o) =>
                    o.attributeKey === 'name' &&
                    o.channelId === activeChannelId &&
                    o.languageCode === activeLanguageCode,
                )}
                onChange={(v) => {
                  if (activeChannelId === null) {
                    if (!activeLanguageCode) return;
                    onBaselineNameChange({ ...baselineName, [activeLanguageCode]: v });
                  } else {
                    setOverrideDraft('name', v);
                  }
                }}
                onReset={() => queueOverrideReset('name')}
                multiline={false}
                t={t}
              />
              <ScopedField
                label={t('productEditor.scopeEditor.fieldDescription')}
                source={descriptionSource}
                atGlobal={activeChannelId === null}
                canEdit={canEdit}
                value={
                  activeChannelId === null
                    ? activeLanguageCode
                      ? baselineDescription[activeLanguageCode] ?? ''
                      : ''
                    : getOverrideDraftValue('description')
                }
                placeholder={
                  activeChannelId === null
                    ? ''
                    : ((resolved?.description as string | null) ?? '')
                }
                hasOverride={overrides.some(
                  (o) =>
                    o.attributeKey === 'description' &&
                    o.channelId === activeChannelId &&
                    o.languageCode === activeLanguageCode,
                )}
                onChange={(v) => {
                  if (activeChannelId === null) {
                    if (!activeLanguageCode) return;
                    onBaselineDescriptionChange({
                      ...baselineDescription,
                      [activeLanguageCode]: v,
                    });
                  } else {
                    setOverrideDraft('description', v);
                  }
                }}
                onReset={() => queueOverrideReset('description')}
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
});

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
  source,
  atGlobal,
  canEdit,
  value,
  placeholder,
  hasOverride,
  onChange,
  onReset,
  multiline,
  t,
}: {
  label: string;
  source: ResolvedSource;
  atGlobal: boolean;
  canEdit: boolean;
  value: string;
  /** Hint shown when the input is empty (typically the resolved baseline). */
  placeholder: string;
  /** True iff an override row exists on the server for this slot. */
  hasOverride: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
  multiline: boolean;
  t: (key: string, params?: Record<string, string>) => string;
}): ReactNode => {
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
      <div className="b2b-col" style={{ gap: 6, marginTop: 4 }}>
        {multiline ? (
          <textarea
            rows={3}
            className="b2b-field"
            value={value}
            placeholder={placeholder}
            disabled={!canEdit}
            onChange={(e): void => onChange(e.target.value)}
          />
        ) : (
          <Input
            value={value}
            placeholder={placeholder}
            disabled={!canEdit}
            onChange={(e): void => onChange(e.target.value)}
          />
        )}
        {/* Reset only applies to channel-scoped overrides; the baseline
            IS the source of truth at Channel = Global. */}
        {!atGlobal && hasOverride ? (
          <div className="b2b-row" style={{ gap: 6 }}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReset}
              disabled={!canEdit}
            >
              {t('productEditor.scopeEditor.resetToGlobal')}
            </Button>
          </div>
        ) : null}
      </div>
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
