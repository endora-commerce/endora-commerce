import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  ProductScopeContextResponse,
  ResolvedMeta,
  SeoEntityType,
  SeoProductMetaField,
  SeoProductMetaSource,
  UpsertSeoMetaOverrideRequest,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163 (T128, US8; `contracts/seo-media-attachments.md` §1) — one entity's meta
 * override at one scope. A product is addressed by sales channel beside language: the
 * channel list is the product's **member** channels (owner decision SEO-1 A), read from
 * catalog's `scope-context` over HTTP; a channel's language list is that channel's, with
 * "whole channel" for the channel row. Naming no channel is the language row, as before.
 * The resolved values say where each field comes from; "use inherited" deletes exactly
 * the selected scope's row. A category takes no channel.
 *
 * Review round D+F (C-2, D5): a scope loads as soon as it is selected (Load stays as a
 * refresh; a typed locale loads on Enter, blur or Load), the selectors are disabled
 * while a request is in flight and an answer for a scope no longer selected is
 * dropped, so a save can only ever write the scope on screen. Switching away from an
 * unsaved draft and "use inherited" both ask first. A product's editor waits for its
 * channel list, so nothing can be saved to "every channel" by default.
 */

const FALLBACK_LOCALE = 'en-US';

interface MetaOverrideFields {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageUrl: string | null;
}

const EMPTY_DRAFT: MetaOverrideFields = {
  title: null,
  description: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
};

const OVERRIDE_FIELDS: ReadonlyArray<keyof MetaOverrideFields> = [
  'title',
  'description',
  'ogTitle',
  'ogDescription',
  'ogImageUrl',
];

interface MetaEnvelope {
  data: {
    resolved: ResolvedMeta;
    /** Per field, where the resolved value comes from (feature 163). */
    sources?: Record<SeoProductMetaField, SeoProductMetaSource>;
    override: MetaOverrideFields | null;
  };
}

type MemberChannel = Pick<ProductScopeContextResponse['channels'][number], 'id' | 'name' | 'languages'>;

interface ScopeContextEnvelope {
  data: Pick<ProductScopeContextResponse, 'channels'>;
}

/** One addressable row: `channelId` `''` = the language row; `locale` `''` = the whole channel. */
interface Scope {
  channelId: string;
  locale: string;
}

