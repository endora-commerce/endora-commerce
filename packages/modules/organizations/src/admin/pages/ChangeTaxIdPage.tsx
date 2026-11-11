import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, apiClient, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ChangeTaxIdForm } from '../components/ChangeTaxIdForm.js';

/**
 * *Change an organization's tax ID* (issue #1040) — the ⌘K action's screen, for
 * an operator who starts from the task rather than from an organization's page.
 *
 * Two steps, shown as such from the start (Zeigarnik): choose a company
 * organization — the picker lists only those — then correct its tax ID in the
 * same form the page's dialog uses, starting on the stored value. On success
 * the organization opens.
 */
export function ChangeTaxIdPage(): ReactNode {
  const t = useTranslation('organizations');
  const navigate = useNavigate();
  const isVisible = useSurfaceVisibility();
  const canValidate = isVisible({ module: 'organizations', requiredPermission: 'customers:manage' });
  const pickerId = useId();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [current, setCurrent] = useState<{ taxId: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2 || !organizationId) return;
    let live = true;
    setCurrent(null);
    setLoadError(null);
    apiClient
      .get<{ data: { taxId: string | null } }>(`/api/v1/admin/organizations/${organizationId}`)
      .then((res) => {
        if (live) setCurrent({ taxId: res.data.taxId ?? null });
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof ApiError ? err.envelope.error.message : t('changeTaxId.page.loadError'));
      });
    return (): void => {
      live = false;
    };
  }, [step, organizationId, t]);

  const stepClass = (n: 1 | 2): string =>
    step === n ? 'font-medium text-foreground' : 'text-muted-foreground';

  return (
    <>
      <PageHeader
        title={t('changeTaxId.page.title')}
        description={t('changeTaxId.page.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/organizations">{t('taxIdScope.back')}</Link>
          </Button>
        }
      />
      <ol className="mb-4 flex items-center gap-3 text-sm" aria-label={t('changeTaxId.page.steps')}>
        <li className={stepClass(1)} aria-current={step === 1 ? 'step' : undefined}>
          {t('changeTaxId.page.step.choose')}
        </li>
        <li aria-hidden="true" className="text-muted-foreground">
          ·
        </li>
        <li className={stepClass(2)} aria-current={step === 2 ? 'step' : undefined}>
          {t('changeTaxId.page.step.details')}
        </li>
      </ol>
      <Card>
        <CardContent className="pt-6">
          {step === 1 ? (
            <div className="grid gap-4 md:max-w-md">
              <div className="grid gap-1.5">
                <Label htmlFor={pickerId}>{t('changeTaxId.page.picker')}</Label>
                <OrganizationPicker
                  id={pickerId}
                  ariaLabel={t('changeTaxId.page.picker')}
                  kind="company"
                  value={organizationId}
                  onChange={setOrganizationId}
                  placeholder={t('changeTaxId.page.pickerPlaceholder')}
                  emptyMessage={t('changeTaxId.page.empty')}
                  clearable
                />
              </div>
              <div>
                <Button type="button" disabled={!organizationId} onClick={(): void => setStep(2)}>
                  {t('changeTaxId.page.next')}
                </Button>
              </div>
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : current ? (
            <ChangeTaxIdForm
              organizationId={organizationId!}
              currentTaxId={current.taxId}
              canValidate={canValidate}
              onCancel={(): void => setStep(1)}
              onChanged={(result): void => {
                void navigate(`/organizations/${result.data.id}`, { replace: true });
              }}
            />
          ) : (
            <div aria-busy="true" className="h-16 animate-pulse rounded-md bg-muted" />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default ChangeTaxIdPage;
