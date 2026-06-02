import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Feature 012 / US6 — storefront PDP "Parametry produktu" tab.
 *
 * Renders a flat list of attribute label / value pairs. Backend's
 * `visibleAttributes[]` projection has already filtered out attributes
 * that fail (`has_value` AND `is_visible_on_product_page`) and resolved
 * each `valueRendered` per the active locale (option label for
 * select-style types, formatted scalar otherwise). The component
 * returns null when the projection is empty so the tab itself is
 * omitted on products with nothing to show (FR-030).
 *
 * Tab title is fetched from the storefront i18n catalogue
 * (`product.attributes.tabTitle`); en-US: `Specifications`,
 * pl-PL: `Parametry produktu`.
 */

export interface VisibleAttribute {
  key: string;
  label: string;
  valueType: string;
  valueRendered: string;
}

export function ParametryTab(props: {
  attributes: VisibleAttribute[] | null | undefined;
  locale: string;
}): ReactNode {
  const items = props.attributes ?? [];
  if (items.length === 0) return null;

  const t = tForLocale(props.locale);

  return (
    <section aria-labelledby="b2b-pdp-attributes-title">
      <h2
        id="b2b-pdp-attributes-title"
        className="mb-2 text-[14px] font-semibold uppercase tracking-[0.04em] text-muted"
      >
        {t('product.attributes.tabTitle')}
      </h2>
      <table className="w-full border-collapse">
        <tbody>
          {items.map((a) => (
            <tr key={a.key}>
              <th
                scope="row"
                className="border-b border-line p-[8px] text-left text-[13px] font-medium text-muted"
              >
                {a.label}
              </th>
              <td className="border-b border-line p-[8px] text-left font-mono text-[13px]">
                {a.valueRendered}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
