import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ResolvedMeta, SeoEntityType, UpsertSeoMetaOverrideRequest } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Label,
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
 * override at one scope: a category or a CMS page, by language. Feature 170 (FR-094): a
 * product's SEO is edited in the product editor at the editor scope; the SEO screen offers
 * only a link there, so this editor has no product mode. "Use inherited" deletes exactly the
 * selected scope's row.
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
    override: MetaOverrideFields | null;
  };
}

/** One addressable row: `channelId` `''` = the language row; `locale` `''` = the whole channel. */
interface Scope {
  channelId: string;
  locale: string;
}

export interface SeoMetaScopeEditorProps {
  /** Feature 170 (FR-094): a product's SEO is edited in the product editor, not here. */
  entityType: Exclude<SeoEntityType, 'product'>;
  entityId: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;

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

  const metaPath = `/api/v1/admin/seo/meta/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`;

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
    void load(scope);
  }, [scope, load]);

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

  const fieldRows: Array<{ field: keyof MetaOverrideFields; label: string; value: string | null }> = meta
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
      <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={languageId}>{t('metaScope.language')}</Label>
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
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => {
              if (commitLocaleText()) return;
              void load(scope);
            }}
          >
            {tCore('seo.meta.load')}
          </Button>
        </div>

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
