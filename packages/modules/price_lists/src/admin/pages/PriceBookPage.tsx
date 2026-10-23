import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageHeader } from '@endora-commerce/admin-kit/ui';

/**
 * One book (feature 161, US1 and US2), `/price-lists/:id` — the address P1's
 * audit reference resolver already links. A shell until Phases 4 and 5 build
 * the header editor and the grid.
 */
export function PriceBookPage(): ReactNode {
  const t = useTranslation('price_lists');
  return <PageHeader title={t('priceBooks.book.title')} description={t('priceBooks.book.description')} />;
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBookPage;
