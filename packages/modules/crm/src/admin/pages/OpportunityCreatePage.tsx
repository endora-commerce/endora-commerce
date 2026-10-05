import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CreateOpportunityRequest } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import {
  AssigneeLookup,
  ContactLookup,
  OrganizationLookup,
  SalesChannelSelect,
  useSalesChannelOptions,
} from '../components/LookupPickers.js';
import { errorMessage, normaliseAmount } from '../lib/labels.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = Partial<
  Record<'title' | 'organization' | 'currency' | 'value', string | undefined>
>;

/**
 * Creating an Opportunity by hand (`specs/143-crm-sales-opportunities/`, User
 * Story 1 — FR-001, FR-002).
 *
 * Three fields are required — a title, the Organization and the currency the
 * value is in; the last two cannot be changed afterwards. Everything else is
 * optional and can be added on the Opportunity later.
 *
 * `?organizationId=<uuid>` preselects the Organization, which is how a "New
 * opportunity" link on an Organization's own screen arrives here.
 */
export function OpportunityCreatePage(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedOrganization = searchParams.get('organizationId');
  const preselected =
    requestedOrganization && UUID.test(requestedOrganization) ? requestedOrganization : null;

  const [title, setTitle] = useState('');
  const [organizationId, setOrganizationId] = useState<string | null>(preselected);
  const [organizationName, setOrganizationName] = useState('');
  const [customerAccountId, setCustomerAccountId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('');
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // One read for two fields: the channel picker, and the currencies offered —
  // the ones the platform's active channels sell in. The currency dictionary is
  // another module's list behind another module's permission (research N-D4).
  const salesChannels = useSalesChannelOptions();
  const currencies = useMemo(
    () =>
      [
        ...new Set(
          salesChannels.channels
            .filter((channel) => channel.active)
            .flatMap((channel) => [channel.defaultCurrency, ...channel.currencies]),
        ),
      ].sort(),
    [salesChannels.channels],
  );

  // The preselected Organization arrives as an id; its name is what the picker
  // shows. A failed lookup leaves the id in place — the create still works.
  useEffect(() => {
    if (!preselected) return undefined;
    let alive = true;
    void crmApi.organizationName(preselected).then((name) => {
      if (alive && name) setOrganizationName(name);
    });
    return (): void => {
      alive = false;
    };
  }, [preselected]);

  const chooseOrganization = (next: string | null): void => {
    setOrganizationId(next);
    setOrganizationName('');
    // A contact person belongs to one Organization.
    setCustomerAccountId(null);
    setErrors((previous) => ({ ...previous, organization: undefined }));
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const amount = value.trim() === '' ? undefined : normaliseAmount(value);
    const next: FieldErrors = {};
    if (trimmedTitle === '') next.title = t('opportunity.create.error.title');
    if (!organizationId) next.organization = t('opportunity.create.error.organization');
    if (currency === '') next.currency = t('opportunity.create.error.currency');
    if (amount === null) next.value = t('opportunity.create.error.value');
    setErrors(next);
    if (Object.values(next).some(Boolean) || !organizationId) {
      if (next.title) titleRef.current?.focus();
      return;
    }

    const body: CreateOpportunityRequest = {
      title: trimmedTitle,
      organizationId,
      currency,
      ...(customerAccountId ? { customerAccountId } : {}),
      ...(salesChannelId ? { salesChannelId } : {}),
      // Absent means "apply the default rule" (the Organization's Sales Reps);
      // only a person the operator chose is sent.
      ...(assigneeId ? { assignedAdminUserId: assigneeId } : {}),
      ...(amount ? { manualValue: amount } : {}),
      ...(expectedCloseDate ? { expectedCloseDate } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };

    setBusy(true);
    setSubmitError(null);
    try {
      const created = await crmApi.createOpportunity(body);
      navigate(`/crm/opportunities/${created.id}`);
    } catch (failure) {
      setSubmitError(errorMessage(failure, t('opportunity.create.error.generic')));
      setBusy(false);
    }
  };

  const required = (
    <span aria-hidden="true" className="text-destructive">
      {' *'}
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('opportunity.create.title')}
        description={t('opportunity.create.description')}
        back={{ label: t('opportunity.detail.back'), to: '/crm/opportunities' }}
      />

      <form noValidate onSubmit={(event): void => void submit(event)}>
        <Card>
          <CardContent className="space-y-5 pt-6">
            {submitError ? (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <p className="text-xs text-muted-foreground">{t('opportunity.create.requiredHint')}</p>

            <div className="space-y-1">
              <Label htmlFor="crm-create-title">
                {t('opportunity.field.title')}
                {required}
              </Label>
              <Input
                id="crm-create-title"
                ref={titleRef}
                value={title}
                maxLength={200}
                required
                aria-invalid={errors.title !== undefined}
                aria-describedby={errors.title ? 'crm-create-title-error' : undefined}
                onChange={(event): void => setTitle(event.target.value)}
              />
              {errors.title ? (
                <p id="crm-create-title-error" className="text-xs text-destructive">
                  {errors.title}
                </p>
              ) : null}
            </div>

            <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="crm-create-organization">
                  {t('opportunity.field.organization')}
                  {required}
                </Label>
                <OrganizationLookup
                  id="crm-create-organization"
                  ariaLabel={t('opportunity.field.organization')}
                  value={organizationId}
                  selectedLabel={organizationName}
                  onChange={chooseOrganization}
                  placeholder={t('opportunity.picker.organizationPlaceholder')}
                  emptyMessage={t('opportunity.picker.organizationEmpty')}
                />
                <p
                  className={
                    errors.organization ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                  }
                >
                  {errors.organization ?? t('opportunity.field.organizationHint')}
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-contact">{t('opportunity.field.contact')}</Label>
                <ContactLookup
                  // Remounted per Organization: the picker caches what it found.
                  key={organizationId ?? 'none'}
                  id="crm-create-contact"
                  ariaLabel={t('opportunity.field.contact')}
                  value={customerAccountId}
                  onChange={setCustomerAccountId}
                  disabled={!organizationId}
                  placeholder={t('opportunity.picker.contactPlaceholder')}
                  emptyMessage={t('opportunity.picker.contactEmpty')}
                  {...(organizationId ? { organizationId } : {})}
                />
                <p className="text-xs text-muted-foreground">{t('opportunity.field.contactHint')}</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-channel">{t('opportunity.field.salesChannel')}</Label>
                <SalesChannelSelect
                  source={salesChannels}
                  id="crm-create-channel"
                  ariaLabel={t('opportunity.field.salesChannel')}
                  value={salesChannelId}
                  onChange={setSalesChannelId}
                  activeOnly
                  placeholder={t('opportunity.picker.salesChannelPlaceholder')}
                  emptyMessage={t('opportunity.picker.salesChannelEmpty')}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-assignee">{t('assignment.label')}</Label>
                <AssigneeLookup
                  id="crm-create-assignee"
                  ariaLabel={t('assignment.label')}
                  value={assigneeId}
                  onChange={setAssigneeId}
                  placeholder={t('assignment.picker.placeholder')}
                  emptyMessage={t('assignment.picker.empty')}
                />
                <p className="text-xs text-muted-foreground">{t('assignment.create.hint')}</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-close-date">
                  {t('opportunity.field.expectedCloseDate')}
                </Label>
                <Input
                  id="crm-create-close-date"
                  type="date"
                  value={expectedCloseDate}
                  onChange={(event): void => setExpectedCloseDate(event.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-value">{t('opportunity.field.value')}</Label>
                <Input
                  id="crm-create-value"
                  inputMode="decimal"
                  value={value}
                  aria-invalid={errors.value !== undefined}
                  aria-describedby="crm-create-value-hint"
                  onChange={(event): void => setValue(event.target.value)}
                />
                <p
                  id="crm-create-value-hint"
                  className={errors.value ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                >
                  {errors.value ?? t('opportunity.field.valueHint')}
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="crm-create-currency">
                  {t('opportunity.field.currency')}
                  {required}
                </Label>
                <Select
                  id="crm-create-currency"
                  required
                  value={currency}
                  aria-invalid={errors.currency !== undefined}
                  aria-describedby="crm-create-currency-hint"
                  onChange={(event): void => {
                    setCurrency(event.target.value);
                    setErrors((previous) => ({ ...previous, currency: undefined }));
                  }}
                >
                  <option value="">{t('opportunity.field.currencyChoose')}</option>
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
                {salesChannels.failed ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('opportunity.picker.loadError')}
                  </p>
                ) : null}
                <p
                  id="crm-create-currency-hint"
                  className={
                    errors.currency ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                  }
                >
                  {errors.currency ?? t('opportunity.field.currencyHint')}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="crm-create-description">{t('opportunity.field.description')}</Label>
              <Textarea
                id="crm-create-description"
                rows={5}
                value={description}
                maxLength={20000}
                onChange={(event): void => setDescription(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <StickyFormActions className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={(): void => void navigate('/crm/opportunities')}
          >
            {tCore('common.action.cancel')}
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t('opportunity.create.submitting') : t('opportunity.create.submit')}
          </Button>
        </StickyFormActions>
      </form>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunityCreatePage;
