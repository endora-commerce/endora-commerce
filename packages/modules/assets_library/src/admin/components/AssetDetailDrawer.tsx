// Asset detail drawer — feature 013 / US2 / T068, extended by feature 156
// (specs/156-asset-stable-url/ contracts/admin-surfaces.md §3).
// Displays a single asset's metadata + reference list, supports inline edits
// (filename, label, mimeType, visibility), the shareable link and permalink,
// replacing the file, restoring its previous version, and soft delete.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { validateAssetPermalink } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { AssetUploader, ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { assetReferenceKindLabels } from '../lib/labels.js';
import {
  assetsLibraryClient,
  type AssetDetail,
} from '../api/assets-library-client.js';

// Curated set of MIME types the Assets Library handles (image / video / pdf).
// The MIME type is a technical identifier, so it is offered as a fixed dropdown
// rather than a free-text field to prevent typos and unsupported values.
const MIME_TYPE_OPTIONS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'video/mp4',
  'video/webm',
  'application/pdf',
] as const;

const KINDS = ['image', 'video', 'pdf', 'other'] as const;

export interface AssetDetailDrawerProps {
  assetId: string;
  onChanged: () => void;
  onClose: () => void;
}

/** A refusal the drawer shows, with a Reload when the asset changed underneath it. */
interface ActionError {
  message: string;
  reload: boolean;
}

/** The uploader props that hold a replacement to the asset's own kind (FR-006). */
function acceptFor(mimeType: string): { accept?: string; acceptPrefix?: 'image/' | 'video/' } {
  if (mimeType === 'application/pdf') return { accept: 'application/pdf' };
  // `acceptPrefix` also refuses a dropped file of another kind, which `accept` cannot.
  if (mimeType.startsWith('image/')) return { accept: 'image/*', acceptPrefix: 'image/' };
  if (mimeType.startsWith('video/')) return { accept: 'video/*', acceptPrefix: 'video/' };
  return {};
}

interface Refusal {
  code: string | null;
  /** The server's sentence; null when the answer carried none worth showing. */
  message: string | null;
  details: Record<string, unknown>;
}

/**
 * The code, sentence and details of a refusal. An answer that was not an error
 * envelope (`INTERNAL`, which the kit's client and ours make of an HTML page
 * from a proxy) and anything that is not an `ApiError` carry no sentence: the
 * drawer shows its own generic one rather than a raw body.
 */
function refusalOf(e: unknown): Refusal {
  if (e instanceof ApiError) {
    const error = e.envelope.error as { code: string; message: string; details?: unknown };
    const details =
      error.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? (error.details as Record<string, unknown>)
        : {};
    const message = error.code === 'INTERNAL' || !error.message ? null : error.message;
    return { code: error.code, message, details };
  }
  return { code: null, message: null, details: {} };
}

/**
 * Keyed by the asset, so nothing one asset's drawer holds — a permalink draft,
 * an open dialog, a refusal — survives into another's.
 */
export function AssetDetailDrawer(props: AssetDetailDrawerProps): ReactNode {
  return <AssetDetailDrawerBody key={props.assetId} {...props} />;
}

