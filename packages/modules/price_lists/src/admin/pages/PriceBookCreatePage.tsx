import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageHeader } from '@endora-commerce/admin-kit/ui';

/**
 * The create flow (feature 161, US1 — FR-002), `/price-lists/new`, opened on
 * `price_lists:write`. A shell until Phase 4 builds the type → currency →
 * channels → audience → schedule steps.
 */
export function PriceBookCreatePage(): ReactNode {
  const t = useTranslation('price_lists');
  return <PageHeader title={t('priceBooks.create.title')} description={t('priceBooks.create.description')} />;
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBookCreatePage;
