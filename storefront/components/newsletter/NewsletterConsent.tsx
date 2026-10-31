import type { ReactNode } from 'react';
import type { RequestContext } from '../../lib/api/client';
import { getCmsBlockByCode } from '../../lib/api/cms';
import { getNewsletterStatus } from '../../lib/api/newsletter';
import { PageBuilderRender } from '../PageBuilderRender';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Newsletter-consent checkbox for the registration form (feature 048). The
 * label content is the predefined `newsletter_consent` CMS block (which links to
 * the Privacy Policy page); a built-in default is shown when the block is not
 * resolvable. Renders nothing when the newsletter module is disabled.
 *
 * The default speaks the page language, read from `ctx.locale` — the request
 * context `getServerContext()` built for this page, which carries it (issue #85).
 */
export async function NewsletterConsent({
  channelCode,
  ctx,
}: {
  channelCode: string;
  ctx: RequestContext;
}): Promise<ReactNode> {
  const status = await getNewsletterStatus(channelCode);
  if (!status.enabled) return null;

  const block = await getCmsBlockByCode('newsletter_consent', ctx).catch(() => null);
  const t = tForLocale(ctx.locale ?? '');
  // The sentence is keyed whole, with `{link}` where the policy link sits, so a
  // language can put the link wherever its word order needs it.
  const [before = '', after = ''] = t('content.newsletter.consent.text').split('{link}');

  return (
    <label className="b2b-auth__consent" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
      <input type="checkbox" name="newsletterConsent" value="on" style={{ marginTop: '0.25rem' }} />
      <span className="b2b-auth__consent-text">
        {block ? (
          <PageBuilderRender data={block.content.data} />
        ) : (
          <>
            {before}
            <LocalizedLink href="/privacy-policy">{t('content.newsletter.consent.privacyPolicy')}</LocalizedLink>
            {after}
          </>
        )}
      </span>
    </label>
  );
}
