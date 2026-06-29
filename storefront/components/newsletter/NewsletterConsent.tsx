import type { ReactNode } from 'react';
import Link from 'next/link';
import type { RequestContext } from '../../lib/api/client';
import { getCmsBlockByCode } from '../../lib/api/cms';
import { getNewsletterStatus } from '../../lib/api/newsletter';
import { PageBuilderRender } from '../PageBuilderRender';

/**
 * Newsletter-consent checkbox for the registration form (feature 048). The
 * label content is the predefined `newsletter_consent` CMS block (which links to
 * the Privacy Policy page); a built-in default is shown when the block is not
 * resolvable. Renders nothing when the newsletter module is disabled.
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

  return (
    <label className="b2b-auth__consent" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
      <input type="checkbox" name="newsletterConsent" value="on" style={{ marginTop: '0.25rem' }} />
      <span className="b2b-auth__consent-text">
        {block ? (
          <PageBuilderRender data={block.content.data} />
        ) : (
          <>
            Yes, I would like to receive the newsletter and marketing emails. See our{' '}
            <Link href="/privacy-policy">Privacy Policy</Link>.
          </>
        )}
      </span>
    </label>
  );
}
