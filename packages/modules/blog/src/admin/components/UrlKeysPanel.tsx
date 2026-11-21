import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { blogSlugSchema } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  EditorSection,
  InlineStatus,
  Input,
  Label,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { ImmediateBadge, ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient, type BlogUrlKeyEntityKind, type BlogUrlKeysResponse } from '../api/blog-client.js';

/**
 * Feature 171 (US4) — a post's or category's address in the language being edited:
 * its own URL key (empty = the base slug), the storefront paths it is served at, and
 * the former addresses that redirect to it. A key another entry still answers as a
 * redirect is taken over only after the editor confirms it. Every save bumps the
 * entry's version, so `onSaved` lets the editor reload it.
 *
 * It saves on its own, outside the editor's one Save, so its heading carries the kit's
 * `ImmediateBadge` and its result is an `InlineStatus` beside *Save address* (issue #1512,
 * CONTENT-09; DEC-08).
 */
export function UrlKeysPanel({
  kind,
  entityId,
  language,
  onSaved,
}: {
  kind: BlogUrlKeyEntityKind;
  entityId: string;
  /** The language tab being edited. */
  language: string;
  onSaved: () => void;
}): ReactNode {
  const t = useTranslation('blog');
  const inputId = useId();
  const [keys, setKeys] = useState<BlogUrlKeysResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();
  const [takeover, setTakeover] = useState<string | null>(null);
  const [redirectToDelete, setRedirectToDelete] = useState<{ id: string; key: string } | null>(null);

  const own = (data: BlogUrlKeysResponse | null) =>
    data?.keys.find((k) => k.languageCode.toLowerCase() === language.toLowerCase())?.key ?? '';

  const load = useCallback(async () => {
    const data = await blogClient.getUrlKeys(kind, entityId);
    setKeys(data);
    setDraft(own(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, entityId, language]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const save = async (confirmTakeover: string | null): Promise<void> => {
    if (!keys) return;
    const key = draft.trim();
    if (key !== '' && !blogSlugSchema.safeParse(key).success) {
      setError(t('urlKeys.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    status.clear();
    try {
      const saved = await blogClient.putUrlKeys(kind, entityId, {
        keys: [{ languageCode: language, key: key === '' ? null : key }],
        ...(confirmTakeover ? { confirmTakeover: [{ languageCode: language, key: confirmTakeover }] } : {}),
        version: keys.version,
      });
      setKeys(saved);
      setDraft(own(saved));
      setTakeover(null);
      status.show(t('urlKeys.saved'));
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED') {
        setTakeover(key);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const removeRedirect = async (): Promise<void> => {
    if (!redirectToDelete) return;
    setBusy(true);
    setError(null);
    try {
      await blogClient.deleteUrlRedirect(kind, entityId, redirectToDelete.id);
      setRedirectToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const effective = keys?.effective.filter((e) => e.languageCode.toLowerCase() === language.toLowerCase()) ?? [];
  const redirects = keys?.redirects?.filter((r) => r.languageCode.toLowerCase() === language.toLowerCase()) ?? [];
  const dirty = keys !== null && draft.trim() !== own(keys);

  return (
    // A section of the editor's one settings panel (issue #1511), not a card of its own.
    <EditorSection
      as="h3"
      data-settings-group="url-keys"
      title={
        <>
          {t('urlKeys.title', { language })}
          <ImmediateBadge className="align-middle" />
        </>
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor={inputId}>{t('urlKeys.key')}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            className="font-mono"
            value={draft}
            placeholder={keys?.slug ?? ''}
            disabled={busy || keys === null}
            onChange={(event) => {
              status.clear();
              setDraft(event.target.value.toLowerCase());
            }}
          />
          <Button type="button" variant="outline" disabled={busy || !dirty} aria-busy={busy} onClick={() => void save(null)}>
            {t('urlKeys.save')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('urlKeys.hint')}</p>
        <InlineStatus {...status.props} />
      </div>
      {effective.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('urlKeys.servedAt')}</p>
          <ul className="space-y-0.5 font-mono text-xs">
            {effective.map((e) => (
              <li key={`${e.salesChannelId}:${e.languageCode}`}>{e.path}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {keys?.redirects !== undefined ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('urlKeys.redirects')}</p>
          {redirects.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('urlKeys.noRedirects')}</p>
          ) : (
            <ul className="space-y-1">
              {redirects.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 font-mono text-xs">
                  <span>{r.key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('urlKeys.deleteRedirect', { key: r.key })}
                    disabled={busy}
                    onClick={() => setRedirectToDelete(r)}
                  >
                    {t('common.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {takeover !== null ? (
        <ModalDialog
          title={t('urlKeys.takeoverTitle')}
          busy={busy}
          onClose={() => setTakeover(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setTakeover(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" disabled={busy} aria-busy={busy} onClick={() => void save(takeover)}>
                {t('urlKeys.takeoverConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('urlKeys.takeoverBody', { key: takeover })}</p>
        </ModalDialog>
      ) : null}

      {redirectToDelete !== null ? (
        <ModalDialog
          title={t('urlKeys.deleteRedirectTitle')}
          busy={busy}
          onClose={() => setRedirectToDelete(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRedirectToDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void removeRedirect()}>
                {t('urlKeys.deleteRedirectConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('urlKeys.deleteRedirectBody', { key: redirectToDelete.key })}</p>
        </ModalDialog>
      ) : null}
    </EditorSection>
  );
}