function AssetDetailDrawerBody({
  assetId,
  onChanged,
  onClose,
}: AssetDetailDrawerProps): ReactNode {
  const t = useTranslation('assets_library');
  const canWrite = useAuth().hasPermission('assets.write');
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const [permalinkDraft, setPermalinkDraft] = useState('');
  const [permalinkConfirm, setPermalinkConfirm] = useState<'change' | 'remove' | null>(null);
  const [reuse, setReuse] = useState<{ permalink: string; releasedAt: string } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // Set in the effect body and cleared in cleanup, so a response that lands
  // after an unmount (StrictMode included) changes nothing.
  const alive = useRef(false);
  const shareId = useId();
  const permalinkId = useId();
  const permalinkHelpId = useId();
  const permalinkErrorId = useId();
  const previousTitleId = useId();
  const mimeTypeId = useId();
  const visibilityId = useId();
  // Where focus goes when a permalink dialog closes: its opener may be gone (a
  // removal) or never have been focused (a dialog opened by a refusal).
  const permalinkInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  const reload = (): void => {
    setError(null);
    setActionError(null);
    assetsLibraryClient
      .getAsset(assetId)
      .then((next) => {
        if (alive.current) setDetail(next);
      })
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    let active = true;
    setError(null);
    assetsLibraryClient
      .getAsset(assetId)
      .then((next) => {
        if (active) setDetail(next);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return (): void => {
      active = false;
    };
  }, [assetId]);

  useEffect(() => {
    setPermalinkDraft(detail?.permalink ?? '');
  }, [detail?.permalink]);

  useEffect(() => {
    if (copyStatus !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyStatus(null), 2000);
    return (): void => clearTimeout(timer);
  }, [copyStatus]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!detail) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }

  const shareUrl = detail.permalinkUrl ?? detail.fileUrl;
  const currentPermalink = detail.permalink ?? '';
  const draft = permalinkDraft.trim();
  const permalinkChanged = draft !== currentPermalink && draft !== '';
  const verdict = draft === '' ? null : validateAssetPermalink(draft);
  const invalidReason = verdict && !verdict.ok ? verdict.reason : null;
  const kindProps = acceptFor(detail.mimeType);
  const previous = detail.previousVersion;
  const retentionDays = typeof detail.retentionDays === 'number' ? detail.retentionDays : null;
  const sentenceOf = (refused: Refusal): string => refused.message ?? t('detail.error.generic');

  const save = async (patch: {
    filename?: string;
    label?: string | null;
    mimeType?: string;
    visibility?: 'public' | 'private';
  }): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await assetsLibraryClient.patchAsset(assetId, patch);
      if (!alive.current) return;
      setDetail(next);
      onChanged();
    } catch (e) {
      if (alive.current) setActionError({ message: sentenceOf(refusalOf(e)), reload: false });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const copyShareUrl = async (): Promise<void> => {
    try {
      // `navigator.clipboard` is absent outside a secure context.
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(shareUrl);
      if (alive.current) setCopyStatus('copied');
    } catch {
      if (alive.current) setCopyStatus('failed');
    }
  };

  const sendPermalink = async (value: string, confirmReuse: boolean): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const next = confirmReuse
        ? await assetsLibraryClient.setPermalink(assetId, value, { confirmReuse: true })
        : await assetsLibraryClient.setPermalink(assetId, value);
      if (!alive.current) return;
      setReuse(null);
      setDetail(next);
      onChanged();
    } catch (e) {
      if (!alive.current) return;
      const refused = refusalOf(e);
      if (refused.code === 'ASSET_PERMALINK_PREVIOUSLY_USED' && !confirmReuse) {
        // Taking a name another asset held asks first (owner ruling P5).
        const releasedAt = refused.details['releasedAt'];
        setReuse({
          permalink: typeof refused.details['permalink'] === 'string' ? refused.details['permalink'] : value,
          releasedAt: typeof releasedAt === 'string' ? releasedAt : '',
        });
      } else {
        setReuse(null);
        setActionError({ message: sentenceOf(refused), reload: false });
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const removePermalink = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await assetsLibraryClient.removePermalink(assetId);
      if (!alive.current) return;
      setDetail(next);
      onChanged();
    } catch (e) {
      if (alive.current) setActionError({ message: sentenceOf(refusalOf(e)), reload: false });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const onSavePermalink = (): void => {
    // A set permalink stops working at once when it changes: ask first (FR-019).
    if (currentPermalink !== '') setPermalinkConfirm('change');
    else void sendPermalink(draft, false);
  };

  // The uploader's request only stages the chosen file and answers the asset
  // unchanged, so the uploader is idle (its own label, no error) while the
  // drawer asks for confirmation and then sends the replace itself.
  const stageReplace = (file: File): Promise<AssetDetail> => {
    setActionError(null);
    setPendingReplace(file);
    return Promise.resolve(detail);
  };

  const cancelReplace = (): void => {
    setPendingReplace(null);
  };

  const isKind = (value: unknown): value is (typeof KINDS)[number] =>
    KINDS.includes(value as (typeof KINDS)[number]);

  const confirmReplace = async (): Promise<void> => {
    if (!pendingReplace || busy) return;
    const file = pendingReplace;
    setBusy(true);
    try {
      const next = await assetsLibraryClient.replaceAsset(assetId, file, detail.contentVersion);
      if (!alive.current) return;
      setPendingReplace(null);
      // The answer is the replaced asset: show it as the sibling actions do.
      setDetail(next);
      onChanged();
    } catch (e) {
      if (!alive.current) return;
      setPendingReplace(null);
      const refused = refusalOf(e);
      const currentKind = refused.details['currentKind'];
      const newKind = refused.details['newKind'];
      if (refused.code === 'ASSET_REPLACE_KIND_MISMATCH' && isKind(currentKind) && isKind(newKind)) {
        setActionError({
          message: t('detail.replace.kindMismatch', {
            currentKind: t(`kind.${currentKind}`),
            newKind: t(`kind.${newKind}`),
          }),
          reload: false,
        });
      } else {
        setActionError({ message: sentenceOf(refused), reload: refused.code === 'ASSET_REPLACE_CONFLICT' });
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const restorePrevious = async (): Promise<void> => {
    if (!previous || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      // Both versions the drawer showed, so the restore brings back exactly
      // that file or is refused (FR-023).
      const next = await assetsLibraryClient.restorePreviousVersion(assetId, {
        expectedContentVersion: detail.contentVersion,
        expectedPreviousContentVersion: previous.contentVersion,
      });
      if (!alive.current) return;
      setRestoreConfirm(false);
      setDetail(next);
      onChanged();
    } catch (e) {
      if (!alive.current) return;
      setRestoreConfirm(false);
      const refused = refusalOf(e);
      setActionError({ message: sentenceOf(refused), reload: refused.code === 'ASSET_REPLACE_CONFLICT' });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const softDelete = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await assetsLibraryClient.softDeleteAsset(assetId);
      if (!alive.current) return;
      setDeleteConfirm(false);
      onChanged();
      onClose();
    } catch (e) {
      if (!alive.current) return;
      setDeleteConfirm(false);
      setActionError({ message: sentenceOf(refusalOf(e)), reload: false });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // The confirming button stays focusable while its own request is in flight:
  // `aria-busy` says so, and every confirm handler ignores a second press.
  const dialogFooter = (onCancel: () => void, confirmLabel: string, onConfirm: () => void, destructive = false): ReactNode => (
    <>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button
        type="button"
        variant={destructive ? 'destructive' : 'default'}
        aria-busy={busy}
        aria-disabled={busy}
        onClick={(): void => {
          if (!busy) onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </>
  );

  return (
    <Card className="sticky top-2 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('detail.title')}</CardTitle>
        <Button type="button" size="sm" variant="ghost" aria-label={t('detail.close')} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {detail.mimeType.startsWith('image/') ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={toAbsoluteAssetUrl(detail.url)}
            className="w-full rounded border bg-muted/30 object-contain"
          />
        ) : (
          <div className="rounded border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            {detail.mimeType}
          </div>
        )}

        <a
          href={toAbsoluteAssetUrl(detail.url)}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-xs underline"
        >
          {t('detail.openFile')} <ExternalLink className="size-3" />
        </a>

        {actionError ? (
          <Alert variant="destructive">
            <AlertDescription>
              <span>{actionError.message}</span>
              {actionError.reload ? (
                <Button type="button" size="sm" variant="outline" className="ml-2" onClick={reload}>
                  {t('detail.replace.reload')}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Shareable link — the stable URL, never the versioned embed one (FR-021). */}
        <div className="space-y-1">
          <Label htmlFor={shareId}>{t('detail.shareUrl.label')}</Label>
          <div className="flex items-center gap-2">
            <Input id={shareId} value={shareUrl} readOnly className="font-mono text-xs" />
            <Button type="button" size="sm" variant="outline" onClick={(): void => void copyShareUrl()}>
              {t('detail.shareUrl.copy')}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {copyStatus === 'copied'
              ? t('detail.shareUrl.copied')
              : copyStatus === 'failed'
                ? t('detail.shareUrl.copyFailed')
                : ''}
          </p>
          {detail.visibility === 'private' ? (
            <p className="text-xs text-muted-foreground">{t('detail.shareUrl.privateNotice')}</p>
          ) : null}
        </div>

        {/* Permalink (FR-014 – FR-019, owner ruling P5). */}
        <div className="space-y-1">
          <Label htmlFor={permalinkId}>{t('detail.permalink.label')}</Label>
          {/* Read-only rather than disabled while a request runs, so focus can
              come back here when a permalink dialog closes. */}
          <Input
            ref={permalinkInput}
            id={permalinkId}
            value={permalinkDraft}
            readOnly={!canWrite || busy}
            aria-invalid={invalidReason !== null}
            aria-describedby={invalidReason !== null ? `${permalinkHelpId} ${permalinkErrorId}` : permalinkHelpId}
            onChange={(e): void => setPermalinkDraft(e.target.value)}
          />
          <p id={permalinkHelpId} className="text-xs text-muted-foreground">
            {t('detail.permalink.help')}
          </p>
          <div aria-live="polite">
            {invalidReason !== null ? (
              <p id={permalinkErrorId} className="text-xs text-destructive">
                {t(`detail.permalink.invalid.${invalidReason}`)}
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !permalinkChanged || invalidReason !== null}
                onClick={onSavePermalink}
              >
                {t('detail.permalink.save')}
              </Button>
              {currentPermalink !== '' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={(): void => setPermalinkConfirm('remove')}
                >
                  {t('detail.permalink.remove')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <Field label={t('detail.filename')} value={detail.filename} onSave={(v): Promise<void> => save({ filename: v })} disabled={busy} saveLabel={t('common.save')} />
        <Field
          label={t('detail.label')}
          value={detail.label ?? ''}
          placeholder={t('common.optional')}
          onSave={(v): Promise<void> => save({ label: v.length === 0 ? null : v })}
          disabled={busy}
          saveLabel={t('common.save')}
        />
        <div className="space-y-1">
          <Label htmlFor={mimeTypeId}>{t('detail.mimeType')}</Label>
          <Select
            id={mimeTypeId}
            value={detail.mimeType}
            onChange={(e): void => {
              const v = e.target.value;
              if (v !== detail.mimeType) void save({ mimeType: v });
            }}
            disabled={busy}
          >
            {/* Preserve an existing value that falls outside the curated list
                so the current MIME type is shown and not silently lost. */}
            {MIME_TYPE_OPTIONS.includes(detail.mimeType as (typeof MIME_TYPE_OPTIONS)[number]) ? null : (
              <option value={detail.mimeType}>{detail.mimeType}</option>
            )}
            {MIME_TYPE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={visibilityId}>{t('detail.visibility')}</Label>
          <Select
            id={visibilityId}
            value={detail.visibility}
            onChange={(e): void => {
              const v = e.target.value as 'public' | 'private';
              void save({ visibility: v });
            }}
            disabled={busy}
          >
            <option value="public">{t('visibility.public')}</option>
            <option value="private">{t('visibility.private')}</option>
          </Select>
        </div>

        <div className="text-xs text-muted-foreground">
          {t('detail.storage')}: {detail.storageBackend} · {t('detail.size')}: {detail.sizeBytes} {t('detail.bytes')}
        </div>

        {/* Replace file — same id, same links, new file (FR-001). A legacy row or
            one with no storage key cannot be replaced in place (owner ruling S3). */}
        {canWrite && detail.replaceable === false ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">{t('detail.replace.unavailable')}</p>
        ) : null}
        {canWrite && detail.replaceable !== false ? (
          <div className="border-t pt-3">
            <AssetUploader
              upload={stageReplace}
              {...kindProps}
              triggerLabel={t('detail.replace.trigger')}
              onUploaded={(): void => undefined}
            />
          </div>
        ) : null}

        {/* Previous version (FR-022, FR-023). */}
        {previous ? (
          <section aria-labelledby={previousTitleId} className="space-y-2 border-t pt-3">
            <h3 id={previousTitleId} className="text-sm font-medium">
              {t('detail.previous.title')}
            </h3>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('detail.filename')}</dt>
              <dd>{previous.filename}</dd>
              <dt className="text-muted-foreground">{t('detail.mimeType')}</dt>
              <dd>{previous.mimeType}</dd>
              <dt className="text-muted-foreground">{t('detail.size')}</dt>
              <dd>
                {previous.sizeBytes} {t('detail.bytes')}
              </dd>
              <dt className="text-muted-foreground">{t('detail.previous.replacedAt')}</dt>
              <dd>{formatDateTime(previous.replacedAt)}</dd>
              <dt className="text-muted-foreground">{t('detail.previous.replacedBy')}</dt>
              <dd>{previous.replacedBy?.displayName ?? t('detail.previous.unknownActor')}</dd>
              <dt className="text-muted-foreground">{t('detail.previous.restorableUntil')}</dt>
              <dd>{formatDateTime(previous.restorableUntil)}</dd>
            </dl>
            {canWrite ? (
              <Button
                ref={restoreButton}
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(): void => setRestoreConfirm(true)}
              >
                {t('detail.previous.restore')}
              </Button>
            ) : null}
          </section>
        ) : null}

        <div className="border-t pt-3">
          <p className="mb-1 text-sm font-medium">{t('detail.referencedBy')}</p>
          {detail.references.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('detail.notReferenced')}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {detail.references.map((r, i) => (
                <li key={`${r.kind}-${r.entityId}-${i}`}>
                  <span className="text-muted-foreground">{assetReferenceKindLabels.label(t, r.kind)}</span>
                  {' — '}
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy || detail.references.length > 0}
            title={
              detail.references.length > 0
                ? t('detail.softDeleteBlockedTitle')
                : t('detail.softDeleteTitle')
            }
            onClick={(): void => {
              // A permalink stops serving the file: say so first (FR-020).
              if (detail.permalinkUrl) setDeleteConfirm(true);
              else void softDelete();
            }}
          >
            <Trash2 className="size-4 mr-1" /> {t('detail.softDelete')}
          </Button>
        </div>
      </CardContent>

      {permalinkConfirm !== null ? (
        <ModalDialog
          title={t(permalinkConfirm === 'change' ? 'detail.permalink.changeTitle' : 'detail.permalink.removeTitle')}
          busy={busy}
          finalFocusRef={permalinkInput}
          onClose={(): void => setPermalinkConfirm(null)}
          footer={dialogFooter(
            (): void => setPermalinkConfirm(null),
            t(permalinkConfirm === 'change' ? 'detail.permalink.save' : 'detail.permalink.remove'),
            (): void => {
              const action = permalinkConfirm;
              setPermalinkConfirm(null);
              if (action === 'change') void sendPermalink(draft, false);
              else void removePermalink();
            },
          )}
        >
          <p className="text-sm">
            {t(permalinkConfirm === 'change' ? 'detail.permalink.changeBody' : 'detail.permalink.removeBody', {
              oldUrl: detail.permalinkUrl ?? currentPermalink,
            })}
          </p>
        </ModalDialog>
      ) : null}

      {reuse !== null ? (
        <ModalDialog
          title={t('detail.permalink.reuseTitle')}
          busy={busy}
          finalFocusRef={permalinkInput}
          onClose={(): void => setReuse(null)}
          footer={dialogFooter(
            (): void => setReuse(null),
            t('detail.permalink.reuseConfirm'),
            (): void => void sendPermalink(reuse.permalink, true),
          )}
        >
          <p className="text-sm">
            {reuse.releasedAt
              ? t('detail.permalink.reuseBody', {
                  permalink: reuse.permalink,
                  releasedAt: formatDateTime(reuse.releasedAt),
                })
              : t('detail.permalink.reuseBodyNoDate', { permalink: reuse.permalink })}
          </p>
        </ModalDialog>
      ) : null}

      {pendingReplace !== null ? (
        <ModalDialog
          title={t('detail.replace.confirmTitle')}
          busy={busy}
          onClose={cancelReplace}
          footer={dialogFooter(cancelReplace, t('detail.replace.confirm'), (): void => void confirmReplace())}
        >
          <p className="text-sm">
            {retentionDays !== null
              ? t('detail.replace.confirmBody', {
                  currentFilename: detail.filename,
                  newFilename: pendingReplace.name,
                  retentionDays,
                })
              : t('detail.replace.confirmBodyNoRetention', {
                  currentFilename: detail.filename,
                  newFilename: pendingReplace.name,
                })}
          </p>
        </ModalDialog>
      ) : null}

      {restoreConfirm && previous ? (
        <ModalDialog
          title={t('detail.previous.confirmTitle')}
          busy={busy}
          finalFocusRef={restoreButton}
          onClose={(): void => setRestoreConfirm(false)}
          footer={dialogFooter(
            (): void => setRestoreConfirm(false),
            t('detail.previous.restore'),
            (): void => void restorePrevious(),
          )}
        >
          <p className="text-sm">
            {t('detail.previous.confirmBody', {
              previousFilename: previous.filename,
              currentFilename: detail.filename,
            })}
          </p>
        </ModalDialog>
      ) : null}

      {deleteConfirm ? (
        <ModalDialog
          title={t('detail.delete.permalinkTitle')}
          busy={busy}
          onClose={(): void => setDeleteConfirm(false)}
          footer={dialogFooter(
            (): void => setDeleteConfirm(false),
            t('detail.softDelete'),
            (): void => void softDelete(),
            true,
          )}
        >
          <p className="text-sm">
            {t('detail.delete.permalinkBody', { permalinkUrl: detail.permalinkUrl ?? '' })}
          </p>
        </ModalDialog>
      ) : null}
    </Card>
  );
}

function Field({
  label,
  value,
  placeholder,
  onSave,
  disabled,
  saveLabel,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => Promise<void> | void;
  disabled?: boolean;
  saveLabel: string;
}): ReactNode {
  const [v, setV] = useState(value);
  const id = useId();
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={v}
          {...(placeholder !== undefined ? { placeholder } : {})}
          onChange={(e): void => setV(e.target.value)}
          disabled={disabled}
        />
        {dirty ? (
          <Button type="button" size="sm" onClick={(): void => void onSave(v)} disabled={disabled}>
            {saveLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
