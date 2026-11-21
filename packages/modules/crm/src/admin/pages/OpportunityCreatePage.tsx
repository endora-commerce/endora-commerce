import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CreateOpportunityRequest } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { StickyFormActions, TagMultiSelect } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import {
  AssigneeLookup,
  ContactLookup,
  OrganizationLookup,
  SalesChannelSelect,
  useSalesChannelOptions,
} from '../components/LookupPickers.js';
import { customFieldIssues, NewOpportunityCustomFields } from '../components/OpportunityCustomFields.js';
import { ReferenceField } from '../components/ReferenceField.js';
import { errorMessage, normaliseAmount } from '../lib/labels.js';
import { isUuidShape } from '@endora-commerce/contracts';

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
 *
 * `?linkDocumentKind=order|quote_request&linkDocumentId=<uuid>` is how "Create
 * opportunity" on an Order's or a Quote Request's screen arrives: once the
 * Opportunity exists, the document is linked to it through the link endpoint,
 * and then the Opportunity is opened. Two requests, not one: if the link is
 * refused the Opportunity still exists, the form says so and links to it, and
 * the document can be linked from there.
 */
export function OpportunityCreatePage(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedOrganization = searchParams.get('organizationId');
  const preselected =
    requestedOrganization && isUuidShape(requestedOrganization) ? requestedOrganization : null;

  // --- The document this Opportunity is being created from (US17) -----------
  const requestedLinkId = searchParams.get('linkDocumentId');
  const requestedLinkKind = searchParams.get('linkDocumentKind');
  const linkDocument =
    (requestedLinkKind === 'order' || requestedLinkKind === 'quote_request') &&
    requestedLinkId &&
    isUuidShape(requestedLinkId)
      ? ({ documentKind: requestedLinkKind, documentId: requestedLinkId } as const)
      : null;
  const linksAnOrder = linkDocument?.documentKind === 'order';
  /** Created, but the document could not be linked: the Opportunity to open, and why. */
  const [unlinked, setUnlinked] = useState<{ id: string; number: string; reason: string } | null>(null);
  // --- end ------------------------------------------------------------------

  const [title, setTitle] = useState('');
  const [organizationId, setOrganizationId] = useState<string | null>(preselected);
  const [organizationName, setOrganizationName] = useState('');
  const [customerAccountId, setCustomerAccountId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [currency, setCurrency] = useState('');
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Operator-defined fields (US15): the bag the embedded panel reports, and
  // the fields the server refused. `null` until a field is touched, so a form
  // with no custom field sends no bag at all.
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown> | null>(null);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
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
      ...(tagIds.length > 0 ? { tagIds } : {}),
      ...(amount ? { manualValue: amount } : {}),
      ...(expectedCloseDate ? { expectedCloseDate } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(customFieldValues ? { customFieldValues } : {}),
    };

    setBusy(true);
    setSubmitError(null);
    setCustomFieldErrors({});
    try {
      const created = await crmApi.createOpportunity(body);
      if (linkDocument) {
        try {
          await crmApi.addLink(created.id, linkDocument);
        } catch (failure) {
          // The Opportunity exists; submitting again would create a second one.
          setUnlinked({
            id: created.id,
            number: created.number,
            reason: errorMessage(failure, t('orderPanel.createForm.linkFailedGeneric')),
          });
          setBusy(false);
          return;
        }
      }
      navigate(`/crm/opportunities/${created.id}`);
    } catch (failure) {
      const issues = customFieldIssues(failure);
      setCustomFieldErrors(issues ?? {});
      // The server's sentence, and what it said about each field — shown here
      // as well as at the fields, because the fields are not on screen for
      // somebody who may not read their definitions.
      setSubmitError(
        [errorMessage(failure, t('opportunity.create.error.generic')), ...Object.values(issues ?? {})].join(' '),
      );
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('opportunity.create.title')}
        back={{ label: t('opportunity.detail.back'), to: '/crm/opportunities' }}
      />

      <form noValidate onSubmit={(event): void => void submit(event)}>
        <Card>
          <CardContent className="space-y-5">
            {submitError ? (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            {unlinked ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {linksAnOrder
                    ? t('orderPanel.createForm.linkFailed', { number: unlinked.number, reason: unlinked.reason })
                    : t('orderPanel.createForm.linkFailedQuoteRequest', {
                        number: unlinked.number,
                        reason: unlinked.reason,
                      })}{' '}
                  <Link to={`/crm/opportunities/${unlinked.id}`} className="font-medium underline underline-offset-4">
                    {t('orderPanel.createForm.open')}
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
            {linkDocument && !unlinked ? (
              <p className="text-sm text-muted-foreground">
                {linksAnOrder ? t('orderPanel.createForm.hint') : t('orderPanel.createForm.hintQuoteRequest')}
              </p>
            ) : null}

            {/* Issue #1564 (WORK-16): required is the kit FormField's asterisk and aria-required, not a prose note. */}
            <FormField label={t('opportunity.field.title')} error={errors.title} required>
              <Input
                id="crm-create-title"
                ref={titleRef}
                value={title}
                maxLength={200}
                required
                onChange={(event): void => setTitle(event.target.value)}
              />
            </FormField>

            <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
              <FormField
                id="crm-create-organization"
                label={t('opportunity.field.organization')}
                hint={t('opportunity.field.organizationHint')}
                error={errors.organization}
                required
              >
                {(control): ReactNode => (
                  <OrganizationLookup
                    id={control.id}
                    ariaLabel={t('opportunity.field.organization')}
                    ariaDescribedBy={control['aria-describedby']}
                    invalid={control['aria-invalid'] === true}
                    value={organizationId}
                    selectedLabel={organizationName}
                    onChange={chooseOrganization}
                    placeholder={t('opportunity.picker.organizationPlaceholder')}
                    emptyMessage={t('opportunity.picker.organizationEmpty')}
                  />
                )}
              </FormField>

              <FormField id="crm-create-contact" label={t('opportunity.field.contact')} hint={t('opportunity.field.contactHint')}>
                {(control): ReactNode => (
                  <ContactLookup
                    // Remounted per Organization: the picker caches what it found.
                    key={organizationId ?? 'none'}
                    id={control.id}
                    ariaLabel={t('opportunity.field.contact')}
                    ariaDescribedBy={control['aria-describedby']}
                    value={customerAccountId}
                    onChange={setCustomerAccountId}
                    disabled={!organizationId}
                    placeholder={t('opportunity.picker.contactPlaceholder')}
                    emptyMessage={t('opportunity.picker.contactEmpty')}
                    {...(organizationId ? { organizationId } : {})}
                  />
                )}
              </FormField>

              <FormField id="crm-create-channel" label={t('opportunity.field.salesChannel')}>
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
              </FormField>

              <FormField id="crm-create-assignee" label={t('assignment.label')} hint={t('assignment.create.hint')}>
                {(control): ReactNode => (
                  <AssigneeLookup
                    id={control.id}
                    ariaLabel={t('assignment.label')}
                    ariaDescribedBy={control['aria-describedby']}
                    value={assigneeId}
                    onChange={setAssigneeId}
                    placeholder={t('assignment.picker.placeholder')}
                    emptyMessage={t('assignment.picker.empty')}
                  />
                )}
              </FormField>

              <div className="space-y-1">
                <span className="text-sm font-medium leading-none">{t('tags.section')}</span>
                <TagMultiSelect
                  ariaLabel={t('tags.section')}
                  loadTags={crmApi.listTags}
                  selected={tagIds}
                  onChange={setTagIds}
                  className="w-full"
                />
              </div>

              <FormField label={t('opportunity.field.expectedCloseDate')}>
                <Input
                  id="crm-create-close-date"
                  type="date"
                  value={expectedCloseDate}
                  onChange={(event): void => setExpectedCloseDate(event.target.value)}
                />
              </FormField>

              <FormField label={t('opportunity.field.value')} hint={t('opportunity.field.valueHint')} error={errors.value}>
                <Input
                  id="crm-create-value"
                  inputMode="decimal"
                  value={value}
                  onChange={(event): void => setValue(event.target.value)}
                />
              </FormField>

              <FormField
                id="crm-create-currency"
                label={t('opportunity.field.currency')}
                hint={t('opportunity.field.currencyHint')}
                error={errors.currency}
                required
              >
                {(control): ReactNode => (
                  <>
                    <Select
                      {...control}
                      required
                      value={currency}
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
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {t('opportunity.picker.loadError')}
                      </p>
                    ) : null}
                  </>
                )}
              </FormField>
            </div>

            {/* User Story 12: the description may refer to products and orders. */}
            <FormField label={t('opportunity.field.description')}>
              <ReferenceField
                id="crm-create-description"
                rows={5}
                value={description}
                maxLength={20000}
                organizationId={organizationId}
                onValueChange={setDescription}
              />
            </FormField>
          </CardContent>
        </Card>

        <div className="mt-4">
          <NewOpportunityCustomFields onChange={setCustomFieldValues} fieldErrors={customFieldErrors} />
        </div>

        {/* Issue #1449 (DS-19) — in view while the form scrolls; Cancel, then Create last. */}
        <StickyFormActions
          desktop="sticky"
          secondary={
            <Button
              className="min-h-11 sm:min-h-9"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={(): void => void navigate('/crm/opportunities')}
            >
              {tCore('common.action.cancel')}
            </Button>
          }
          primary={
            <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy || unlinked !== null} aria-busy={busy}>
              {busy ? t('opportunity.create.submitting') : t('opportunity.create.submit')}
            </Button>
          }
        />
      </form>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunityCreatePage;