export interface SeoMetaScopeEditorProps {
  entityType: SeoEntityType;
  entityId: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

function sourceLabel(source: SeoProductMetaSource, t: Translate): string {
  // 168-shim: the 168 source vocabulary on 163's labels; T126 replaces the product mode with a link.
  if (source === 'set') return t('metaScope.source.channelLanguage');
  if (source === 'inherited_channel') return t('metaScope.source.channel');
  if (source === 'inherited_global') return t('metaScope.source.language');
  return t('metaScope.source.derived');
}

/** The scope's query string: `channelId` and `locale` as selected; neither = the `en-US` language row. */
function scopeQuery({ channelId, locale }: Scope): string {
  const params = new URLSearchParams();
  if (channelId) params.set('channelId', channelId);
  if (locale) params.set('locale', locale);
  if (!channelId && !locale) params.set('locale', FALLBACK_LOCALE);
  return params.toString();
}

function draftOf(override: MetaOverrideFields | null): MetaOverrideFields {
  return {
    title: override?.title ?? null,
    description: override?.description ?? null,
    ogTitle: override?.ogTitle ?? null,
    ogDescription: override?.ogDescription ?? null,
    ogImageUrl: override?.ogImageUrl ?? null,
  };
}

/** Whether the draft differs from what the scope holds (`null` and `''` read alike). */
function isDraftDirty(draft: MetaOverrideFields, override: MetaOverrideFields | null): boolean {
  const saved = draftOf(override);
  return OVERRIDE_FIELDS.some((field) => (draft[field] ?? '') !== (saved[field] ?? ''));
}

export function SeoMetaScopeEditor({ entityType, entityId }: SeoMetaScopeEditorProps): ReactNode {
  const tCore = useTranslation('core');
  const t = useTranslation('seo') as Translate;
  const channelSelectId = useId();
  const languageId = useId();
  const effectiveHeadingId = useId();
  const discardBodyId = useId();
  const inheritBodyId = useId();
  const fieldIds = {
    title: useId(),
    description: useId(),
    ogTitle: useId(),
    ogDescription: useId(),
    ogImageUrl: useId(),
  };

  const isProduct = entityType === 'product';
  /** `null` until the product's member channels are read; the editor waits for them. */
  const [channels, setChannels] = useState<MemberChannel[] | null>(null);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [scope, setScope] = useState<Scope>({ channelId: '', locale: FALLBACK_LOCALE });
  /** The free-text locale of the language row, applied on Enter, blur or Load. */
  const [localeText, setLocaleText] = useState(FALLBACK_LOCALE);
  const [meta, setMeta] = useState<MetaEnvelope['data'] | null>(null);
  const [draft, setDraft] = useState<MetaOverrideFields>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A scope change waiting on "discard the unsaved draft?". */
  const [pendingScope, setPendingScope] = useState<Scope | null>(null);
  const [confirmInherit, setConfirmInherit] = useState(false);
  /** Bumped by every load; an answer carrying an older number is for a scope no longer shown. */
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!isProduct) return;
    let cancelled = false;
    setChannelsFailed(false);
    apiClient
      .get<ScopeContextEnvelope>(`/api/v1/admin/catalog/products/${encodeURIComponent(entityId)}/scope-context`)
      .then((res) => {
        if (!cancelled) setChannels(Array.isArray(res?.data?.channels) ? res.data.channels : []);
      })
      .catch(() => {
        if (!cancelled) setChannelsFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isProduct, entityId]);

  const metaPath = `/api/v1/admin/seo/meta/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`;
  const selectedChannel = channels?.find((c) => c.id === scope.channelId) ?? null;
  /** A product's scopes are offered once its channels are known (or known to be unreadable). */
  const ready = !isProduct || channels !== null || channelsFailed;

  // Read through a ref: an admin-language switch must not re-run the load effect and drop
  // an unsaved draft without the discard question.
  const tCoreRef = useRef(tCore);
  tCoreRef.current = tCore;

  const load = useCallback(
    async (target: Scope): Promise<void> => {
      const seq = ++loadSeq.current;
      setBusy(true);
      setError(null);
      try {
        const res = await apiClient.get<MetaEnvelope>(`${metaPath}?${scopeQuery(target)}`);
        if (seq !== loadSeq.current) return;
        setMeta(res.data);
        setDraft(draftOf(res.data.override));
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setError(err instanceof ApiError ? err.envelope.error.message : tCoreRef.current('seo.meta.error.load'));
        setMeta(null);
      } finally {
        if (seq === loadSeq.current) setBusy(false);
      }
    },
    [metaPath],
  );

  // A scope loads as soon as it is selected (D5).
  useEffect(() => {
    if (ready) void load(scope);
  }, [ready, scope, load]);

  const dirty = meta !== null && isDraftDirty(draft, meta.override);

  const applyScope = useCallback((next: Scope): void => {
    setPendingScope(null);
    setStatus('');
    setMeta(null);
    setDraft(EMPTY_DRAFT);
    setScope(next);
    if (!next.channelId) setLocaleText(next.locale);
  }, []);

  /** Every scope change passes here: an unsaved draft is discarded only when the operator says so. */
  const requestScope = (next: Scope): void => {
    if (next.channelId === scope.channelId && next.locale === scope.locale) return;
    if (dirty) {
      setPendingScope(next);
      return;
    }
    applyScope(next);
  };

