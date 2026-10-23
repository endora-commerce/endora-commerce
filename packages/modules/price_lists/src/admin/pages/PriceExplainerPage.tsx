import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageHeader } from '@endora-commerce/admin-kit/ui';

/**
 * The explanation screen (feature 161, US5 — FR-023, FR-024),
 * `/price-lists/explain`. A shell until Phase 8 builds the buyer pickers, the
 * resolved price and its named runner-ups.
 */
export function PriceExplainerPage(): ReactNode {
  const t = useTranslation('price_lists');
  return <PageHeader title={t('priceBooks.explainer.title')} description={t('priceBooks.explainer.description')} />;
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceExplainerPage;
