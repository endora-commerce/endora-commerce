import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ORGANIZATION_FIELD_SET,
  ORGANIZATION_FORMS,
  type OrganizationSalesChannelOption,
} from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  CustomFieldValuesPanel,
  DeclaredFormNotices,
  DeclaredFormProvider,
  DeclaredFormSection,
  OrganizationPicker,
  customFieldErrorsOf,
  useDeclaredForm,
} from '@endora-commerce/admin-kit/components';
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
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { organizationSalesChannelsClient } from '../api/sales-channels.js';
import { SalesChannelChecklist } from '../components/SalesChannelChecklist.js';
import { DeclaredFieldNotes, describedBy, invalidOf } from '../components/declared-field-notes.js';

/**
 * *New organization* — an operator creates a customer Organization and chooses
 * the stores its members may use (feature 154, US5;
 * `specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §3).
 *
 * The fields are self-registration's organization part — name, tax id and the
 * registered address — plus the status an operator may start it in and its
 * sales channels. *Sales channels* pre-selects the system-default channel,
 * which is what every other creation path without a store assigns; the form
 * cannot be submitted with none, because an Organization with no channel may
 * shop nowhere. On success it opens the new Organization, where members are
 * invited.
 *
 * Feature 175 (FR-018, FR-039) — the Organization's custom fields are part of
 * the form: the shared panel, embedded, its bag sent as `customFieldValues` in
 * the create and a refusal said at the field it names. Its definitions are
 * `custom_fields:read`'s, so without that code the panel is not shown and the
 * create carries no values, as before.
 *
 * `specs/193-admin-form-extensions/` WP-E1 — the form is the declared form
 * `organization.create` (`ORGANIZATION_FORMS.create`): its fields render
 * through the admin kit's `DeclaredFormSection`, so a module may add a slot
 * field at an anchor and a deployment or an operator may relabel, move, hide
 * or lock what the field set invites. Each field keeps its own markup (`field`
 * renderers), so with no override and no slot the form is the form it was. The
 * slot values travel in the create's one request as `extensions`. The custom
 * fields stay their own panel: they are operator-defined fields, not the field
 * set's (D0).
 */

/** The panel's starting bag: a new Organization has none. */
const EMPTY_VALUES: Record<string, unknown> = {};

const STATUSES = ['active', 'pending_verification'] as const;

/**
 * The role whose reach is a subset of the installation — the backend's own rule
 * (`services/admin-tenant-scope.ts`). Naming a parent is parentage, the tenancy
 * graph, so it is an unscoped administrator's alone (D-260); the route refuses
 * anybody else with 403, and the form does not offer it to them
 * (`specs/177-tax-id-scope/` FR-018).
 */
const SCOPED_ROLE_CODE = 'sales_representative';
type Status = (typeof STATUSES)[number];

/** The declared form's values: the field set's keys, in the shapes the create sends. */
type CreateValues = {
  name: string;
  taxId: string;
  parentId: string | null;
  registeredAddress: { street: string; postalCode: string; city: string; country: string };
  status: Status;
  salesChannelIds: string[];
};

const INITIAL_VALUES: CreateValues = {
  name: '',
  taxId: '',
  parentId: null,
  registeredAddress: { street: '', postalCode: '', city: '', country: '' },
  status: 'active',
  salesChannelIds: [],
};

