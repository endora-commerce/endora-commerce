import { useCallback, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * CartApprovalPolicyPanel (feature 027 US4).
 *
 * Lets a platform admin toggle the per-Organization
 * `requires_cart_approval` policy on the Organization detail page.
 * When on, ordinary members of the Org must submit their cart for
 * an Organization Administrator's approval before checkout.
 *
 * On toggle-off, the backend cascades: every pending/approved cart in
 * the Organization returns to `not_required` with an audit row.
 *
 * Browser-verification note: switch interaction + the "policy off
 * resets carts" notification copy need eyes.
 */

export interface CartApprovalPolicyPanelProps {
  organizationId: string;
  initialRequiresCartApproval: boolean;
  onChanged?: () => void | Promise<void>;
}

export function CartApprovalPolicyPanel({
  organizationId,
  initialRequiresCartApproval,
  onChanged,
}: CartApprovalPolicyPanelProps): ReactNode {
  const t = useTranslation('carts');
  const [requires, setRequires] = useState(initialRequiresCartApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleToggle = useCallback(async (next: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // The cart-approval policy is owned by the Organization-side
      // self-service surface; from the admin side we route through the
      // same admin route the platform admin already has.
      await apiClient.patch(`/api/v1/admin/organizations/${organizationId}/cart-approval-policy`, {
        requiresCartApproval: next,
      });
      setRequires(next);
      setInfo(next ? t('carts.policy.turnedOn') : t('carts.policy.turnedOff'));
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to update the policy.');
      // Roll back the optimistic toggle in the UI.
      setRequires(!next);
    } finally {
      setBusy(false);
    }
  }, [organizationId, onChanged, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('carts.policy.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('carts.policy.description')}</p>

        <div className="flex items-center gap-3">
          <Checkbox
            id={`cart-approval-${organizationId}`}
            checked={requires}
            disabled={busy}
            onChange={(e): void => {
              void handleToggle(e.target.checked);
            }}
          />
          <label htmlFor={`cart-approval-${organizationId}`} className="text-sm">
            {requires ? t('carts.policy.on') : t('carts.policy.off')}
          </label>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        <p className="text-xs text-muted-foreground">{t('carts.policy.hint')}</p>

        {busy ? (
          <Button variant="outline" size="sm" disabled>
            {t('carts.policy.saving')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
