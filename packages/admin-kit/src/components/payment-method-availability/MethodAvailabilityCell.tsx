import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/**
 * A payment method's availability, as a **state** with a way to change it —
 * feature 076, D-83.
 *
 * All four gateway screens used to carry an editable `<select>` here, and all
 * four wrote `PaymentMethod.status` through their own endpoint. Availability is
 * `payment_methods`' operation now, so the chip renders the state and the link
 * goes to the one screen that sets it, landing on this method's row.
 *
 * The column is **kept** rather than removed: without it, "is this method live?"
 * would be unanswerable on the screen where the operator is configuring it,
 * which is a worse regression than one extra click.
 *
 * No fallback for an absent `payment_methods` is written, and that is measured
 * rather than assumed: all four gateways declare it as a **binding** dependency,
 * so the activation graph refuses to switch it off while a gateway is on. The
 * link is live wherever this component renders, and a branch for the other case
 * would be code no operator can reach.
 */
export function MethodAvailabilityCell({
  code,
  status,
}: {
  code: string;
  status: 'active' | 'inactive';
}): ReactNode {
  const t = useTranslation('core');
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={status === 'active' ? 'success' : 'secondary'}>
        {status === 'active'
          ? t('paymentMethodAvailability.state.active')
          : t('paymentMethodAvailability.state.inactive')}
      </Badge>
      <Link
        to={`/payment-methods?highlight=${encodeURIComponent(code)}`}
        className="inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t('paymentMethodAvailability.manage')}
        <ExternalLink className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The one sentence that turns "the toggle vanished" into "the toggle moved, and
 * here is why" (D-83 item 3). Rendered under every gateway's methods table.
 */
export function MethodAvailabilityCaption(): ReactNode {
  const t = useTranslation('core');
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      {t('paymentMethodAvailability.caption')}
    </p>
  );
}

/**
 * A non-blocking notice on a method that is configured but not offered (D-83
 * item 4). Configuring a method ahead of switching it on is a real workflow, so
 * nothing on the row is disabled — the operator is told, not stopped.
 */
export function MethodNotOfferedNotice({ codes }: { codes: readonly string[] }): ReactNode {
  const t = useTranslation('core');
  if (codes.length === 0) return null;
  return (
    <p className="mt-2 text-sm text-muted-foreground" role="status">
      {t('paymentMethodAvailability.notOffered', { codes: codes.join(', ') })}
    </p>
  );
}
