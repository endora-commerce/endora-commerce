import { useState, type ReactNode } from 'react';
import { Copy, Download, RefreshCw, ShieldOff } from 'lucide-react';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
// Lifted to its own file so token rotation and taxonomy promotion share one
// dialog rather than growing a second (ux-design §2.12).
import { ConsequenceDialog } from './ConsequenceDialog.js';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type IssuedFeedToken, type ProductFeedDto } from '../api.js';

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

  /**
   * The link to show, or null when there is no working one to show.
   *
   * A feed URL's whole job is to be pasted into Merchant Center, re-pasted
   * when a provider is reconfigured, and checked when one stops fetching.
   * Showing it once left the operator choosing between rotating — which breaks
   * every provider already on the old link — and keeping it in a spreadsheet.
   */
  const readableUrl = issuedToken?.url ?? (feed.token.urlIsLive ? feed.token.url : null);

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
            {/* The link is stored encrypted at rest, so it can be shown again
                rather than once. `issuedToken` still wins when present: it is
                the freshest value on the navigation that just created or
                rotated the token, before the feed has been re-fetched. */}
            {readableUrl !== null ? (
              <div className="flex items-center gap-2">
                <code className="b2b-code flex-1 truncate rounded border px-2 py-1.5 text-xs">
                  {readableUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t('feeds.link.copy')}
                  onClick={() => void copy(readableUrl)}
                >
                  <Copy size={14} aria-hidden="true" />
                  {copied ? t('feeds.link.copied') : t('feeds.link.copy')}
                </Button>
              </div>
            ) : (
              // Issued before the token became recoverable, or no encryption key
              // on this deployment. Showing a masked form is the honest answer;
              // offering to copy it would send the operator to paste a 404.
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
