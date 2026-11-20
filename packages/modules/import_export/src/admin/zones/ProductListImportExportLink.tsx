import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpDown } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * *Import / export* on the products list header — issue #1455 (UX audit
 * CAT-02), contributed to `product.list.actions`.
 *
 * The list used to draw an Import and an Export button with no handler. Both
 * happen on this module's centre, whose Products card offers either, so one
 * link replaces the two (Hick's Law). It is a contribution rather than a link
 * the list draws itself, so the list names no other module and the link goes
 * when this module is off (Constitution XVII). It is styled as a secondary
 * button: the header's one primary action stays *New product* (Von Restorff).
 */
export function ProductListImportExportLink(): ReactNode {
  const t = useTranslation('import_export');
  return (
    <Link to="/import-export" className="b2b-btn b2b-btn--default b2b-btn--sm">
      <ArrowUpDown size={13} aria-hidden="true" /> {t('nav.importExport.label')}
    </Link>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default ProductListImportExportLink;
