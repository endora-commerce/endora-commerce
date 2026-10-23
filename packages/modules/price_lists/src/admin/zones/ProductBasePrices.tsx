import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Section } from '@endora-commerce/admin-kit/ui';

/**
 * The product editor's base-price panel (feature 161, US3 — FR-019–FR-021;
 * `research.md` R7), contributed to the end of the Pricing tab,
 * `product.editor.pricing.after`. A shell until Phase 6 builds the per-currency
 * lines with their own *Save prices* (OQ-1 = B) and the books pricing the
 * product.
 *
 * **No `match`**: the place has one host and one mount (Z13), as the other two
 * zones of this module; `admin/test/modules/price_lists/price-lists-zones.test.tsx`
 * asserts it absent.
 */
export type ProductBasePricesProps = AdminZoneProps<'product.editor.pricing.after'>;

export function ProductBasePrices(_props: ProductBasePricesProps): ReactNode {
  const t = useTranslation('price_lists');
  return (
    <Section title={t('basePrices.title')}>
      <p className="text-sm text-muted-foreground">{t('basePrices.description')}</p>
    </Section>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default ProductBasePrices;
