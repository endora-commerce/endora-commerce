import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type { RfqStatus } from '@endora-commerce/contracts';

/**
 * The customer detail's enum labels (issues #1434, #1476). Every key is in the
 * `customers` bundle; read with `useTranslation('customers')`.
 *
 * The history panels show other modules' records, and their copy is still this
 * module's own: a module does not read another module's bundle. The quote
 * request statuses are the published `RfqStatus` union, so one added there is a
 * type error here until it has a label. An order status needs no map — it is
 * operator-configured, and the orders list row carries its name.
 */
export const quoteRequestStatusLabels = defineEnumLabels<RfqStatus>({
  'Created from admin': 'detail.rfqs.status.createdFromAdmin',
  Pending: 'detail.rfqs.status.pending',
  Canceled: 'detail.rfqs.status.canceled',
  Approved: 'detail.rfqs.status.approved',
  Completed: 'detail.rfqs.status.completed',
  Expired: 'detail.rfqs.status.expired',
});

export const cartStatusLabels = defineEnumLabels({
  active: 'detail.carts.status.active',
  abandoned: 'detail.carts.status.abandoned',
  completed: 'detail.carts.status.completed',
  rejected: 'detail.carts.status.rejected',
});

export const addressKindLabels = defineEnumLabels({
  delivery: 'detail.addresses.kind.delivery',
  billing: 'detail.addresses.kind.billing',
});

/**
 * An order status's name in the admin's language: the language, a regional
 * variant of it, any recorded name, the code.
 */
export function orderStatusName(row: { status: string; statusName?: Record<string, string> | null }, language: string): string {
  const names = row.statusName ?? {};
  const regional = Object.keys(names).find((key) => key.startsWith(`${language}-`));
  return (
    names[language] ||
    (regional ? names[regional] : undefined) ||
    Object.values(names).find((name) => name.trim() !== '') ||
    row.status
  );
}
