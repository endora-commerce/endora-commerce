import type { ReactNode } from 'react';
import type { OrderPendingEffect } from '@endora-commerce/contracts';
import { Alert, AlertDescription, AlertTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The follow-ups an order still owes (`specs/142-order-transition-atomicity/`,
 * User Story 4, FR-019).
 *
 * An order's status can be final while a release it owes has not happened yet
 * — the stock or the credit is given back by a follow-up that is retried until
 * it completes, and that waits while the module owning it is switched off. A
 * retry nobody can see is a second way to be surprised by the same state, so
 * the order page says which release is outstanding and what it is waiting for.
 *
 * Renders nothing for an order that owes nothing: the admin order response
 * carries `pendingEffects` only when something is outstanding.
 */

/** From this many failed attempts on, the notice asks for attention. */
const NEEDS_ATTENTION_FROM_ATTEMPTS = 5;

const EFFECT_LABEL_KEYS: Record<OrderPendingEffect['effect'], string> = {
  'stock.release': 'pendingEffects.effect.stockRelease',
  'credit.release': 'pendingEffects.effect.creditRelease',
};

/** The modules a release can wait for, by the id the response carries. */
const MODULE_LABEL_KEYS: Record<string, string> = {
  inventory: 'pendingEffects.module.inventory',
  credit_limits: 'pendingEffects.module.credit_limits',
};

export function OrderPendingEffectsNotice({
  pendingEffects,
}: {
  pendingEffects: readonly OrderPendingEffect[] | undefined;
}): ReactNode {
  const t = useTranslation('orders');
  if (!pendingEffects || pendingEffects.length === 0) return null;

  const stateOf = (effect: OrderPendingEffect): string => {
    if (effect.blockedOn !== null) {
      const labelKey = MODULE_LABEL_KEYS[effect.blockedOn];
      // A module this screen has no label for is named by its id rather than
      // dropped: an operator can still find it on the modules screen.
      return t('pendingEffects.state.waitingForModule', {
        module: labelKey ? t(labelKey) : effect.blockedOn,
      });
    }
    if (effect.attempts > 0) return t('pendingEffects.state.retrying', { count: effect.attempts });
    return t('pendingEffects.state.queued');
  };

  const needsAttention = pendingEffects.some(
    (effect) => effect.blockedOn === null && effect.attempts >= NEEDS_ATTENTION_FROM_ATTEMPTS,
  );

  return (
    <Alert
      variant={needsAttention ? 'destructive' : 'warning'}
      className="mb-4"
      data-testid="order-pending-effects"
    >
      <AlertTitle>{t('pendingEffects.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('pendingEffects.description')}</p>
        <ul className="mt-2 list-disc pl-5">
          {pendingEffects.map((effect) => (
            <li key={effect.effect}>
              <strong>{t(EFFECT_LABEL_KEYS[effect.effect])}</strong> — {stateOf(effect)}
            </li>
          ))}
        </ul>
        {needsAttention ? <p className="mt-2">{t('pendingEffects.needsAttention')}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