export function OrganizationCreate(): ReactNode {
  const t = useTranslation('organizations');
  const navigate = useNavigate();
  const [values, setValues] = useState<CreateValues>(INITIAL_VALUES);
  const { name, taxId, parentId, registeredAddress: address, status, salesChannelIds: channels } = values;
  const canNameParent = (useAuth().me?.role?.code ?? SCOPED_ROLE_CODE) !== SCOPED_ROLE_CODE;
  const [options, setOptions] = useState<OrganizationSalesChannelOption[] | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { hasPermission } = useAuth();
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setOptionsError(false);
    organizationSalesChannelsClient
      .options()
      .then((res) => {
        if (cancelled) return;
        setOptions(res.data);
        setValues((current) => ({ ...current, salesChannelIds: res.data.filter((o) => o.systemDefault).map((o) => o.id) }));
      })
      .catch(() => {
        if (!cancelled) setOptionsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const noChannel = options !== null && channels.length === 0;
  const cannotSubmit = saving || options === null || noChannel;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (cannotSubmit) return;
    // The deployment's tightened rules, before the round trip; the server holds
    // the same ones whatever the form showed (FR-062).
    if (!declared.validate()) return;
    setSaving(true);
    setError(null);
    setCustomFieldErrors({});
    // A field the declared form does not submit — hidden, or read-only — is
    // left out, so the create stores the field's default (`field-slots.md` §3).
    const { core, extensions } = declared.submission();
    const sent = (key: keyof CreateValues): boolean => Object.prototype.hasOwnProperty.call(core, key);
    try {
      const res = await organizationSalesChannelsClient.create({
        name: name.trim(),
        taxId: taxId.trim(),
        registeredAddress: {
          street: address.street.trim(),
          postalCode: address.postalCode.trim(),
          city: address.city.trim(),
          country: address.country.trim().toUpperCase(),
        },
        ...(sent('status') ? { status } : {}),
        salesChannelIds: channels,
        ...(parentId && sent('parentId') ? { parentId } : {}),
        ...(Object.keys(customFieldValues).length > 0 ? { customFieldValues } : {}),
        ...(extensions ? { extensions } : {}),
      });
      navigate(`/organizations/${res.data.id}`, { replace: true });
    } catch (err) {
      setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
      // A field rule or a slot's refusal, said at the field it names.
      declared.applyError(err);
      setError(err instanceof ApiError ? err.envelope.error.message : t('create.error'));
      setSaving(false);
    }
  };

  const declared = useDeclaredForm({
    form: ORGANIZATION_FORMS.create,
    fieldSet: ORGANIZATION_FIELD_SET,
    recordId: null,
    values,
    onChange: (key, value) => setValues((current) => ({ ...current, [key]: value })),
    render: {
      name: {
        field: (p) => (
          <div className="grid gap-2">
            <Label htmlFor="org-new-name">{p.labelOverride ?? t('create.field.name')}</Label>
            <Input
              id="org-new-name"
              value={name}
              onChange={(e) => p.onChange(e.target.value)}
              maxLength={255}
              required
              readOnly={p.readOnly}
              placeholder={p.placeholder}
              aria-describedby={describedBy('org-new-name', p)}
              {...invalidOf(p)}
            />
            <DeclaredFieldNotes id="org-new-name" field={p} />
          </div>
        ),
      },
      taxId: {
        field: (p) => (
          <div className="grid gap-2">
            <Label htmlFor="org-new-tax-id">{p.labelOverride ?? t('create.field.taxId')}</Label>
            <Input
              id="org-new-tax-id"
              value={taxId}
              onChange={(e) => p.onChange(e.target.value)}
              minLength={8}
              maxLength={32}
              required
              readOnly={p.readOnly}
              placeholder={p.placeholder}
              aria-describedby={describedBy('org-new-tax-id', p, parentId ? 'org-new-tax-id-hint' : null)}
              {...invalidOf(p)}
            />
            {parentId ? (
              <p id="org-new-tax-id-hint" className="text-xs text-muted-foreground">
                {t('create.hint.sharedTaxId')}
              </p>
            ) : null}
            <DeclaredFieldNotes id="org-new-tax-id" field={p} />
          </div>
        ),
      },
      parentId: {
        // Naming a parent is an unscoped administrator's alone (D-260).
        field: (p) =>
          canNameParent ? (
            <div className="grid gap-2 md:max-w-md">
              <Label htmlFor="org-new-parent">{p.labelOverride ?? t('create.field.parent')}</Label>
              <OrganizationPicker
                id="org-new-parent"
                ariaLabel={p.labelOverride ?? t('create.field.parent')}
                value={parentId}
                onChange={(next) => p.onChange(next)}
                clearable
                disabled={saving || p.readOnly}
              />
              <p className="text-xs text-muted-foreground">{p.helpOverride ?? t('create.field.parentHelp')}</p>
              <DeclaredFieldNotes id="org-new-parent" field={{ error: p.error, helpOverride: undefined }} />
            </div>
          ) : null,
      },
      registeredAddress: {
        field: (p) => {
          const change = (part: keyof CreateValues['registeredAddress'], next: string): void =>
            p.onChange({ ...address, [part]: next });
          return (
            <fieldset className="grid gap-2" aria-describedby={describedBy('org-new-address', p)} {...invalidOf(p)}>
              <legend className="mb-2 text-sm font-medium">{p.labelOverride ?? t('create.field.registeredAddress')}</legend>
              <div className="grid gap-2">
                <Label htmlFor="org-new-street">{t('create.field.street')}</Label>
                <Input
                  id="org-new-street"
                  value={address.street}
                  onChange={(e) => change('street', e.target.value)}
                  maxLength={255}
                  autoComplete="street-address"
                  required
                  readOnly={p.readOnly}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="org-new-postal-code">{t('create.field.postalCode')}</Label>
                  <Input
                    id="org-new-postal-code"
                    value={address.postalCode}
                    onChange={(e) => change('postalCode', e.target.value)}
                    maxLength={20}
                    autoComplete="postal-code"
                    required
                    readOnly={p.readOnly}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="org-new-city">{t('create.field.city')}</Label>
                  <Input
                    id="org-new-city"
                    value={address.city}
                    onChange={(e) => change('city', e.target.value)}
                    maxLength={120}
                    autoComplete="address-level2"
                    required
                    readOnly={p.readOnly}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="org-new-country">{t('create.field.country')}</Label>
                  <Input
                    id="org-new-country"
                    value={address.country}
                    onChange={(e) => change('country', e.target.value)}
                    minLength={2}
                    maxLength={2}
                    pattern="[A-Za-z]{2}"
                    autoComplete="country"
                    aria-describedby="org-new-country-help"
                    required
                    readOnly={p.readOnly}
                  />
                  <p id="org-new-country-help" className="text-xs text-muted-foreground">
                    {t('create.field.countryHelp')}
                  </p>
                </div>
              </div>
              <DeclaredFieldNotes id="org-new-address" field={p} />
            </fieldset>
          );
        },
      },
      status: {
        field: (p) => (
          <div className="grid gap-2 md:max-w-xs">
            <Label htmlFor="org-new-status">{p.labelOverride ?? t('create.field.status')}</Label>
            <Select
              id="org-new-status"
              value={status}
              onChange={(e) => p.onChange(e.target.value as Status)}
              // A select has no read-only state (D-300.18).
              disabled={p.readOnly}
              aria-describedby={describedBy('org-new-status', p)}
              {...invalidOf(p)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`create.status.${s}`)}
                </option>
              ))}
            </Select>
            <DeclaredFieldNotes id="org-new-status" field={p} />
          </div>
        ),
      },
      salesChannelIds: {
        field: (p) => (
          <div className="grid gap-2">
            <p id="org-new-channels-label" className="text-sm font-medium">
              {p.labelOverride ?? t('salesChannels.title')}
            </p>
            <p id="org-new-channels-help" className="text-xs text-muted-foreground">
              {p.helpOverride ?? t('salesChannels.description')}
            </p>
            {optionsError ? (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t('salesChannels.loadError')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAttempt((n) => n + 1)}
                  >
                    {t('salesChannels.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : options === null ? (
              <p className="text-sm text-muted-foreground">{t('salesChannels.loading')}</p>
            ) : (
              <SalesChannelChecklist
                options={options}
                value={channels}
                onChange={(next) => p.onChange(next)}
                disabled={saving || p.readOnly}
                idPrefix="org-new-channel"
                labelledBy="org-new-channels-label"
                describedBy={
                  noChannel ? 'org-new-channels-help org-new-channels-error' : 'org-new-channels-help'
                }
                invalid={noChannel || p.error !== undefined}
              />
            )}
            {noChannel ? (
              <p id="org-new-channels-error" role="alert" className="text-xs font-medium text-destructive">
                {t('salesChannels.atLeastOne')}
              </p>
            ) : null}
            <DeclaredFieldNotes id="org-new-channels" field={{ error: p.error, helpOverride: undefined }} />
          </div>
        ),
      },
    },
  });

  return (
    <>
      <PageHeader title={t('create.title')} back={{ label: t('create.back'), to: '/organizations' }} />
      <Card>
        <CardContent>
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
            <DeclaredFormProvider form={ORGANIZATION_FORMS.create} declared={declared}>
              <DeclaredFormNotices />
              <DeclaredFormSection section="identity" className="grid gap-2 space-y-0 md:grid-cols-2" />
              <DeclaredFormSection section="parent" className="empty:hidden" />
              <DeclaredFormSection section="address" />
              <DeclaredFormSection section="access" />
            </DeclaredFormProvider>

            {hasPermission('custom_fields:read') ? (
              <CustomFieldValuesPanel
                entityType="organization"
                values={EMPTY_VALUES}
                onChange={setCustomFieldValues}
                fieldErrors={customFieldErrors}
              />
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* What follows the Save, said beside it rather than as the page's description. */}
              <p className="mr-auto text-xs text-muted-foreground">{t('create.hint.inviteMembers')}</p>
              <Button type="button" variant="ghost" onClick={() => { navigate('/organizations'); }} disabled={saving}>
                {t('create.cancel')}
              </Button>
              <Button type="submit" disabled={cannotSubmit}>
                {t('create.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationCreate;
