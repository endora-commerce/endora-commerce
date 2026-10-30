import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { productSlugSchema, type UrlKeyRedirectTakeoverRequiredDetails } from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ScopeContext } from './ProductScopeEditor.js';
import { getProductScopeContext } from '../lib/product-scopes-api.js';
import {
  deleteProductUrlRedirect,
  describeKeyInLanguage,
  getProductUrlKeys,
  normalizeUrlKey,
  putProductUrlKeys,
  takeoverDetails,
  urlKeyErrorMessage,
  urlKeysChanges,
  type ProductUrlKeys,
  type UrlKeysDraft,
} from '../lib/product-url-keys-api.js';

/**
 * Feature 163 (T127, US7; `contracts/url-keys-and-redirects.md` §1–§3) — the product's
 * URL keys: the global key, one per language ("use inherited" = empty), channel ×
 * language overrides for the member channels (an orphan is shown and removable), the
 * effective URL per (channel, language) exactly as the backend emits it, and the
 * redirects — only while the response carries them (`seo` present, Q-C).
 *
 * A save is one PUT of what changed. A key another product holds is refused naming the
 * holder; a key that is another product's redirect asks first, naming the product that
 * loses it, and retries with `confirmTakeover`.
 */

export interface ProductUrlKeysPanelProps {
  productId: string;
}

type Translate = (key: string, params?: Record<string, string>) => string;
type Takeover = UrlKeyRedirectTakeoverRequiredDetails['takeovers'][number];

function draftOf(keys: ProductUrlKeys): UrlKeysDraft {
  return {
    globalKey: keys.globalKey,
    languageKeys: {},
    channelKeys: keys.channelKeys.map((k) => ({ channelId: k.channelId, languageCode: k.languageCode, key: k.key })),
  };
}

/** Every key a body would write that the grammar refuses, as typed after normalising. */
function invalidKeys(body: NonNullable<ReturnType<typeof urlKeysChanges>>): string[] {
  const written = [
    ...(body.globalKey !== undefined ? [body.globalKey] : []),
    ...(body.channelKeys ?? []).map((k) => k.key),
  ];
  return written.filter((k): k is string => typeof k === 'string' && !productSlugSchema.safeParse(k).success);
}

function sourceLabel(source: ProductUrlKeys['effective'][number]['source'], t: Translate): string {
  if (source === 'channel_language') return t('productEditor.urlKeys.source.channelLanguage');
  // 168-shim: a Channel key reuses the language label until S3 rewrites the panel.
  if (source === 'channel') return t('productEditor.urlKeys.source.language');
  return t('productEditor.urlKeys.source.global');
}

