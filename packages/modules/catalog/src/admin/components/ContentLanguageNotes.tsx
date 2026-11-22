import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { loadChannelLanguages, type ChannelLanguagesState, type ContentLanguageOffer } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The sales channels' languages for a content screen (category or product
 * content, #1507), read beside the document; never rejects — a list that
 * cannot be read is `failed`, and `offerContentLanguages` falls back on it.
 */
export function readChannelLanguages(): Promise<ChannelLanguagesState> {
  return loadChannelLanguages().then(
    (languages) => ({ languages, status: 'ready' as const }),
    () => ({ languages: [], status: 'failed' as const }),
  );
}

/** The languages a content screen's tab strip offers: the editable ones, then the flagged ones. */
export function offeredLanguages(offer: ContentLanguageOffer): string[] {
  return [...offer.editable, ...offer.outside];
}

/**
 * The line under a content screen's language strip: which tabs are outside
 * every channel (read-only), or why the strip does not follow the channels.
 * Nothing when there is nothing to say. The strip itself names codes only, so
 * the flag is said here in words, never by a colour on the tab (WCAG 1.4.1).
 */
export function ContentLanguageNotes({ offer }: { offer: ContentLanguageOffer }): ReactNode {
  const t = useTranslation('catalog');
  const degraded = offer.degraded === 'failed' || offer.degraded === 'noChannels' ? offer.degraded : null;
  if (offer.outside.length === 0 && degraded === null) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {degraded ? <p>{t(`contentLanguages.${degraded}`)}</p> : null}
      {offer.outside.length > 0 ? (
        <p>{t('contentLanguages.outside.list', { languages: offer.outside.join(', ') })}</p>
      ) : null}
    </div>
  );
}

/**
 * In place of the canvas for a language no channel offers: the stored document
 * stays in the envelope and is saved back unchanged, but it is not edited — the
 * zone has no read-only mode to show it in, and an editable canvas whose edits
 * were dropped would be worse than none.
 */
export function OutsideLanguageNotice({ language }: { language: string }): ReactNode {
  const t = useTranslation('catalog');
  return (
    <Alert>
      <AlertDescription>{t('contentLanguages.outside.notice', { language })}</AlertDescription>
    </Alert>
  );
}
