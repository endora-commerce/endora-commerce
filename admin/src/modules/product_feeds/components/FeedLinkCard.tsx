import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Download, RefreshCw, ShieldOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';
import { productFeedsClient, type IssuedFeedToken, type ProductFeedDto } from '../api';

/**
 * The feed's public link — ux-design §2.3, FR-046, FR-047, FR-051.
 *
 * Three states, and the difference between them is the whole point:
 *
 *  - **Nothing published yet**: no URL is shown at all. Showing a link that
 *    404s would send an operator to paste it into Merchant Center and then
 *    debug a provider error that is really "you never generated the feed".
 *  - **Just issued**: the plaintext link, shown once, with a copy button and an
 *    explicit "copy it now" warning — it is not recoverable afterwards.
 *  - **Published, link previously issued**: the prefix only. The platform
 *    stores the token's sha256 and genuinely cannot reproduce the URL; the card
 *    says so and offers to replace it.
 *
 * Rotation copy names the consequence in full, because the failure mode is
 * silent: the provider keeps its old link, its next fetch 404s, and the
 * campaign stops with no signal in this admin.
 */

export interface FeedLinkCardProps {
  feed: ProductFeedDto;
  /** Present only on the navigation that created or rotated the token. */
  issuedToken: IssuedFeedToken | null;
  onChanged: (issued: IssuedFeedToken | null) => void;
}

export function FeedLinkCard(props: FeedLinkCardProps): ReactNode {
  const { feed, issuedToken, onChanged } = props;
  const t = useTranslation('product_feeds');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'rotate' | 'revoke' | null>(null);

  const published = feed.publishedArtefactId !== null;
  const revoked = feed.token.revokedAt !== null;

  const copy = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const rotate = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await productFeedsClient.rotateToken(feed.id);
      onChanged(result.data);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const revoke = async (): Promise<void> => {
    setBusy(true);
    try {
      await productFeedsClient.revokeToken(feed.id);
      onChanged(null);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {published && !revoked ? t('feeds.link.ready.title') : t('feeds.table.status')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!published && (
          // Deliberately no URL here.
          <p className="text-sm text-muted-foreground">{t('feeds.link.notPublished')}</p>
        )}

        {published && revoked && (
          <Alert>
            <AlertDescription>{t('feeds.link.revoke.body')}</AlertDescription>
          </Alert>
        )}

        {published && !revoked && (
          <>
            <p className="text-sm text-muted-foreground">{t('feeds.link.ready.body')}</p>
            {issuedToken ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="b2b-code flex-1 truncate rounded border px-2 py-1.5 text-xs">
                    {issuedToken.url}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => void copy(issuedToken.url)}>
                    <Copy size={14} aria-hidden="true" />
                    {copied ? t('feeds.link.copied') : t('feeds.link.copy')}
                  </Button>
                </div>
                <p className="text-xs text-amber-600">{t('feeds.link.shownOnce')}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                <code className="b2b-code">…{feed.token.prefix ?? ''}…</code>{' '}
                {t('feeds.link.masked')}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('feeds.link.public')}</p>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={productFeedsClient.artefactUrl(feed.id)}
            className={`b2b-btn b2b-btn--outline inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              canWrite && published ? '' : 'pointer-events-none opacity-50'
            }`}
            title={writeTitle}
          >
            <Download size={14} aria-hidden="true" />
            {t('feeds.action.download')}
          </a>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPending('rotate')}
            disabled={!canWrite || busy}
            title={writeTitle}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('feeds.link.rotate')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPending('revoke')}
            disabled={!canWrite || busy || revoked}
            title={writeTitle}
          >
            <ShieldOff size={14} aria-hidden="true" />
            {t('feeds.link.revoke')}
          </Button>
        </div>
      </CardContent>

      {pending !== null ? (
        <ConsequenceDialog
          title={
            pending === 'rotate' ? t('feeds.link.rotate.title') : t('feeds.link.revoke')
          }
          body={
            pending === 'rotate' ? t('feeds.link.rotate.body') : t('feeds.link.revoke.body')
          }
          confirmLabel={
            pending === 'rotate' ? t('feeds.link.rotate') : t('feeds.link.revoke')
          }
          cancelLabel={t('builder.confirm.removeRequired.keep')}
          busy={busy}
          onCancel={(): void => setPending(null)}
          onConfirm={(): void => void (pending === 'rotate' ? rotate() : revoke())}
        />
      ) : null}
    </Card>
  );
}

/**
 * `role="alertdialog"` with the **safe** button holding initial focus.
 *
 * A native `window.confirm` was not enough here: the consequence of a rotation
 * is two sentences long, it has to be readable, and a browser dialog cannot be
 * styled, translated or focus-managed. The rule from ux-design §6.5 is that the
 * copy names the consequence in full — "the current link stops working straight
 * away" — because the failure mode is silent: the provider keeps the old link,
 * its next fetch 404s, and nothing in this admin says so.
 */
function ConsequenceDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <>
      <div className="b2b-scrim" onClick={props.onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="feed-link-dialog-title"
        aria-describedby="feed-link-dialog-body"
        className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
        onKeyDown={(event): void => {
          if (event.key === 'Escape') props.onCancel();
        }}
      >
        <h2 id="feed-link-dialog-title" className="text-base font-medium">
          {props.title}
        </h2>
        <p id="feed-link-dialog-body" className="mt-2 text-sm text-muted-foreground">
          {props.body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="outline" onClick={props.onCancel}>
            {props.cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
