import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageHeader } from '@endora-commerce/admin-kit/ui';

/**
 * The book list (feature 161, US1 — FR-001): the module's landing route,
 * `/price-lists`. A shell until Phase 4 builds the list, its filters (kept in
 * the URL, OQ-2 = B) and the base books' marking.
 */
export function PriceBooksPage(): ReactNode {
  const t = useTranslation('price_lists');
  return <PageHeader title={t('priceBooks.list.title')} description={t('priceBooks.list.description')} />;
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBooksPage;
