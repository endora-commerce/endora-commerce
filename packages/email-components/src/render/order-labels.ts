/** Built-in order email UI strings (table headers + totals lines). */

export function isPolishLocale(language: string | null | undefined): boolean {
  return (language ?? '').toLowerCase().startsWith('pl');
}

export interface OrderSummaryColumnLabels {
  sku: string;
  item: string;
  qty: string;
  price: string;
}

export function orderSummaryColumnLabels(
  language: string | null | undefined,
): OrderSummaryColumnLabels {
  if (isPolishLocale(language)) {
    return { sku: 'SKU', item: 'Produkt', qty: 'Ilość', price: 'Cena' };
  }
  return { sku: 'SKU', item: 'Item', qty: 'Qty', price: 'Price' };
}

export interface OrderTotalsLabels {
  subtotal: string;
  tax: string;
  delivery: string;
  discount: string;
  total: string;
  none: string;
  taxId: string;
}

export function orderTotalsLabels(language: string | null | undefined): OrderTotalsLabels {
  if (isPolishLocale(language)) {
    return {
      subtotal: 'Suma częściowa',
      tax: 'VAT',
      delivery: 'Dostawa',
      discount: 'Rabat',
      total: 'Razem',
      none: 'brak',
      taxId: 'NIP',
    };
  }
  return {
    subtotal: 'Subtotal',
    tax: 'Tax',
    delivery: 'Delivery',
    discount: 'Discount',
    total: 'Total',
    none: 'none',
    taxId: 'Tax ID',
  };
}

/** Sample `order.summaryText` for admin HTML preview. */
export function sampleOrderSummaryText(language: string | null | undefined): string {
  const L = orderTotalsLabels(language);
  return [
    `  ${L.subtotal}: 99.99 PLN`,
    `  ${L.tax}: 23.00 PLN`,
    `  ${L.delivery}: 15.00 PLN`,
    `  ${L.total}: 137.99 PLN`,
  ].join('\n');
}

export function sampleOrderDiscountsText(language: string | null | undefined): string {
  return `  ${orderTotalsLabels(language).none}`;
}
