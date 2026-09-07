import type { ReactNode } from 'react';

import { getShopInfo } from '../../lib/api/shop';
import type { RequestContext } from '../../lib/api/client';
import { JsonLd } from '../../lib/seo/JsonLd';
import { absoluteUrl } from '../../lib/seo/site-url';

/**
 * `Organization` structured data for the home page
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-014;
 * `contracts/seo-declarations.md` §3).
 *
 * A component rather than a block inside `app/page.tsx` because that page has
 * **two** render paths — an operator-selected CMS home page and the built-in
 * landing page — and a crawler that fetched `/` on the wrong day would have
 * received the structured data from one of them and not the other.
 *
 * `getShopInfo` swallows a switched-off `settings` and an unreachable backend
 * into empty strings, so the fields are checked before they are emitted:
 * `Organization` with an empty `name` is worse than no `Organization` at all.
 */
export async function OrganizationJsonLd(props: { ctx: RequestContext }): Promise<ReactNode> {
  const shop = await getShopInfo(props.ctx);
  if (shop.name.length === 0) return null;

  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: shop.name,
        url: absoluteUrl('/'),
        ...(shop.address.length > 0 ? { address: shop.address } : {}),
        ...(shop.contactEmail.length > 0 || shop.phone.length > 0
          ? {
              contactPoint: {
                '@type': 'ContactPoint',
                contactType: 'customer support',
                ...(shop.contactEmail.length > 0 ? { email: shop.contactEmail } : {}),
                ...(shop.phone.length > 0 ? { telephone: shop.phone } : {}),
              },
            }
          : {}),
      }}
    />
  );
}