  /** The typed locale of the language row: a new one is a scope change, the same one a refresh. */
  const commitLocaleText = (): boolean => {
    const typed = localeText.trim();
    if (typed === scope.locale) return false;
    requestScope({ channelId: '', locale: typed });
    return true;
  };

  const scopeName = (target: Scope): string => {
    const channel = channels?.find((c) => c.id === target.channelId) ?? null;
    if (channel && target.locale) {
      return t('metaScope.scope.channelLanguage', { channel: channel.name, language: target.locale.toUpperCase() });
    }
    if (channel) return t('metaScope.scope.channel', { channel: channel.name });
    return t('metaScope.scope.language', { language: (target.locale || FALLBACK_LOCALE).toUpperCase() });
  };

  const save = useCallback(async (): Promise<void> => {
    const target = scope;
    setBusy(true);
    setError(null);
    setStatus('');
    const body: UpsertSeoMetaOverrideRequest = {
      ...(target.channelId ? { channelId: target.channelId } : {}),
      ...(target.locale ? { locale: target.locale } : target.channelId ? {} : { locale: FALLBACK_LOCALE }),
      ...draft,
    };
    try {
      await apiClient.put(metaPath, body);
      setStatus(tCore('seo.meta.info.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tCore('seo.meta.error.save'));
      setBusy(false);
      return;
    }
    await load(target);
  }, [scope, draft, metaPath, load, tCore]);

  const inheritScope = useCallback(async (): Promise<void> => {
    const target = scope;
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await apiClient.delete(`${metaPath}?${scopeQuery(target)}`);
      setStatus(t('metaScope.removed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('metaScope.error.remove'));
      setBusy(false);
      setConfirmInherit(false);
      return;
    }
    setConfirmInherit(false);
    await load(target);
  }, [scope, metaPath, load, t]);

  const fieldRows: Array<{ field: SeoProductMetaField; label: string; value: string | null }> = meta
    ? [
        { field: 'title', label: tCore('seo.meta.field.title'), value: meta.resolved.title },
        { field: 'description', label: tCore('seo.meta.field.description'), value: meta.resolved.description },
        { field: 'ogTitle', label: tCore('seo.meta.field.ogTitle'), value: meta.resolved.openGraph.title },
        { field: 'ogDescription', label: tCore('seo.meta.field.ogDescription'), value: meta.resolved.openGraph.description },
        { field: 'ogImageUrl', label: tCore('seo.meta.field.ogImage'), value: meta.resolved.openGraph.image },
      ]
    : [];

  const draftFields: Array<{ field: keyof MetaOverrideFields; label: string; wide?: boolean; type?: string }> = [
    { field: 'title', label: tCore('seo.meta.field.title') },
    { field: 'description', label: tCore('seo.meta.field.description') },
    { field: 'ogTitle', label: tCore('seo.meta.field.ogTitle') },
    { field: 'ogDescription', label: tCore('seo.meta.field.ogDescription') },
    { field: 'ogImageUrl', label: tCore('seo.meta.field.ogImageUrl'), wide: true, type: 'url' },
  ];

  const fieldList = draftFields.map((f) => f.label).join(', ');

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {isProduct && channelsFailed ? (
        <Alert>
          <AlertDescription>{t('metaScope.channelsUnavailable')}</AlertDescription>
        </Alert>
      ) : null}

      {!ready ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('metaScope.loadingChannels')}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {isProduct && !channelsFailed && channels ? (
            <div className="space-y-1">
              <Label htmlFor={channelSelectId}>{t('metaScope.channel')}</Label>
              <Select
                id={channelSelectId}
                className="w-auto"
                value={scope.channelId}
                disabled={busy}
                onChange={(e): void => {
                  const next = channels.find((c) => c.id === e.target.value) ?? null;
                  requestScope({
                    channelId: e.target.value,
                    locale: next ? ([...next.languages].sort()[0] ?? '') : FALLBACK_LOCALE,
                  });
                }}
              >
                <option value="">{t('metaScope.everyChannel')}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor={languageId}>{t('metaScope.language')}</Label>
            {selectedChannel ? (
              <Select
                id={languageId}
                className="w-auto"
                value={scope.locale}
                disabled={busy}
                onChange={(e): void => requestScope({ channelId: scope.channelId, locale: e.target.value })}
              >
                <option value="">{t('metaScope.wholeChannel')}</option>
                {[...selectedChannel.languages].sort().map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={languageId}
                className="w-24"
                value={localeText}
                disabled={busy}
                onChange={(e): void => setLocaleText(e.target.value)}
                onBlur={(): void => {
                  commitLocaleText();
                }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitLocaleText();
                  }
                }}
                placeholder={tCore('seo.meta.field.locale')}
              />
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => {
              if (!selectedChannel && commitLocaleText()) return;
              void load(scope);
            }}
          >
            {tCore('seo.meta.load')}
          </Button>
        </div>
      )}

      {meta ? (
        <>
          <div className="space-y-2">
            <h3 id={effectiveHeadingId} className="text-sm font-semibold">
              {t('metaScope.effectiveHeading')}
            </h3>
            <Table aria-labelledby={effectiveHeadingId}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('metaScope.column.field')}</TableHead>
                  <TableHead>{t('metaScope.column.value')}</TableHead>
                  {meta.sources ? <TableHead>{t('metaScope.column.source')}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldRows.map((row) => (
                  <TableRow key={row.field}>
                    <TableHead scope="row" className="w-40">
                      {row.label}
                    </TableHead>
                    <TableCell className={row.field === 'ogImageUrl' ? 'font-mono text-xs' : undefined}>
                      {row.value ?? '—'}
                    </TableCell>
                    {meta.sources ? <TableCell>{sourceLabel(meta.sources[row.field], t)}</TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <h3 className="text-sm font-semibold">{tCore('seo.meta.overrideHeading')}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {draftFields.map(({ field, label, wide, type }) => (
              <div key={field} className={wide ? 'space-y-1 md:col-span-2' : 'space-y-1'}>
                <Label htmlFor={fieldIds[field]}>{label}</Label>
                <Input
                  id={fieldIds[field]}
                  type={type}
                  value={draft[field] ?? ''}
                  onChange={(e): void => setDraft((d) => ({ ...d, [field]: e.target.value || null }))}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void save()}>
              {busy ? tCore('seo.meta.saving') : tCore('seo.meta.saveOverride')}
            </Button>
            {meta.override ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={(): void => setConfirmInherit(true)}>
                <RotateCcw size={14} aria-hidden="true" />
                {t('metaScope.useInherited')}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {pendingScope ? (
        <ModalDialog
          title={t('metaScope.discard.title')}
          aria-describedby={discardBodyId}
          dismissOnScrim={false}
          onClose={(): void => setPendingScope(null)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={(): void => setPendingScope(null)}>
                {t('metaScope.discard.cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={(): void => applyScope(pendingScope)}>
                {t('metaScope.discard.confirm')}
              </Button>
            </>
          }
        >
          <p id={discardBodyId} className="text-sm">
            {t('metaScope.discard.body', { scope: scopeName(scope) })}
          </p>
        </ModalDialog>
      ) : null}

      {confirmInherit ? (
        <ModalDialog
          title={t('metaScope.inherit.title', { scope: scopeName(scope) })}
          aria-describedby={inheritBodyId}
          busy={busy}
          onClose={(): void => setConfirmInherit(false)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setConfirmInherit(false)}>
                {t('metaScope.inherit.cancel')}
              </Button>
              <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void inheritScope()}>
                {t('metaScope.useInherited')}
              </Button>
            </>
          }
        >
          <p id={inheritBodyId} className="text-sm">
            {t('metaScope.inherit.body', { scope: scopeName(scope), fields: fieldList })}
          </p>
        </ModalDialog>
      ) : null}
    </div>
  );
}
