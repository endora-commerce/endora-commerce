import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ConvertToCompanyForm } from '../components/ConvertToCompanyForm.js';

/**
 * *Convert personal organization* (`specs/177-tax-id-scope/` FR-042;
 * `contracts/admin-surfaces.md` §4.3) — the ⌘K action's screen, for an operator
 * who starts from the task rather than from an organization's page.
 *
 * Two steps, shown as such from the start so the operator knows how much is
 * left (Zeigarnik): choose a personal organization — the picker lists only
 * those — then give its company details in the same form the page's dialog
 * uses. On success the converted organization opens.
 */
export function ConvertToCompanyPage(): ReactNode {
  const t = useTranslation('organizations');
  const navigate = useNavigate();
  const pickerId = useId();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  const stepClass = (n: 1 | 2): string =>
    step === n ? 'font-medium text-foreground' : 'text-muted-foreground';

  return (
    <>
      <PageHeader
        title={t('convertToCompany.page.title')}
        description={t('convertToCompany.page.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/organizations">{t('taxIdScope.back')}</Link>
          </Button>
        }
      />
      <ol className="mb-4 flex items-center gap-3 text-sm" aria-label={t('convertToCompany.page.steps')}>
        <li className={stepClass(1)} aria-current={step === 1 ? 'step' : undefined}>
          {t('convertToCompany.page.step.choose')}
        </li>
        <li aria-hidden="true" className="text-muted-foreground">
          ·
        </li>
        <li className={stepClass(2)} aria-current={step === 2 ? 'step' : undefined}>
          {t('convertToCompany.page.step.details')}
        </li>
      </ol>
      <Card>
        <CardContent className="pt-6">
          {step === 1 ? (
            <div className="grid gap-4 md:max-w-md">
              <div className="grid gap-1.5">
                <Label htmlFor={pickerId}>{t('convertToCompany.page.picker')}</Label>
                <OrganizationPicker
                  id={pickerId}
                  ariaLabel={t('convertToCompany.page.picker')}
                  kind="personal"
                  value={organizationId}
                  onChange={setOrganizationId}
                  placeholder={t('convertToCompany.page.pickerPlaceholder')}
                  emptyMessage={t('convertToCompany.page.empty')}
                  clearable
                />
              </div>
              <div>
                <Button type="button" disabled={!organizationId} onClick={(): void => setStep(2)}>
                  {t('convertToCompany.page.next')}
                </Button>
              </div>
            </div>
          ) : (
            <ConvertToCompanyForm
              organizationId={organizationId!}
              onCancel={(): void => setStep(1)}
              onConverted={(result): void => {
                void navigate(`/organizations/${result.data.id}`, { replace: true });
              }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default ConvertToCompanyPage;
