import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { OrganizationSalesChannelOption } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { CustomFieldValuesPanel, customFieldErrorsOf } from '@endora-commerce/admin-kit/components';
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
 */

/** The panel's starting bag: a new Organization has none. */
const EMPTY_VALUES: Record<string, unknown> = {};

const STATUSES = ['active', 'pending_verification'] as const;
type Status = (typeof STATUSES)[number];

export function OrganizationCreate(): ReactNode {
  const t = useTranslation('organizations');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [options, setOptions] = useState<OrganizationSalesChannelOption[] | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
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
        setChannels(res.data.filter((o) => o.systemDefault).map((o) => o.id));
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
    setSaving(true);
    setError(null);
    setCustomFieldErrors({});
    try {
      const res = await organizationSalesChannelsClient.create({
        name: name.trim(),
        taxId: taxId.trim(),
        registeredAddress: {
          street: street.trim(),
          postalCode: postalCode.trim(),
          city: city.trim(),
          country: country.trim().toUpperCase(),
        },
        status,
        salesChannelIds: channels,
        ...(Object.keys(customFieldValues).length > 0 ? { customFieldValues } : {}),
      });
      navigate(`/organizations/${res.data.id}`, { replace: true });
    } catch (err) {
      setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
      setError(err instanceof ApiError ? err.envelope.error.message : t('create.error'));
      setSaving(false);
    }
  };

  return (
    <>
      <Link
        to="/organizations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('create.back')}
      </Link>
      <PageHeader title={t('create.title')} description={t('create.description')} />
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="org-new-name">{t('create.field.name')}</Label>
                <Input
                  id="org-new-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={255}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="org-new-tax-id">{t('create.field.taxId')}</Label>
                <Input
                  id="org-new-tax-id"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  minLength={8}
                  maxLength={32}
                  required
                />
              </div>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('create.field.registeredAddress')}</legend>
              <div className="grid gap-2">
                <Label htmlFor="org-new-street">{t('create.field.street')}</Label>
                <Input
                  id="org-new-street"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  maxLength={255}
                  autoComplete="street-address"
                  required
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="org-new-postal-code">{t('create.field.postalCode')}</Label>
                  <Input
                    id="org-new-postal-code"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    maxLength={20}
                    autoComplete="postal-code"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="org-new-city">{t('create.field.city')}</Label>
                  <Input
                    id="org-new-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    maxLength={120}
                    autoComplete="address-level2"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="org-new-country">{t('create.field.country')}</Label>
                  <Input
                    id="org-new-country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    minLength={2}
                    maxLength={2}
                    pattern="[A-Za-z]{2}"
                    autoComplete="country"
                    aria-describedby="org-new-country-help"
                    required
                  />
                  <p id="org-new-country-help" className="text-xs text-muted-foreground">
                    {t('create.field.countryHelp')}
                  </p>
                </div>
              </div>
            </fieldset>

            <div className="grid gap-2 md:max-w-xs">
              <Label htmlFor="org-new-status">{t('create.field.status')}</Label>
              <Select
                id="org-new-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`create.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-2">
              <p id="org-new-channels-label" className="text-sm font-medium">
                {t('salesChannels.title')}
              </p>
              <p id="org-new-channels-help" className="text-xs text-muted-foreground">
                {t('salesChannels.description')}
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
                  onChange={setChannels}
                  disabled={saving}
                  idPrefix="org-new-channel"
                  labelledBy="org-new-channels-label"
                  describedBy={
                    noChannel ? 'org-new-channels-help org-new-channels-error' : 'org-new-channels-help'
                  }
                  invalid={noChannel}
                />
              )}
              {noChannel ? (
                <p id="org-new-channels-error" role="alert" className="text-xs font-medium text-destructive">
                  {t('salesChannels.atLeastOne')}
                </p>
              ) : null}
            </div>

            {hasPermission('custom_fields:read') ? (
              <CustomFieldValuesPanel
                entityType="organization"
                values={EMPTY_VALUES}
                onChange={setCustomFieldValues}
                fieldErrors={customFieldErrors}
              />
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => navigate('/organizations')} disabled={saving}>
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
