import type { ReactNode } from 'react';
import { getCmsBlockByCode } from '../../lib/api/cms';
import type { RequestContext } from '../../lib/api/client';
import { PageBuilderRender } from '../PageBuilderRender';

/**
 * Renders the cookie-consent banner message from the predefined CMS block
 * `cookieconsent.message` (feature 049). Falls back to a built-in default when
 * the block is not resolvable (CMS module absent / not seeded). Server
 * component — passed as a prop into the client <ConsentBanner/>.
 */
export async function CookieConsentMessage({ ctx }: { ctx: RequestContext }): Promise<ReactNode> {
  const block = await getCmsBlockByCode('cookieconsent.message', ctx).catch(() => null);
  if (block) return <PageBuilderRender data={block.content.data} />;
  return (
    <>Używamy plików cookie do analityki (Google Analytics). Możesz zaakceptować lub odrzucić statystyki.</>
  );
}
