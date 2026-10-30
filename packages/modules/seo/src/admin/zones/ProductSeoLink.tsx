import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163 — owner decision "SEO stub = A" (2026-10-26). `seo`'s contribution to the
 * product editor's SEO tab (`product.editor.seo`, 168-shim until T125): a link to the SEO screen, where
 * `SeoMetaScopeEditor` edits the meta tags per channel and language. The link opens that
 * screen with this product selected (owner decision UX-4 = A).
 *
 * Presence and the `catalog:write` code (the SEO screen's routes and its `open-seo`
 * action) are applied by the zone renderer from this module's declaration.
 */
export type ProductSeoLinkProps = AdminZoneProps<'product.editor.seo'>; // 168-shim (T125)

export function ProductSeoLink({ productId }: ProductSeoLinkProps): ReactNode {
  const t = useTranslation('seo');
  const params = new URLSearchParams({ entityType: 'product', entityId: productId });
  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      <div className="b2b-label">{t('productLink.title')}</div>
      <div className="b2b-help" style={{ marginTop: 0 }}>
        {t('productLink.hint')}
      </div>
      <div>
        <Link to={`/seo?${params.toString()}`} className="b2b-btn b2b-btn--ghost b2b-btn--sm">
          {t('productLink.link')}
        </Link>
      </div>
    </div>
  );
}

/** The zone renderer reads a contribution's default export (feature 091, FR-013). */
export default ProductSeoLink;
