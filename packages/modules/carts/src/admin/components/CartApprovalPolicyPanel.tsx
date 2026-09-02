import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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
 * ## What P7b changed, and why the file was dead before it (feature 091, §10.5)
 *
 * It stood at `admin/src/modules/organizations/panels/`, **imported by
 * nothing** — and it was the one `module-namespace` key of
 * `backend/scripts/ledgers/foreign-module-ids.ts` that `organizations` carried,
 * recorded because the file named this module's i18n namespace on another
 * module's screen. The backend behind it was live the whole time, so the
 * platform had the capability and no screen for it: a product gap rather than a
 * stale panel, which is why the repair is to revive it here rather than to
 * delete it.
 *
 * **It reads its own initial state.** `initialRequiresCartApproval` used to
 * cross from `organizations`' detail payload as a prop, and a zone's props may
 * not carry it (Z3: the other three contributors to `organization.detail.after`
 * want neither the prop nor the request). This module owned a `PATCH` and no
 * `GET`; §10.5 ruled for a `GET` of its own over parsing another module's
 * payload for one boolean, so `routes.admin.ts` serves one, on the same
 * `customers:manage` code and in the same response shape as the write.
 *
 * `onChanged` went with the prop and is not replaced: nothing on the
 * organization detail screen re-renders from this policy, and a zone has no
 * callback to hand a contributor.
 *
 * The nine `policy.*` keys are **new**, in this module's own bundle in both
 * shipped languages. §10.5 recorded the copy as this module's eight existing
 * `carts.policy.*` keys; measured, that spelling resolves to
 * `bundle['carts']['carts.policy.title']` under the `carts` namespace and was
 * in no bundle at all, so this panel had never rendered a translated word. They
 * are `policy.*` here, which is the spelling this module's shipped keys use
 * (`approval.banner.*`).
 *
 * Browser-verification note: switch interaction + the "policy off
 * resets carts" notification copy need eyes.
 */

export interface CartApprovalPolicyPanelProps {
  organizationId: string;
}

const routeFor = (organizationId: string): string =>
  `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/cart-approval-policy`;

export function CartApprovalPolicyPanel({
  organizationId,
}: CartApprovalPolicyPanelProps): ReactNode {
  const t = useTranslation('carts');
  const [requires, setRequires] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ data: { requiresCartApproval: boolean } }>(routeFor(organizationId))
      .then((res) => {
        if (!cancelled) setRequires(res.data.requiresCartApproval);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.envelope.error.message : t('policy.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [organizationId, t]);

  const handleToggle = useCallback(
    async (next: boolean): Promise<void> => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        await apiClient.patch(routeFor(organizationId), { requiresCartApproval: next });
        setRequires(next);
        setInfo(next ? t('policy.turnedOn') : t('policy.turnedOff'));
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('policy.saveError'));
        // Roll back the optimistic toggle in the UI.
        setRequires(!next);
      } finally {
        setBusy(false);
      }
    },
    [organizationId, t],
  );

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('policy.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('policy.description')}</p>

        <div className="flex items-center gap-3">
          <Checkbox
            id={`cart-approval-${organizationId}`}
            checked={requires}
            disabled={busy || loading}
            onChange={(e): void => {
              void handleToggle(e.target.checked);
            }}
          />
          <label htmlFor={`cart-approval-${organizationId}`} className="text-sm">
            {requires ? t('policy.on') : t('policy.off')}
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

        <p className="text-xs text-muted-foreground">{t('policy.hint')}</p>

        {busy ? (
          <Button variant="outline" size="sm" disabled>
            {t('policy.saving')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
