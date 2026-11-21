import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import type { AdminZoneProps, CreditLimitView } from '@endora-commerce/contracts';
import { moneyDifference } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatMoney } from '@endora-commerce/admin-kit/lib';
import { Button, EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { creditLimitDeepLink } from '../deep-link.js';

/**
 * `credit_limits`' read-only summary on the Organization screen — the
 * contribution to `organization.detail.after`, which sits in the screen's
 * Commerce tab (issue #1544, UX audit SALES-19).
 *
 * Granted, reserved and available amounts and the active reservations of the
 * organization's limit, or "no limit granted". Its one action is a link to the
 * Credit limits screen that opens the grant / adjust dialog for this
 * organization, so the editing stays in one place and the panel takes no part
 * in the Organization screen's Save.
 *
 * The zone renderer has already decided that `credit_limits` is present and
 * that the person holds `credit_limits:manage` — the code the read and the
 * linked screen both enforce — before this chunk is fetched, so nothing here
 * asks either question again.
 */
type State =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'none' }
  | { phase: 'granted'; limit: CreditLimitView };

export type OrganizationCreditLimitProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationCreditLimit({ organizationId }: OrganizationCreditLimitProps): ReactNode {
  const t = useTranslation('credit_limits');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    apiClient
      .get<{ data: CreditLimitView }>(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/credit-limit`)
      .then((res) => {
        if (alive) setState({ phase: 'granted', limit: res.data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const notGranted = err instanceof ApiError && err.envelope.error.code === 'CREDIT_LIMIT_NOT_GRANTED';
        setState({ phase: notGranted ? 'none' : 'failed' });
      });
    return (): void => {
      alive = false;
    };
  }, [organizationId]);

  const action =
    state.phase === 'granted' || state.phase === 'none' ? (
      <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
        <Link to={creditLimitDeepLink(organizationId)}>
          {state.phase === 'granted' ? t('list.adjust') : t('list.grant')}
        </Link>
      </Button>
    ) : null;

  return (
    <EditorSection title={t('organizationPanel.title')} description={t('organizationPanel.description')} action={action}>
      {/* Mounted before it has text, so the change to and from "loading" is announced (WCAG 4.1.3). */}
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {state.phase === 'loading' ? t('organizationPanel.loading') : ''}
      </p>
      {state.phase === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('organizationPanel.error')}
        </p>
      ) : null}
      {state.phase === 'none' ? <p className="text-sm text-muted-foreground">{t('organizationPanel.none')}</p> : null}
      {state.phase === 'granted' ? <Summary limit={state.limit} /> : null}
    </EditorSection>
  );
}

function Summary({ limit }: { limit: CreditLimitView }): ReactNode {
  const t = useTranslation('credit_limits');
  const reserved = Number(moneyDifference(limit.grantedAmount, limit.availableAmount));
  const overdrawn = limit.availableAmount < 0;
  const figures: { key: string; label: string; value: ReactNode }[] = [
    { key: 'granted', label: t('organizationPanel.granted'), value: formatMoney(limit.grantedAmount, limit.currency) },
    { key: 'reserved', label: t('organizationPanel.reserved'), value: formatMoney(reserved, limit.currency) },
    { key: 'available', label: t('organizationPanel.available'), value: formatMoney(limit.availableAmount, limit.currency) },
    { key: 'reservations', label: t('organizationPanel.reservations'), value: limit.activeReservationCount },
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.key} className="space-y-1">
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="text-sm font-medium tabular-nums">{figure.value}</dd>
          </div>
        ))}
      </dl>
      {overdrawn ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
          {t('organizationPanel.overdrawn', { amount: formatMoney(-limit.availableAmount, limit.currency) })}
        </p>
      ) : null}
    </div>
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrganizationCreditLimit;