export function ProductUrlKeysPanel({ productId }: ProductUrlKeysPanelProps): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const headingId = useId();
  const effectiveHeadingId = useId();
  const redirectsHeadingId = useId();
  const addSelectId = useId();
  const globalInputId = useId();
  const errorId = useId();
  const saveHintId = useId();
  const hintId = useId();

  const [saved, setSaved] = useState<ProductUrlKeys | null>(null);
  /** `null` when the product's channels could not be read: the keys still show (C-3). */
  const [context, setContext] = useState<ScopeContext | null>(null);
  const [draft, setDraft] = useState<UrlKeysDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [addScope, setAddScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [takeovers, setTakeovers] = useState<Takeover[] | null>(null);
  const [redirectToDelete, setRedirectToDelete] = useState<{ id: string; label: string } | null>(null);
  /** The keys the last save attempt refused by grammar, as normalised — their fields are marked (D10). */
  const [invalidShown, setInvalidShown] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    // The channel context only names channels and offers new scopes; without it the keys
    // still show, channels are named generically and no scope can be added (C-3).
    Promise.all([getProductUrlKeys(productId), getProductScopeContext(productId).catch(() => null)])
      .then(([keys, scope]) => {
        if (cancelled) return;
        setSaved(keys);
        setDraft(draftOf(keys));
        setContext(scope);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId, reloadToken]);

  const channelName = useCallback(
    (channelId: string): string =>
      context?.channels.find((c) => c.id === channelId)?.name ?? t('productEditor.urlKeys.unknownChannel'),
    [context, t],
  );
  const scopeLabel = useCallback(
    (channelId: string, languageCode: string): string =>
      t('productEditor.urlKeys.channelScope', { channel: channelName(channelId), language: languageCode.toUpperCase() }),
    [channelName, t],
  );

  const languages = useMemo(() => {
    if (!saved) return [];
    return [...new Set([...(context?.languagesUnion ?? [])])].sort();
  }, [saved, context]);

  const orphaned = useMemo(
    () => new Set((saved?.channelKeys ?? []).filter((k) => k.orphaned).map((k) => `${k.channelId}|${k.languageCode}`)),
    [saved],
  );

  const addOptions = useMemo(() => {
    if (!context || !draft) return [];
    const taken = new Set(draft.channelKeys.map((k) => `${k.channelId}|${k.languageCode}`));
    return context.channels.flatMap((c) =>
      [...c.languages]
        .sort()
        .filter((l) => !taken.has(`${c.id}|${l}`))
        .map((l) => ({ value: `${c.id}|${l}`, label: scopeLabel(c.id, l) })),
    );
  }, [context, draft, scopeLabel]);

  const changes = saved && draft ? urlKeysChanges(saved, draft) : null;

  const save = useCallback(
    async (confirmTakeover?: Takeover[]): Promise<void> => {
      if (!saved || !draft) return;
      const body = urlKeysChanges(saved, draft);
      if (!body) return;
      const invalid = invalidKeys(body);
      if (invalid.length > 0) {
        setInvalidShown(invalid);
        setError(t('productEditor.urlKeys.error.invalidKey', { keys: invalid.join(', ') }));
        return;
      }
      setInvalidShown([]);
      setBusy(true);
      setError(null);
      setStatus('');
      try {
        const next = await putProductUrlKeys(productId, {
          ...body,
          ...(confirmTakeover
            ? { confirmTakeover: confirmTakeover.map((k) => k.key) }
            : {}),
        });
        setTakeovers(null);
        setSaved(next);
        setDraft(draftOf(next));
        setStatus(t('productEditor.urlKeys.saved'));
      } catch (err) {
        const takeover = takeoverDetails(err);
        // A confirmed retry can be refused again (another redirect appeared meanwhile):
        // ask again with the new list rather than failing generically (C-4).
        if (takeover) {
          setTakeovers(takeover.takeovers);
        } else {
          setTakeovers(null);
          setError(urlKeyErrorMessage(err, t) ?? t('productEditor.urlKeys.error.save'));
        }
      } finally {
        setBusy(false);
      }
    },
    [saved, draft, productId, t],
  );

  const deleteRedirect = useCallback(
    async (redirectId: string): Promise<void> => {
      setBusy(true);
      setError(null);
      setStatus('');
      try {
        await deleteProductUrlRedirect(productId, redirectId);
        setStatus(t('productEditor.urlKeys.redirectDeleted'));
      } catch (err) {
        setError(urlKeyErrorMessage(err, t) ?? t('productEditor.urlKeys.error.deleteRedirect'));
      } finally {
        setBusy(false);
        setRedirectToDelete(null);
      }
      // Only the redirect list is refreshed: unsaved key edits stay in the draft.
      try {
        const next = await getProductUrlKeys(productId);
        setSaved((prev) => (prev ? { ...prev, redirects: next.redirects } : next));
      } catch {
        // The list stays as it was; the next save or reload reads it again.
      }
    },
    [productId, t],
  );

  if (loadFailed) {
    return (
      <section aria-labelledby={headingId} className="b2b-col" style={{ gap: 12 }}>
        <h3 id={headingId} className="b2b-label">
          {t('productEditor.urlKeys.title')}
        </h3>
        <Alert variant="destructive">
          <AlertDescription>{t('productEditor.urlKeys.error.load')}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="outline" onClick={(): void => setReloadToken((n) => n + 1)}>
            {t('productEditor.urlKeys.retry')}
          </Button>
        </div>
      </section>
    );
  }

  if (!saved || !draft) {
    return (
      <section aria-labelledby={headingId} aria-busy="true" className="b2b-col" style={{ gap: 12 }}>
        <h3 id={headingId} className="b2b-label">
          {t('productEditor.urlKeys.title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.loading')}</p>
      </section>
    );
  }

  const redirects = saved.redirects;
  const setLanguageKey = (languageCode: string, key: string): void =>
    setDraft((d) => (d ? { ...d, languageKeys: { ...d.languageKeys, [languageCode]: key } } : d));
  const setChannelKey = (channelId: string, languageCode: string, key: string): void =>
    setDraft((d) =>
      d
        ? {
            ...d,
            channelKeys: d.channelKeys.map((k) =>
              k.channelId === channelId && k.languageCode === languageCode ? { ...k, key } : k,
            ),
          }
        : d,
    );
  const removeChannelKey = (channelId: string, languageCode: string): void =>
    setDraft((d) =>
      d
        ? { ...d, channelKeys: d.channelKeys.filter((k) => !(k.channelId === channelId && k.languageCode === languageCode)) }
        : d,
    );
  const inheritedForLanguage = (languageCode: string): string =>
    normalizeUrlKey(draft.languageKeys[languageCode] ?? '') || normalizeUrlKey(draft.globalKey) || saved.globalKey;
  /** A field whose key the last save attempt refused: marked and tied to the message (D10). */
  const invalidProps = (value: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    invalidShown.includes(normalizeUrlKey(value)) && value.trim() !== ''
      ? { 'aria-invalid': true, 'aria-describedby': errorId }
      : {};
  /** The inherited key as visible text beside an override field (D9), plus any error. */
  const describedBy = (id: string, value: string): string =>
    [id, invalidProps(value)['aria-describedby']].filter(Boolean).join(' ');

  return (
    <section aria-labelledby={headingId} className="b2b-col" style={{ gap: 16 }}>
      <div>
        <h3 id={headingId} className="b2b-label">
          {t('productEditor.urlKeys.title')}
        </h3>
        <p className="b2b-help" style={{ marginTop: 0 }}>
          {t('productEditor.urlKeys.help')}
          {redirects ? ` ${t('productEditor.urlKeys.helpRedirects')}` : ''}
        </p>
      </div>

      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </div>
      {error ? (
        <Alert id={errorId} variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={globalInputId}>{t('productEditor.urlKeys.global')}</Label>
        <Input
          id={globalInputId}
          value={draft.globalKey}
          readOnly={!canWrite}
          {...invalidProps(draft.globalKey)}
          onChange={(e): void => setDraft((d) => (d ? { ...d, globalKey: e.target.value } : d))}
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('productEditor.urlKeys.languagesHeading')}</h4>
        {languages.map((languageCode) => {
          const value = draft.languageKeys[languageCode] ?? '';
          const language = languageCode.toUpperCase();
          const inherited = normalizeUrlKey(draft.globalKey) || saved.globalKey;
          const inheritedId = `${hintId}-lang-${languageCode}`;
          return (
            <div key={languageCode} className="flex flex-wrap items-center gap-2">
              <span className="w-10 font-mono text-xs text-muted-foreground" aria-hidden="true">
                {language}
              </span>
              <Input
                className="max-w-xs"
                aria-label={t('productEditor.urlKeys.languageKey', { language })}
                value={value}
                placeholder={inherited}
                readOnly={!canWrite}
                {...invalidProps(value)}
                aria-describedby={describedBy(inheritedId, value)}
                onChange={(e): void => setLanguageKey(languageCode, e.target.value)}
              />
              <span id={inheritedId} className="text-xs text-muted-foreground">
                {t('productEditor.urlKeys.inheritedHint', { key: inherited })}
              </span>
              {canWrite && value !== '' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('productEditor.urlKeys.useInheritedFor', { scope: language })}
                  onClick={(): void => setLanguageKey(languageCode, '')}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {t('productEditor.urlKeys.useInherited')}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('productEditor.urlKeys.channelsHeading')}</h4>
        {draft.channelKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.channelsEmpty')}</p>
        ) : null}
        {/* 168-shim: Channel keys (no language) are not listed until S3 rewrites this panel. */}
        {draft.channelKeys
          .flatMap((row) => (row.languageCode === null ? [] : [{ ...row, languageCode: row.languageCode }]))
          .map((row) => {
          const scope = scopeLabel(row.channelId, row.languageCode);
          const isOrphan = orphaned.has(`${row.channelId}|${row.languageCode}`);
          return (
            <div key={`${row.channelId}|${row.languageCode}`} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-sm">{scope}</span>
              {isOrphan ? (
                <>
                  <span className="font-mono text-sm">{row.key}</span>
                  <Badge variant="outline">{t('productEditor.urlKeys.orphaned')}</Badge>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('productEditor.urlKeys.removeOrphanFor', { key: row.key })}
                      onClick={(): void => removeChannelKey(row.channelId, row.languageCode)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {t('productEditor.urlKeys.removeOrphan')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <Input
                    className="max-w-xs"
                    aria-label={t('productEditor.urlKeys.channelKey', { scope })}
                    value={row.key}
                    placeholder={inheritedForLanguage(row.languageCode)}
                    readOnly={!canWrite}
                    {...invalidProps(row.key)}
                    aria-describedby={describedBy(`${hintId}-ch-${row.channelId}-${row.languageCode}`, row.key)}
                    onChange={(e): void => setChannelKey(row.channelId, row.languageCode, e.target.value)}
                  />
                  <span id={`${hintId}-ch-${row.channelId}-${row.languageCode}`} className="text-xs text-muted-foreground">
                    {t('productEditor.urlKeys.inheritedHint', { key: inheritedForLanguage(row.languageCode) })}
                  </span>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('productEditor.urlKeys.useInheritedFor', { scope })}
                      onClick={(): void => removeChannelKey(row.channelId, row.languageCode)}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      {t('productEditor.urlKeys.useInherited')}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {canWrite && context !== null && context.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.noChannels')}</p>
        ) : null}
        {canWrite && addOptions.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={addSelectId}>{t('productEditor.urlKeys.addLabel')}</Label>
              <Select id={addSelectId} value={addScope} onChange={(e): void => setAddScope(e.target.value)}>
                <option value="">{t('productEditor.urlKeys.addPlaceholder')}</option>
                {addOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={addScope === ''}
              onClick={(): void => {
                const [channelId, languageCode] = addScope.split('|') as [string, string];
                setDraft((d) => (d ? { ...d, channelKeys: [...d.channelKeys, { channelId, languageCode, key: '' }] } : d));
                setAddScope('');
              }}
            >
              <Plus size={14} aria-hidden="true" />
              {t('productEditor.urlKeys.add')}
            </Button>
          </div>
        ) : null}
      </div>

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || changes === null}
            aria-busy={busy}
            aria-describedby={saveHintId}
            onClick={(): void => void save()}
          >
            {busy ? t('productEditor.urlKeys.saving') : t('productEditor.urlKeys.save')}
          </Button>
          {/* D10 — a draft change (a typed key, Use inherited, a removed key) is not saved
              until this button; with none, why the button is disabled. */}
          <span id={saveHintId} className="text-sm text-muted-foreground">
            {changes === null ? t('productEditor.urlKeys.noChanges') : t('productEditor.urlKeys.unsaved')}
          </span>
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 id={effectiveHeadingId} className="text-sm font-medium">
          {t('productEditor.urlKeys.effectiveHeading')}
        </h4>
        {saved.effective.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.effectiveEmpty')}</p>
        ) : (
          <table aria-labelledby={effectiveHeadingId} className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{t('productEditor.urlKeys.column.channel')}</th>
                <th className="py-1 pr-3 font-medium">{t('productEditor.urlKeys.column.language')}</th>
                <th className="py-1 pr-3 font-medium">{t('productEditor.urlKeys.column.url')}</th>
                <th className="py-1 font-medium">{t('productEditor.urlKeys.column.source')}</th>
              </tr>
            </thead>
            <tbody>
              {saved.effective.map((row) => (
                <tr key={`${row.channelId}|${row.languageCode}`} className="border-t">
                  <td className="py-1 pr-3">{channelName(row.channelId)}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{row.languageCode.toUpperCase()}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{row.url}</td>
                  <td className="py-1">{sourceLabel(row.source, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {redirects ? (
        <div className="space-y-2">
          <h4 id={redirectsHeadingId} className="text-sm font-medium">
            {t('productEditor.urlKeys.redirectsHeading')}
          </h4>
          {redirects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.redirectsEmpty')}</p>
          ) : (
            <ul aria-labelledby={redirectsHeadingId} className="space-y-1">
              {redirects.map((r) => {
                const label = describeKeyInLanguage(r.key, r.languageCode, t);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono">{label}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t('productEditor.urlKeys.deleteRedirectFor', { key: r.key })}
                        onClick={(): void => setRedirectToDelete({ id: r.id, label })}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t('productEditor.urlKeys.deleteRedirect')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {takeovers ? (
        <ModalDialog
          title={t('productEditor.urlKeys.takeover.title')}
          busy={busy}
          onClose={(): void => setTakeovers(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setTakeovers(null)}>
                {t('productEditor.urlKeys.cancel')}
              </Button>
              <Button type="button" disabled={busy} aria-busy={busy} onClick={(): void => void save(takeovers)}>
                {t('productEditor.urlKeys.takeover.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.urlKeys.takeover.body')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {takeovers.map((k) => (
              <li key={`${k.languageCode ?? ''}|${k.key}`}>
                {k.languageCode === null
                  ? t('productEditor.urlKeys.takeover.itemEveryLanguage', { product: k.losingProductName, key: k.key })
                  : t('productEditor.urlKeys.takeover.item', {
                      product: k.losingProductName,
                      key: describeKeyInLanguage(k.key, k.languageCode, t),
                    })}
              </li>
            ))}
          </ul>
        </ModalDialog>
      ) : null}

      {redirectToDelete ? (
        <ModalDialog
          title={t('productEditor.urlKeys.deleteRedirectTitle')}
          busy={busy}
          onClose={(): void => setRedirectToDelete(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setRedirectToDelete(null)}>
                {t('productEditor.urlKeys.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                aria-busy={busy}
                onClick={(): void => void deleteRedirect(redirectToDelete.id)}
              >
                {t('productEditor.urlKeys.deleteRedirectConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.urlKeys.deleteRedirectBody', { key: redirectToDelete.label })}</p>
        </ModalDialog>
      ) : null}
    </section>
  );
}
